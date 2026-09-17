import { config } from './config.js';

export class LiveChatClient {
  constructor(overrides={}) {
    this.base = overrides.base || config.lcApiBase;
    this.accountId = overrides.accountId || config.lcAccountId;
    this.pat = overrides.pat || config.lcPat;
    this.timeoutMs = overrides.timeoutMs || 15000;
    this.endChatPermanentFailures = new Map();
  }
  ready() { return Boolean(this.accountId && this.pat && this.base); }
  authHeader() {
    return 'Basic ' + Buffer.from(`${this.accountId}:${this.pat}`).toString('base64');
  }
  async call(action, body={}) {
    if (!this.ready()) throw new Error('LIVECHAT_CREDENTIALS_MISSING');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await fetch(`${this.base}/${action}`, {
        method:'POST',
        headers:{ 'Authorization': this.authHeader(), 'Content-Type':'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const txt = await r.text();
      let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw:txt }; }
      if (!r.ok) {
        const err = new Error(`LIVECHAT_${r.status}: ${data?.error?.message || data?.message || txt.slice(0,300)}`);
        err.status = r.status; err.data = data; throw err;
      }
      return data;
    } finally { clearTimeout(timer); }
  }

  // LiveChat Agent Chat API list_chats may expose the list as chats_summary.
  // Keep compatibility with alternate/older shapes as well.
  normalizeChatList(data) {
    if (Array.isArray(data?.chats_summary)) return { items:data.chats_summary, source:'chats_summary' };
    if (Array.isArray(data?.chats)) return { items:data.chats, source:'chats' };
    if (Array.isArray(data?.items)) return { items:data.items, source:'items' };
    return { items:[], source:'none' };
  }


  chatState(summary) {
    const th = summary?.last_thread_summary || summary?.last_thread || {};
    const followed = summary?.is_followed;
    const active = typeof th?.active === 'boolean' ? th.active
      : (typeof summary?.active === 'boolean' ? summary.active
      : (String(summary?.status || '').toLowerCase() === 'active' ? true : null));
    const routingStatus = String(summary?.routing_status || th?.routing_status || '').toLowerCase();
    return { followed, active, routingStatus };
  }

  isMyActiveChat(summary) {
    const st = this.chatState(summary);
    // LiveChat's Agent API marks chats followed by the current agent with is_followed.
    // This most closely mirrors the web app's "My chats" list.
    if (st.followed === true) return st.active !== false && st.routingStatus !== 'closed';
    if (st.followed === false) return false;
    // Defensive fallback for response variants without is_followed.
    return st.active === true && !['closed','archived'].includes(st.routingStatus);
  }

  filterInbox(items) {
    if (config.lcInboxMode === 'all') return items;
    return items.filter(x => this.isMyActiveChat(x));
  }

