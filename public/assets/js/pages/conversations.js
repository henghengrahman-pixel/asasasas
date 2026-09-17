import {api} from '../core/api.js';
import {toast,esc} from '../core/ui.js';
import {createConversationStore} from './conversation-store.js';

const $=s=>document.querySelector(s);const store=createConversationStore();
const state={cursor:null,hasMore:false,filter:'ALL',query:'',listActive:null,listVersion:0,detailAbort:null,detailVersion:0,listTimer:null,messageTimer:null,messageBusy:false,messageAfterId:0,pollDelay:4000,imageFile:null,shortcutIndex:0,shortcuts:[],shortcutAbort:null,shortcutVersion:0,messageCursor:null,loadingOlder:false,sendBusy:false,lastSyncAt:0};
const list=$('#chatList'),msgs=$('#messages'),composer=$('#composerText');
const selected=()=>store.state.selectedChatId;
const fmtTime=v=>{if(!v)return'';try{return new Date(v).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}catch{return''}};
const fmtDate=v=>{if(!v)return'Tidak tersedia';try{return new Date(v).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})}catch{return String(v)}};
const modeOf=x=>String(x?.handling_mode||x?.handling_state||'AI').toUpperCase().includes('HUMAN')?'HUMAN':'AI';
function setConnection(v){store.state.connectionState=v;if(v==='LIVE')state.lastSyncAt=Date.now();const el=$('#connectionState');if(!el)return;let label=v;if(v==='RECONNECTING'&&state.lastSyncAt){const sec=Math.max(1,Math.round((Date.now()-state.lastSyncAt)/1000));label=`RECONNECTING · ${sec}s`;}el.textContent=label;el.className='connection-state '+v.toLowerCase();el.title=state.lastSyncAt?`Last sync: ${new Date(state.lastSyncAt).toLocaleTimeString('id-ID')}`:''}
function setBusy(btn,busy,label){if(!btn)return;if(busy){btn.dataset.prev=btn.textContent;btn.textContent=label;btn.disabled=true}else{btn.textContent=btn.dataset.prev||btn.textContent;btn.disabled=false}}
function autoGrow(){composer.style.height='auto';composer.style.height=Math.min(composer.scrollHeight,120)+'px';$('#charCount').textContent=String(composer.value.length)}
function chatRowHtml(c){const mode=modeOf(c);return `<div class="avatar">${esc((c.customer_name||'?').slice(0,1).toUpperCase())}</div><div class="chat-copy"><div class="chat-title"><b>${esc(c.customer_name||c.chat_id)}</b><time>${esc(fmtTime(c.last_message_at||c.last_event_at))}</time></div><div class="chat-last">${esc(c.last_message||'Belum ada pesan')}</div><div class="chat-row-bottom"><span class="mode-text ${mode==='HUMAN'?'human':''}">${mode}</span>${c.needs_reply?'<span class="needs-reply" title="Menunggu balasan"></span>':''}</div></div>`}
function renderRows(){
  const items=store.items(),ids=new Set(items.map(x=>String(x.chat_id)));
  for(const el of [...list.querySelectorAll('.chat-row')])if(!ids.has(el.dataset.id))el.remove();
  if(!items.length){list.innerHTML='<div class="empty inbox-empty">Tidak ada percakapan sesuai filter.</div>';$('#inboxCount').textContent='0 aktif';$('#keyboardNavCount').textContent='0';return}
  list.querySelector('.inbox-empty')?.remove();list.querySelector('.chat-list-loading')?.remove();
  for(const c of items){const id=String(c.chat_id);let row=list.querySelector(`.chat-row[data-id="${CSS.escape(id)}"]`);if(!row){row=document.createElement('div');row.className='chat-row';row.dataset.id=id;row.addEventListener('click',()=>openChat(id));}
    row.classList.toggle('active',id===selected());const sig=JSON.stringify([c.customer_name,c.last_message,c.last_message_at,c.last_event_at,c.handling_mode,c.needs_reply,c.status]);if(row.dataset.sig!==sig){row.innerHTML=chatRowHtml(c);row.dataset.sig=sig}list.append(row);
  }
  $('#inboxCount').textContent=`${items.length}${state.hasMore?'+':''} aktif`;$('#keyboardNavCount').textContent=`${items.length}${state.hasMore?'+':''}`;$('#loadMoreChats').classList.toggle('hidden',!state.hasMore);
}
async function fetchList({append=false,silent=false,reason='user'}={}){
  const priority=reason==='poll'?0:2;
  const active=state.listActive;
  // Background refresh is single-flight. A user action always wins and aborts the stale request.
  if(active){
    if(priority<=active.priority&&reason==='poll')return {skipped:'background_busy'};
    active.controller.abort(new DOMException('Superseded by newer inbox request','AbortError'));
  }
  const ctl=new AbortController(),version=++state.listVersion;
  state.listActive={controller:ctl,version,priority,reason};
  const requestCursor=append?state.cursor:null;
  const params=new URLSearchParams({limit:'50',filter:state.filter});if(append&&requestCursor)params.set('cursor',requestCursor);if(state.query)params.set('q',state.query);
  try{
    const data=await api('/api/conversations?'+params,{signal:ctl.signal,timeout:8000});
    if(version!==state.listVersion||ctl.signal.aborted)return {skipped:'stale'};
    state.hasMore=Boolean(data.page?.hasMore);state.cursor=data.page?.nextCursor||null;append?store.merge(data.items||[]):store.replace(data.items||[]);renderRows();
    const cur=selected();if(cur&&!store.get(cur)&&!append){store.select('');clearConversation('Percakapan sudah ditutup atau tidak lagi aktif.')}setConnection('LIVE');state.pollDelay=4000;
    return data;
  }catch(e){
    if(e.name==='AbortError')return {skipped:'aborted'};
    setConnection(navigator.onLine?'RECONNECTING':'OFFLINE');state.pollDelay=Math.min(30000,Math.max(6000,state.pollDelay*1.7));if(!silent){list.querySelector('.chat-list-loading')?.remove();if(!store.items().length)list.innerHTML='<div class="request-error"><b>Gagal memuat Inbox</b><span>Periksa koneksi lalu coba lagi.</span><button id="retryInbox" class="btn ghost">COBA LAGI</button></div>';$('#retryInbox')?.addEventListener('click',()=>fetchList({reason:'retry'}));toast(e.message,'error')}return {error:e};
  }finally{if(state.listActive?.version===version)state.listActive=null}
}
function scheduleListPoll(){clearTimeout(state.listTimer);state.listTimer=setTimeout(async()=>{await fetchList({silent:true,reason:'poll'});scheduleListPoll()},document.hidden?15000:state.pollDelay)}
document.addEventListener('visibilitychange',()=>{scheduleListPoll();scheduleMessagePoll()});window.addEventListener('online',()=>{setConnection('RECONNECTING');fetchList({silent:true,reason:'reconnect'});scheduleMessagePoll()});window.addEventListener('offline',()=>setConnection('OFFLINE'));
function senderLabel(m){if(m.sender_type==='customer')return'MEMBER';if(m.sender_type==='ai')return'BOT';return'CS HUMAN'}
function attachmentHtml(m){return (Array.isArray(m.attachments)?m.attachments:[]).map(x=>x?.isImage||/^image\//.test(x?.mime||'')?`<button class="image-link" data-image="${esc(x.url)}"><img loading="lazy" class="chat-image" src="${esc(x.url)}" alt="${esc(x.name||'image')}"></button>`:`<a class="file-chip" href="${esc(x.url||'#')}" target="_blank" rel="noopener">${esc(x.name||'Attachment')}</a>`).join('')}
function messageNode(m){const d=document.createElement('div');d.className='bubble '+(m.sender_type==='customer'?'in':m.sender_type==='ai'?'out bot':'out human');d.dataset.messageId=String(m.id||m.event_id||'');d.innerHTML=`<div class="message-sender">${senderLabel(m)}</div>${attachmentHtml(m)}${m.text?`<div class="message-text">${esc(m.text)}</div>`:''}<div class="message-meta">${esc(fmtTime(m.created_at))}</div>`;return d}
function nearBottom(){return msgs.scrollHeight-msgs.scrollTop-msgs.clientHeight<90}
function bindImagePreview(root=msgs){root.querySelectorAll('.image-link').forEach(b=>b.onclick=()=>{const url=b.dataset.image;const overlay=document.createElement('div');overlay.className='image-lightbox';overlay.innerHTML=`<button aria-label="Tutup">×</button><img src="${esc(url)}" alt="preview">`;overlay.onclick=e=>{if(e.target===overlay||e.target.tagName==='BUTTON')overlay.remove()};document.body.append(overlay)})}
function renderMessages(items,{prepend=false,hasOlder=false,append=false}={}){
  const chatId=selected(),wasBottom=nearBottom(),oldHeight=msgs.scrollHeight,oldTop=msgs.scrollTop;msgs.querySelector('.load-older')?.remove();
  if(!prepend&&!append)store.resetMessages(chatId,[]);
  const frag=document.createDocumentFragment();for(const m of items){const id=String(m.id||m.event_id||'');if(id&&store.hasMessage(chatId,id))continue;if(id)store.addMessage(chatId,m);frag.append(messageNode(m))}
  if(prepend)msgs.prepend(frag);else if(append)msgs.append(frag);else{msgs.innerHTML='';msgs.append(frag)}
  if(hasOlder){const b=document.createElement('button');b.className='load-older';b.textContent='↑ Muat pesan sebelumnya';b.onclick=loadOlder;msgs.prepend(b)}
  bindImagePreview();if(prepend)msgs.scrollTop=msgs.scrollHeight-oldHeight+oldTop;else if(!append||wasBottom)msgs.scrollTop=msgs.scrollHeight;else showNewMessageButton();
}
function showNewMessageButton(){let b=$('#newMessageBtn');if(!b){b=document.createElement('button');b.id='newMessageBtn';b.className='new-message-btn';b.textContent='↓ Pesan Baru';b.onclick=()=>{msgs.scrollTop=msgs.scrollHeight;b.remove()};$('.conversation-pane').append(b)}}
function setMode(mode,status='ACTIVE'){const human=mode==='HUMAN' /* composer.disabled depends on HUMAN mode */,closed=status==='CLOSED';$('#mode').className='state-pill '+(human?'human':'ai');$('#mode').textContent=human?'HUMAN TAKEOVER':'AI ACTIVE';composer.disabled=mode!=='HUMAN'||closed;$('#sendBtn').disabled=!human||closed;$('#imageInput').disabled=!human||closed;$('#attachLabel').classList.toggle('disabled',!human||closed);$('#takeoverBtn').classList.toggle('hidden',human||closed);$('#returnAiBtn').classList.toggle('hidden',!human||closed);$('#endBtn').disabled=closed;const cs=$('#composerStatus');cs.className='composer-status '+(human?'human-mode':'ai-mode');cs.innerHTML=human?'<span class="composer-status-dot"></span><span><b>Human Take Over aktif.</b> Anda membalas sebagai CS.</span>':'<span class="composer-status-dot"></span><span><b>AI aktif.</b> Take Over untuk membalas manual.</span>';if(human)setTimeout(()=>composer.focus(),50)}
function field(label,value){return value?`<div class="info-line"><span>${esc(label)}</span><b>${esc(String(value))}</b></div>`:''}
function renderSide(c,st){const wf=st.workflow_type||c.workflow_type;const takeover=modeOf(c)==='HUMAN';$('#customerInfo').innerHTML=field('Nama',c.customer_name||'Tanpa nama')+field('Email',c.customer_email)+field('Chat ID / Session',c.chat_id)+field('Status',modeOf(c)==='HUMAN'?'HUMAN TAKEOVER':'AI ACTIVE')+field('Butuh Balasan',c.needs_reply?'YA':'TIDAK')+field('Last Event',fmtDate(c.last_event_at));$('#workflowInfo').innerHTML=wf?(field('Jenis',wf)+field('State',st.workflow_state||c.workflow_state||'Aktif')):'<div class="empty compact">Belum ada workflow aktif.</div>';$('#takeoverInfo').innerHTML=takeover?(field('Reason',st.takeover_reason||c.takeover_reason||'Manual')+field('Since',fmtDate(st.takeover_at||c.takeover_at))):'<div class="empty compact">Tidak ada takeover aktif.</div>'}
function detailError(message){msgs.innerHTML=`<div class="request-error"><b>Gagal memuat percakapan</b><span>${esc(message||'Terjadi gangguan jaringan.')}</span><button id="retryDetail" class="btn ghost">COBA LAGI</button></div>`;$('#retryDetail')?.addEventListener('click',()=>selected()&&openChat(selected()))}
async function openChat(id){
  id=String(id);store.select(id);document.querySelector('.conversations-page').classList.add('chat-open');renderRows();state.detailAbort?.abort();const ctl=new AbortController();state.detailAbort=ctl;const version=++state.detailVersion;state.messageAfterId=0;store.clearMessages(id);clearTimeout(state.messageTimer);msgs.innerHTML='<div class="chat-list-loading"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
  try{const r=await api(`/api/conversations/${encodeURIComponent(id)}?limit=50`,{signal:ctl.signal,timeout:8000});if(version!==state.detailVersion||selected()!==id)return;const c=r.conversation;if(!c||String(c.chat_id)!==id)throw new Error('DETAIL_CONVERSATION_MISMATCH');store.upsert(c);renderRows();const st=r.state||{};state.messageCursor=r.messages?.beforeId||null;state.messageAfterId=Number(r.messages?.lastId||r.items?.at(-1)?.id||0);renderMessages(r.items||[],{hasOlder:Boolean(r.messages?.hasOlder)});$('#chatName').textContent=c.customer_name||id;$('#chatSession').textContent=id;$('#copySession').classList.remove('hidden');$('#conversationAvatar').textContent=(c.customer_name||'?').slice(0,1).toUpperCase();setMode(modeOf(c),String(c.status||'ACTIVE').toUpperCase());renderSide(c,st);scheduleMessagePoll();
  }catch(e){if(e.name==='AbortError')return;if(version!==state.detailVersion||selected()!==id)return;detailError(e.message);setConnection(navigator.onLine?'RECONNECTING':'OFFLINE')}
}
async function loadOlder(){const id=selected();if(!id||!state.messageCursor||state.loadingOlder)return;state.loadingOlder=true;const b=msgs.querySelector('.load-older');if(b){b.disabled=true;b.textContent='Memuat...'};try{const r=await api(`/api/conversations/${encodeURIComponent(id)}?limit=50&beforeId=${encodeURIComponent(state.messageCursor)}`,{timeout:8000});if(selected()!==id)return;state.messageCursor=r.messages?.beforeId||null;renderMessages(r.items||[],{prepend:true,hasOlder:Boolean(r.messages?.hasOlder)})}catch(e){toast(e.message,'error')}finally{state.loadingOlder=false}}
async function pollMessages(){const id=selected();if(!id||state.messageBusy||document.hidden)return;state.messageBusy=true;try{const r=await api(`/api/conversations/${encodeURIComponent(id)}/messages?afterId=${state.messageAfterId}&limit=50`,{timeout:8000});if(selected()!==id)return;if(r.conversation?.status==='closed'||r.conversation?.visible_in_inbox===false){store.remove(id);renderRows();clearConversation('Percakapan telah ditutup.');return}const items=r.items||[];if(items.length){state.messageAfterId=Number(items.at(-1).id||state.messageAfterId);renderMessages(items,{append:true});fetchList({silent:true,reason:'poll'})}if(r.conversation){setMode(modeOf(r.conversation),String(r.conversation.status||'ACTIVE').toUpperCase());renderSide(r.conversation,r.state||{})}setConnection('LIVE')}catch(e){if(e.name!=='AbortError')setConnection(navigator.onLine?'RECONNECTING':'OFFLINE')}finally{state.messageBusy=false}}
function scheduleMessagePoll(){clearTimeout(state.messageTimer);if(!selected())return;state.messageTimer=setTimeout(async()=>{await pollMessages();scheduleMessagePoll()},document.hidden?12000:2200)}
function clearConversation(message='Pilih percakapan dari Inbox.'){$('#chatName').textContent='Pilih percakapan';$('#chatSession').textContent='Tidak ada chat dipilih';$('#copySession').classList.add('hidden');$('#conversationAvatar').textContent='?';$('#mode').className='state-pill neutral';$('#mode').textContent='—';composer.disabled=true;$('#sendBtn').disabled=true;$('#takeoverBtn').classList.remove('hidden');$('#returnAiBtn').classList.add('hidden');$('#customerInfo').innerHTML='<div class="empty compact">Pilih percakapan.</div>';$('#workflowInfo').innerHTML='';$('#takeoverInfo').innerHTML='';msgs.innerHTML=`<div class="conversation-empty-state"><div class="empty-icon">◌</div><b>${esc(message)}</b><span>Pilih member dari Inbox untuk melihat dan membalas chat.</span></div>`;clearTimeout(state.messageTimer)}
async function loadShortcuts(q){
  state.shortcutAbort?.abort();const ctl=new AbortController(),version=++state.shortcutVersion;state.shortcutAbort=ctl;
  try{const r=await api(`/api/canned/shortcut?q=${encodeURIComponent(q)}&limit=20`,{timeout:8000,signal:ctl.signal});if(version!==state.shortcutVersion)return;state.shortcuts=r.items||[]}
  catch(e){if(e.name!=='AbortError'&&version===state.shortcutVersion)state.shortcuts=[]}
  finally{if(state.shortcutAbort===ctl)state.shortcutAbort=null}
}
function token(){const p=composer.selectionStart??composer.value.length,m=composer.value.slice(0,p).match(/(?:^|\s)(#[\w-]*)$/);return m?{q:m[1],start:p-m[1].length,end:p}:null}
function renderShortcutMenu(){const t=token(),box=$('#shortcutMenu');if(!t){box.classList.add('hidden');return}const q=t.q.slice(1).toLowerCase(),rows=state.shortcuts.filter(s=>`${s.shortcut||''} ${s.content||''}`.toLowerCase().includes(q)).slice(0,20);state.shortcutIndex=Math.min(state.shortcutIndex,Math.max(0,rows.length-1));box.innerHTML=rows.map((s,i)=>`<div class="shortcut-item ${i===state.shortcutIndex?'active':''}" data-i="${i}"><b>${esc(s.shortcut)}</b><div class="muted">${esc(s.title||s.content?.slice(0,90)||'')}</div></div>`).join('');box.classList.toggle('hidden',!rows.length);box._items=rows;box.querySelectorAll('[data-i]').forEach(el=>el.onclick=()=>chooseShortcut(rows[Number(el.dataset.i)]))}
function chooseShortcut(s){const t=token();if(!t||!s)return;composer.value=composer.value.slice(0,t.start)+(s.content||'')+composer.value.slice(t.end);$('#shortcutMenu').classList.add('hidden');autoGrow();composer.focus()}
composer.oninput=null;
let shortcutDebounce;composer.addEventListener('input',()=>{autoGrow();clearTimeout(shortcutDebounce);const t=token();if(!t){$('#shortcutMenu').classList.add('hidden');return}shortcutDebounce=setTimeout(async()=>{await loadShortcuts(t.q.slice(1));state.shortcutIndex=0;renderShortcutMenu()},120)});
composer.addEventListener('keydown',e=>{const box=$('#shortcutMenu');if(!box.classList.contains('hidden')){if(e.key==='ArrowDown'){e.preventDefault();state.shortcutIndex=Math.min((box._items?.length||1)-1,state.shortcutIndex+1);renderShortcutMenu();return}if(e.key==='ArrowUp'){e.preventDefault();state.shortcutIndex=Math.max(0,state.shortcutIndex-1);renderShortcutMenu();return}if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();chooseShortcut(box._items?.[state.shortcutIndex]);return}if(e.key==='Escape'){box.classList.add('hidden');return}}if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
async function send(){const id=selected();if(!id||composer.disabled||state.sendBusy)return;if(state.imageFile)return sendImage(state.imageFile);const text=composer.value.trim();if(!text)return;state.sendBusy=true;const b=$('#sendBtn');b.disabled=true;composer.disabled=true;composer.value='';autoGrow();try{await api(`/api/conversations/${encodeURIComponent(id)}/send`,{method:'POST',body:JSON.stringify({text}),timeout:12000});await pollMessages();await fetchList({silent:true})}catch(e){if(selected()===id&&!composer.value)composer.value=text;autoGrow();toast(e.message,'error')}finally{state.sendBusy=false;if(selected()===id&&modeOf(store.get(id))!=='AI'){composer.disabled=false;b.disabled=false;composer.focus()}}}
async function sendImage(file){const id=selected();if(!id||!file||state.sendBusy)return;state.sendBusy=true;const b=$('#sendBtn');b.disabled=true;try{await api(`/api/conversations/${encodeURIComponent(id)}/image`,{method:'POST',headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name||'image')},body:file,timeout:15000});removeImage();toast('Gambar terkirim');await pollMessages()}catch(e){toast(e.message,'error')}finally{state.sendBusy=false;if(selected()===id&&modeOf(store.get(id))!=='AI')b.disabled=false}}
function removeImage(){state.imageFile=null;$('#imagePreview').classList.add('hidden');$('#imagePreview').innerHTML=''}
function previewImage(file){if(!file?.type?.startsWith('image/'))return;state.imageFile=file;const url=URL.createObjectURL(file);$('#imagePreview').innerHTML=`<img src="${url}" alt="preview"><div><b>${esc(file.name||'clipboard-image.png')}</b><div class="muted">${Math.round(file.size/1024)} KB</div></div><button class="btn ghost" id="removeImage">Hapus</button>`;$('#imagePreview').classList.remove('hidden');$('#removeImage').onclick=()=>{URL.revokeObjectURL(url);removeImage()}}
$('#imageInput').onchange=e=>{const f=e.target.files?.[0];if(f)previewImage(f);e.target.value=''};composer.addEventListener('paste',e=>{const f=[...e.clipboardData.files].find(x=>x.type.startsWith('image/'));if(f){e.preventDefault();previewImage(f)}});$('#sendBtn').onclick=send;
async function action(btn,label,fn){if(btn.disabled)return;setBusy(btn,true,label);try{await fn()}catch(e){toast(e.message,'error')}finally{setBusy(btn,false)}}
$('#takeoverBtn').onclick=()=>action($('#takeoverBtn'),'Taking Over...',async()=>{const id=selected();if(!id)return;await api(`/api/conversations/${encodeURIComponent(id)}/takeover`,{method:'POST',body:'{}',timeout:12000});if(selected()===id)await openChat(id);toast('Human Take Over aktif')});
$('#returnAiBtn').onclick=()=>action($('#returnAiBtn'),'Returning...',async()=>{const id=selected();if(!id)return;await api(`/api/conversations/${encodeURIComponent(id)}/enable-ai`,{method:'POST',body:'{}',timeout:15000});if(selected()===id)await openChat(id);toast('Chat dikembalikan ke AI')});
$('#endBtn').onclick=()=>action($('#endBtn'),'Ending...',async()=>{const id=selected();if(!id||!confirm('Akhiri chat ini di LiveChat?'))return;await api(`/api/conversations/${encodeURIComponent(id)}/end`,{method:'POST',body:'{}',timeout:15000});if(selected()!==id)return;store.remove(id);renderRows();clearConversation('Percakapan telah diakhiri.');toast('Chat berhasil diakhiri');fetchList({silent:true})});
function navigateChatByKeyboard(direction){
  const rows=[...list.querySelectorAll('.chat-row[data-id]')];
  if(!rows.length)return false;
  let idx=rows.findIndex(x=>x.dataset.id===selected());
  if(idx<0)idx=direction>0?-1:0;
  idx=Math.max(0,Math.min(rows.length-1,idx+direction));
  const row=rows[idx];if(!row)return false;
  row.scrollIntoView({block:'nearest'});
  openChat(row.dataset.id);
  return true;
}
window.addEventListener('keydown',e=>{
  if(!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;
  const active=document.activeElement,tag=String(active?.tagName||'').toUpperCase();
  if(['INPUT','TEXTAREA','SELECT'].includes(tag)||active?.isContentEditable)return;
  if(navigateChatByKeyboard(e.key==='ArrowDown'?1:-1))e.preventDefault();
});
$('#jumpNewest').onclick=()=>{
  const first=list.querySelector('.chat-row[data-id]');
  list.scrollTo({top:0,behavior:'smooth'});
  if(first&&!selected())openChat(first.dataset.id);
};
let searchTimer;$('#chatSearch').oninput=e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=e.target.value.trim();state.cursor=null;fetchList({reason:'search'})},300)};document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.filter=b.dataset.filter;state.cursor=null;fetchList({reason:'filter'})});
$('#refreshChats').onclick=()=>fetchList({reason:'refresh'});$('#loadMoreChats').onclick=()=>fetchList({append:true,reason:'pagination'});$('#copySession').onclick=async()=>{if(!selected())return;await navigator.clipboard?.writeText(selected());toast('Session ID disalin')};$('#toggleDetails').onclick=()=>{if(innerWidth>1320)document.querySelector('.conversations-page').classList.toggle('details-collapsed');else $('#customerPanel').classList.toggle('open')};$('#closeDetails').onclick=()=>{if(innerWidth>1320)document.querySelector('.conversations-page').classList.add('details-collapsed');else $('#customerPanel').classList.remove('open')};$('#mobileBack').onclick=()=>{document.querySelector('.conversations-page').classList.remove('chat-open');$('#customerPanel').classList.remove('open')};
clearConversation();await fetchList({reason:'initial'});scheduleListPoll();