  async listChats({paginate=true,maxPages=10000,retries=2}={}) {
    const candidates = [
      { filters: { include_active: true, include_chats_without_threads: true }, sort_order: 'desc', limit: config.lcListLimit },
      { filters: { include_active: true }, sort_order: 'desc', limit: config.lcListLimit },
      { sort_order: 'desc', limit: config.lcListLimit },
      { limit: config.lcListLimit }
    ];
    const transientStatus=new Set([408,425,429,500,502,503,504]);
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const callPage=async(body)=>{
      let attempt=0;
      while(true){
        try{return await this.call('list_chats',body);}
        catch(e){
          if(attempt>=Math.max(0,Number(retries)||0) || !transientStatus.has(Number(e?.status))) throw e;
          await sleep(Math.min(2000,150*(2**attempt))); attempt++;
        }
      }
    };
    let firstPage;
    let firstNormalized;
    let last;
    for (const body of candidates) {
      try {
        firstPage = await callPage(body);
        firstNormalized = this.normalizeChatList(firstPage);
        break;
      } catch (e) {
        last=e;
        if (e.status !== 400) throw e;
      }
    }
    if (!firstPage) throw last;

    const chats=[];
    const seenChatIds=new Set();
    const addPage=(items=[])=>{
      for (const chat of items) {
        const id=chat?.id == null ? '' : String(chat.id);
        if (id) {
          if (seenChatIds.has(id)) continue;
          seenChatIds.add(id);
        }
        chats.push(chat);
      }
    };
    addPage(firstNormalized.items);

    let pagesFetched=1;
    let inventoryComplete=!firstPage?.next_page_id;
    let paginationStopReason=inventoryComplete?'end_of_pages':(paginate?'pending':'fast_path');
    if (paginate) {
      const seenPageIds=new Set();
      let page=firstPage;
      while (page?.next_page_id) {
        const rawPageId=page.next_page_id;
        if(!['string','number'].includes(typeof rawPageId) || String(rawPageId).trim()===''){
          inventoryComplete=false; paginationStopReason='malformed_next_page_id'; break;
        }
        const pageId=String(rawPageId);
        if (seenPageIds.has(pageId)) { inventoryComplete=false; paginationStopReason='repeated_page_id'; break; }
        if (pagesFetched>=Math.max(1,Number(maxPages)||10000)) { inventoryComplete=false; paginationStopReason='max_pages_guard'; break; }
        seenPageIds.add(pageId);
        // LiveChat cursor already carries the original filters/sort/limit.
        // page_id MUST be sent by itself; combining it with filters/limit/sort_order causes 422.
        page=await callPage({ page_id: pageId });
        pagesFetched++;
        addPage(this.normalizeChatList(page).items);
        if(!page?.next_page_id){ inventoryComplete=true; paginationStopReason='end_of_pages'; }
      }
    }

    return {
      ...firstPage,
      _normalizedChats: chats,
      _listSource: firstNormalized.source,
      _pagesFetched: pagesFetched,
      _inventoryComplete: Boolean(inventoryComplete),
      _paginationStopReason: paginationStopReason
    };
  }
  normalizeChatDetail(data, fallback={}) {
    let chat = null;
    let source = 'none';
    if (data && typeof data === 'object' && data.chat && typeof data.chat === 'object') {
      chat = data.chat; source = 'chat';
    } else if (data && typeof data === 'object' && (data.id || Array.isArray(data.threads))) {
      chat = data; source = 'direct';
    } else if (Array.isArray(data?.chats) && data.chats[0]) {
      chat = data.chats[0]; source = 'chats[0]';
    } else if (Array.isArray(data?.items) && data.items[0]) {
      chat = data.items[0]; source = 'items[0]';
    }
    if (!chat) chat = { ...fallback };
    else chat = { ...fallback, ...chat };
    if (!chat.id && fallback?.id) chat.id = fallback.id;
    Object.defineProperty(chat, '_detailSource', { value: source, enumerable: false, configurable: true });
    return chat;
  }

  async getChat(chatId, fallback={}) {
    const threadId = fallback?.last_thread_summary?.id ?? fallback?.last_thread?.id ?? fallback?.thread_id ?? null;
    const candidates = [];
    // Prefer requests that ask LiveChat for a wider history window when supported.
    // IMPORTANT: never return the first non-empty result. Some accounts return only the selected
    // thread for a thread_id request, while the plain chat request contains more of the conversation.
    // We evaluate every supported candidate and keep the response with the most readable events.
    if (threadId !== null && threadId !== undefined && String(threadId) !== '') {
      candidates.push({ chat_id: chatId, thread_id: threadId, thread_limit: 100 });
    }
    candidates.push({ chat_id: chatId, thread_limit: 100 });
    if (threadId !== null && threadId !== undefined && String(threadId) !== '') {
      candidates.push({ chat_id: chatId, thread_id: threadId });
    }
    candidates.push({ chat_id: chatId });

    const seenBodies=new Set();
    let lastErr = null;
    let best = null;
    let bestCount = -1;
    for (const body of candidates) {
      const key=JSON.stringify(body); if(seenBodies.has(key)) continue; seenBodies.add(key);
      try {
        const data = await this.call('get_chat', body);
        const chat = this.normalizeChatDetail(data, fallback);
        Object.defineProperty(chat, '_getChatRequest', { value: body, enumerable: false, configurable: true });
        const count = extractChatEvents(chat).length;
        if (count > bestCount) { best = chat; bestCount = count; }
      } catch (e) {
        lastErr = e;
        // thread_limit / thread_id shapes vary between LiveChat accounts. Unsupported variants are
        // expected and simply fall through to the next candidate.
        if (![400,404,422].includes(Number(e?.status))) throw e;
      }
    }
    if (best) return best;
    if (lastErr) throw lastErr;
    return this.normalizeChatDetail({}, fallback);
  }

  chatDiagnostics(chat) {
    const threads = Array.isArray(chat?.threads) ? chat.threads : [];
    const topEvents = Array.isArray(chat?.events) ? chat.events.length : 0;
    const threadEvents = threads.reduce((n,t)=>n + (Array.isArray(t?.events)?t.events.length:0), 0);
    const messages = extractChatEvents(chat).length;
    return {
      detailSource: chat?._detailSource || 'unknown',
      threadCount: threads.length,
      eventCount: topEvents + threadEvents,
      messageCount: messages,
      requestedThreadId: chat?._getChatRequest?.thread_id ?? null,
      requestUsed: chat?._getChatRequest || null,
      keys: chat && typeof chat==='object' ? Object.keys(chat).slice(0,30) : []
    };
  }
  sendMessage(chatId, text) {
    return this.call('send_event', {
      chat_id: chatId,
      event: { type:'message', text },
      attach_to_last_thread: true
    });
  }

  async uploadFile(chatId, bytes, {name='image.jpg', contentType='image/jpeg'}={}) {
    if (!this.ready()) throw new Error('LIVECHAT_CREDENTIALS_MISSING');
    const id=String(chatId||'').trim();
    if(!id){ const er=new Error('LIVECHAT_CHAT_ID_REQUIRED'); er.status=400; throw er; }
    const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes||[]);
    if(!data.length){ const er=new Error('LIVECHAT_FILE_EMPTY'); er.status=400; throw er; }

    const form=new FormData();
    form.append('chat_id',id);
    form.append('file',new Blob([data],{type:String(contentType||'application/octet-stream')}),String(name||'file'));
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),Math.max(this.timeoutMs,20000));
    try{
      const r=await fetch(`${this.base}/upload_file`,{
        method:'POST',
        headers:{'Authorization':this.authHeader()},
        body:form,
        signal:ctrl.signal
      });
      const txt=await r.text();
      let out; try{out=txt?JSON.parse(txt):{};}catch{out={raw:txt};}
      if(!r.ok){
        const er=new Error(`LIVECHAT_${r.status}: ${out?.error?.message||out?.message||txt.slice(0,300)}`);
        er.status=r.status; er.data=out; throw er;
      }
      const file=out?.file || out?.files?.[0] || out?.uploaded_file || out;
      const url=String(file?.url||file?.file_url||file?.download_url||out?.url||'').trim();
      if(!url){ const er=new Error('LIVECHAT_UPLOAD_URL_MISSING'); er.status=502; er.data=out; throw er; }
      return {url,name:String(file?.name||name),contentType:String(file?.content_type||file?.mime_type||contentType),size:Number(file?.size||data.length),raw:out};
    }finally{clearTimeout(timer);}
  }

  async sendFile(chatId, file={}) {
    const id=String(chatId||'').trim();
    const url=String(file?.url||'').trim();
    if(!id){ const er=new Error('LIVECHAT_CHAT_ID_REQUIRED'); er.status=400; throw er; }
    if(!url){ const er=new Error('LIVECHAT_FILE_URL_REQUIRED'); er.status=400; throw er; }
    const meta={
      type:'file',
      url,
      name:String(file?.name||'image.jpg'),
      content_type:String(file?.contentType||file?.content_type||'application/octet-stream'),
      size:Number(file?.size||0)
    };
    const candidates=[
      {chat_id:id,event:meta,attach_to_last_thread:true},
      {chat_id:id,event:{type:'file',file:{url:meta.url,name:meta.name,content_type:meta.content_type,size:meta.size}},attach_to_last_thread:true}
    ];
    let last=null;
    for(const body of candidates){
      try{return await this.call('send_event',body);}catch(e){last=e;if(![400,422].includes(Number(e?.status)))throw e;}
    }
    throw last||new Error('LIVECHAT_SEND_FILE_FAILED');
  }

  async uploadAndSendFile(chatId, bytes, meta={}) {
    const uploaded=await this.uploadFile(chatId,bytes,meta);
    const sent=await this.sendFile(chatId,uploaded);
    return {uploaded,sent};
  }
  chatActiveFlag(chat={}) {
    const th=chat?.last_thread || chat?.last_thread_summary || (Array.isArray(chat?.threads)?chat.threads.at(-1):null) || {};
    if(typeof th?.active==='boolean') return th.active;
    if(typeof chat?.active==='boolean') return chat.active;
    const status=String(chat?.status||chat?.routing_status||th?.routing_status||'').toLowerCase();
    if(['closed','archived','inactive'].includes(status)) return false;
    if(status==='active') return true;
    return null;
  }
  async endChat(chatId) {
    const id=String(chatId||'').trim();
    if(!id){ const er=new Error('LIVECHAT_CHAT_ID_REQUIRED'); er.status=400; throw er; }

    const blocked=this.endChatPermanentFailures.get(id);
    if(blocked && blocked.until>Date.now()){
      const er=new Error(blocked.message||'LIVECHAT_END_FORBIDDEN');
      er.status=403; er.nonRetryable=true; er.cached=true; throw er;
    }
    if(blocked) this.endChatPermanentFailures.delete(id);

    // LiveChat Agent API `deactivate_chat` expects `{ id: <chat_id> }`.
    // Older project builds incorrectly sent `{ chat_id: ... }`, causing
    // HTTP 422: "`id` is required". Keep a compatibility fallback only for
    // accounts/proxies that still expose the alternate shape.
    const candidates=[
      {body:{id},shape:'id'},
      {body:{chat_id:id},shape:'chat_id'}
    ];
    let lastError=null,lastResponse=null,attempts=0;

    const verifyClosed=async()=>{
      try{
        const state=await this.getChat(id,{});
        const active=this.chatActiveFlag(state);
        if(active===false) return {closed:true,source:'get_chat'};
        return {closed:false,active,source:'get_chat'};
      }catch(e){
        if(Number(e?.status)===404) return {closed:true,source:'get_chat_404'};
        return {closed:false,verifyError:String(e?.message||e),source:'get_chat_error'};
      }
    };

    // Call deactivate_chat first. If LiveChat reports 404/422 or another terminal
    // state, verification below decides whether the chat was already closed.
    for(const candidate of candidates){
      attempts++;
      try{
        lastResponse=await this.call('deactivate_chat',candidate.body);

        // Explicit provider success does not need a second get_chat call. This keeps
        // End Chat fast and avoids turning a successful deactivate into an unrelated
        // verification error on accounts with restrictive get_chat permissions.
        if(lastResponse?.ok===true){
          return {ok:true,verified:null,attempts,requestShape:candidate.shape,response:lastResponse};
        }

        // Some LC responses are `{}` / no explicit `ok`; verify those conservatively.
        await new Promise(r=>setTimeout(r,180));
        const verified=await verifyClosed();
        if(verified.closed){
          return {ok:true,verified:true,attempts,requestShape:candidate.shape,response:lastResponse,verify:verified};
        }

        // A 2xx response with unknown active flag is accepted as provider success;
        // dashboard state is reconciled by the next poll.
        if(verified.active===null || verified.active===undefined){
          return {ok:true,verified:null,attempts,requestShape:candidate.shape,response:lastResponse,verify:verified};
        }

        lastError=new Error('LIVECHAT_END_NOT_CONFIRMED');
        lastError.status=502;
      }catch(e){
        lastError=e;

        // If provider says invalid payload / missing field, try the compatibility
        // candidate. If the chat disappeared meanwhile, treat it as closed.
        const verified=await verifyClosed();
        if(verified.closed){
          return {ok:true,alreadyClosed:true,verified:true,attempts,requestShape:candidate.shape,response:lastResponse,verify:verified};
        }

        const status=Number(e?.status);
        const message=String(e?.message||'');
        if(status===403 && /requester is not user of the chat/i.test(message)){
          this.endChatPermanentFailures.set(id,{until:Date.now()+5*60*1000,message});
          e.nonRetryable=true;
          throw e;
        }
        if(![400,404,422].includes(status)) throw e;

        // 404 from deactivate_chat can also mean the chat is already gone/closed.
        if(Number(e?.status)===404){
          return {ok:true,alreadyClosed:true,verified:true,attempts,requestShape:candidate.shape,response:lastResponse,verify:verified};
        }
      }
    }

    const er=new Error(`LIVECHAT_END_FAILED: ${String(lastError?.message||'unable to deactivate chat')}`);
    er.status=Number(lastError?.status)||502;
    er.cause=lastError;
    throw er;
  }
  async prepareImageAttachments(attachments=[]) {
    const out=[];
    for(const a of (attachments||[]).filter(x=>x?.isImage).slice(0,3)) {
      const item={...a};
      const url=String(item.url||'');
      if(!/^https:\/\//i.test(url)) { out.push(item); continue; }
      try {
        const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),8000);
        const r=await fetch(url,{signal:ctrl.signal,redirect:'follow'}); clearTimeout(timer);
        if(!r.ok) throw new Error(`HTTP_${r.status}`);
        const ct=String(r.headers.get('content-type')||item.mime||'image/jpeg').split(';')[0];
        if(!ct.startsWith('image/')) throw new Error('NOT_IMAGE');
        const ab=await r.arrayBuffer();
        if(ab.byteLength>5*1024*1024) throw new Error('IMAGE_TOO_LARGE');
        item.url=`data:${ct};base64,${Buffer.from(ab).toString('base64')}`; item.mime=ct; item.prepared=true;
      } catch { item.prepared=false; }
      out.push(item);
    }
    return out;
  }
  async test() {
    const started = Date.now();
    const data = await this.listChats();
    const items = data?._normalizedChats || [];
    return {
      ok:true,
      connected:true,
      latencyMs:Date.now()-started,
      count:this.filterInbox(items).length,
      rawCount:items.length,
      myActiveCount:this.filterInbox(items).length,
      listSource:data?._listSource || 'none',
      foundChats:Number(data?.found_chats ?? items.length),
      hasNextPage:Boolean(data?.next_page_id),
      sampleChatIds:this.filterInbox(items).slice(0,5).map(x=>String(x?.id||'')).filter(Boolean),
      sampleStates:items.slice(0,10).map(x=>({id:String(x?.id||''),...this.chatState(x)}))
    };
  }
}

export function extractChatEvents(chat) {
  const out = [];
  const seen = new Set();
  const eventGroups = [];
  const visited = new Set();

  function walk(node, owner=null, depth=0) {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node.events)) eventGroups.push({ owner: node, events: node.events });
    if (Array.isArray(node)) { for (const x of node) walk(x, owner, depth+1); return; }
    for (const [k,v] of Object.entries(node)) { if (k !== 'events' && v && typeof v === 'object') walk(v, node, depth+1); }
  }
  walk(chat);

  function collectAttachments(ev) {
    const arr=[]; const seenUrl=new Set();
    const candidates=[];
    if(Array.isArray(ev?.attachments)) candidates.push(...ev.attachments);
    if(Array.isArray(ev?.files)) candidates.push(...ev.files);
    if(ev?.file && typeof ev.file==='object') candidates.push(ev.file);
    if(ev?.image && typeof ev.image==='object') candidates.push(ev.image);
    if(ev?.content && typeof ev.content==='object') {
      if(Array.isArray(ev.content.attachments)) candidates.push(...ev.content.attachments);
      if(ev.content.file) candidates.push(ev.content.file);
      if(ev.content.image) candidates.push(ev.content.image);
    }
    const type=String(ev?.type||ev?.event_type||'').toLowerCase();
    if(['file','image'].includes(type)) candidates.push(ev);
    for(const a of candidates){
      if(!a || typeof a!=='object') continue;
      const url=a.url||a.image_url||a.file_url||a.download_url||a.secure_url||a.src||a?.content?.url||null;
      if(!url || seenUrl.has(url)) continue; seenUrl.add(url);
      const mime=String(a.content_type||a.mime_type||a.mime||a.type||'').toLowerCase();
      const name=String(a.name||a.file_name||a.filename||'');
      const isImage=mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(String(url)) || /\.(png|jpe?g|webp|gif)$/i.test(name) || type==='image';
      arr.push({url:String(url),mime,name,isImage});
    }
    return arr.slice(0,8);
  }

  for (const {owner,events} of eventGroups) {
    for (const ev of events) {
      const type = String(ev?.type || ev?.event_type || ev?.event?.type || '').toLowerCase();
      let text = ev?.text;
      if (!text && typeof ev?.content?.text === 'string') text = ev.content.text;
      if (!text && typeof ev?.message?.text === 'string') text = ev.message.text;
      if (!text && typeof ev?.event?.text === 'string') text = ev.event.text;
      if (!text && Array.isArray(ev?.elements)) text = ev.elements.map(x=>x?.title||x?.text||x?.subtitle||'').filter(Boolean).join(' ');
      const attachments=collectAttachments(ev);
      text = String(text || '').trim();
      if (!text && attachments.length) text = attachments.some(a=>a.isImage) ? '[Member mengirim gambar]' : '[Member mengirim file]';
      if (!text) continue;
      if (type && !['message','rich_message','file','image'].includes(type) && !attachments.length) continue;
      const createdAt = ev?.created_at || owner?.created_at || new Date().toISOString();
      const ownerId = owner?.id ?? owner?.thread_id ?? '';
      const eventId = String(ev?.id ?? `${ownerId}:${createdAt}:${text}:${attachments.map(a=>a.url).join('|')}`);
      if (seen.has(eventId)) continue; seen.add(eventId);
      out.push({
        eventId, threadId:String(ownerId), createdAt, text, attachments,
        authorId: ev?.author_id || ev?.author?.id || ev?.user_id || '',
        authorType: ev?.author_type || ev?.author?.type || '', recipients: ev?.recipients || 'all'
      });
    }
  }
  return out.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
}

