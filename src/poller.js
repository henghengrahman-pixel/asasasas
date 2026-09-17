import crypto from 'node:crypto';
import { config } from './config.js';
import { extractChatEvents } from './livechat.js';
import { normalizeText, detectIntent } from './normalizer.js';
import { processCustomerMessage, processGreetingTrigger } from './engine.js';
import * as db from './db.js';
import { isGreetingTriggerMessage } from './greeting.js';

let loopStarted=false, inFlight=false, timer=null, deepTimer=null, lastTick=null, lastSuccess=null, lastError=null, lastResult=null, paused=false;
const summaryFingerprints = new Map();
const trackedChatIds = new Set();
const deepState={status:'IDLE',running:false,generation:0,completedGeneration:0,lastSuccess:null,lastError:null,pagesFetched:0,inventorySize:0,inventoryComplete:false,lastDurationMs:0};
export function pollerStatus(){ return {running:inFlight,started:loopStarted,inFlight,paused,lastTick,lastSuccess,lastError,lastResult,mode:config.lcSyncMode,pollMs:config.lcPollMs,trackedChats:trackedChatIds.size,deepSyncRunning:deepState.running,deepStatus:deepState.status,deepGeneration:deepState.generation,deepCompletedGeneration:deepState.completedGeneration,deepLastSuccess:deepState.lastSuccess,deepLastError:deepState.lastError,inventoryComplete:deepState.inventoryComplete,pagesFetched:deepState.pagesFetched,inventorySize:deepState.inventorySize}; }

function senderType(ev, chat){
  const t=String(ev.authorType||'').toLowerCase();
  if (t.includes('customer')) return 'customer';
  if (t.includes('agent')) return 'agent';
  const u=(chat?.users||[]).find(x=>String(x.id||'')===String(ev.authorId||''));
  const ut=String(u?.type||'').toLowerCase();
  if (ut.includes('customer')) return 'customer';
  if (ut.includes('agent')) return 'agent';
  return 'unknown';
}

function summaryFingerprint(summary){ return crypto.createHash('sha1').update(JSON.stringify(summary||{})).digest('hex'); }
function ageSeconds(iso){ const t=Date.parse(iso||''); return Number.isFinite(t) ? Math.max(0,(Date.now()-t)/1000) : Infinity; }
function isWelcomeTriggerEvent(ev){ return Boolean(ev && isGreetingTriggerMessage(ev.text)); }
function greetingTriggerAgeLimit(){ return Math.max(Number(config.greetingTriggerMaxAgeSeconds||0),600); }


async function ingestAgentEvent(chatId, ev, chat, livechat, {allowTakeover=true,allowGreetingTrigger=true}={}) {
  const ours=await db.outboundLooksLikeOurs(chatId,ev.eventId,ev.text);
  const autoGreetingTrigger=!ours && isGreetingTriggerMessage(ev.text);
  const senderType=ours?'ai':autoGreetingTrigger?'system':'agent';
  const inserted=await db.insertMessage({chatId,eventId:ev.eventId,senderType,authorId:ev.authorId,text:ev.text,normalizedText:normalizeText(ev.text),intent:autoGreetingTrigger?'GREETING_TRIGGER':detectIntent(ev.text),createdAt:ev.createdAt,attachments:ev.attachments||[]});
  if (inserted && autoGreetingTrigger && allowGreetingTrigger && ageSeconds(ev.createdAt) <= greetingTriggerAgeLimit()) {
    await processGreetingTrigger({chatId,eventId:ev.eventId,threadId:ev.threadId,text:ev.text,createdAt:ev.createdAt,livechat});
  }
  if (inserted && !ours && !autoGreetingTrigger) {
    // Human CS replies become learning candidates. They are NOT auto-approved;
    // admin reviews them in "Belajar dari CS" so one bad answer cannot poison the bot.
    await db.captureHumanReplyLearning({chatId,eventId:ev.eventId,responseText:ev.text}).catch(()=>{});
  }
  if (inserted && allowTakeover && !ours && !autoGreetingTrigger && ageSeconds(ev.createdAt) <= config.humanTakeoverMinutes*60) {
    await db.setHumanTakeover(chatId,'agent_reply_livechat');
  }
  return inserted;
}

async function ensureFreshWelcomeGreeting(chatId, events, livechat){
  const fresh=[...(events||[])].reverse().find(ev=>
    isWelcomeTriggerEvent(ev) && ageSeconds(ev.createdAt)<=greetingTriggerAgeLimit()
  );
  if(!fresh) return null;

  // Session-boundary preflight. Persist the banner BEFORE any customer event is
  // classified so current-session history can never leak old DP/WD/proof state.
  await db.insertMessage({
    chatId,eventId:fresh.eventId,senderType:'system',authorId:fresh.authorId||'system',
    text:fresh.text,normalizedText:normalizeText(fresh.text),intent:'GREETING_TRIGGER',
    createdAt:fresh.createdAt,attachments:fresh.attachments||[]
  }).catch(()=>{});

  // Idempotent by banner event id. This may be called every sync; only a genuinely
  // new System banner can claim and send a greeting.
  return processGreetingTrigger({
    chatId,
    eventId:fresh.eventId,
    threadId:fresh.threadId,
    text:fresh.text,
    createdAt:fresh.createdAt,
    livechat
  }).catch(async e=>{
    await db.logError('poller','WELCOME_GREETING_RETRY_FAILED',e.message,{chatId,eventId:fresh.eventId}).catch(()=>{});
    return {error:e.message};
  });
}

async function bootstrapChat(chatId, chat, events, livechat) {
  let inserted=0, processed=0;
  // IMPORTANT: establish/reset the new session before reading any member intent.
  await ensureFreshWelcomeGreeting(chatId,events,livechat);
  const latest=events.at(-1);
  for (const ev of events.slice(0,-1)) {
    const type=senderType(ev,chat);
    // System welcome text has absolute priority over author classification. LiveChat
    // can occasionally expose the banner with an unexpected author type.
    if (isWelcomeTriggerEvent(ev)) {
      if (await ingestAgentEvent(chatId,ev,chat,livechat,{allowTakeover:false,allowGreetingTrigger:true})) inserted++;
    } else if (type==='customer') {
      if (await db.insertMessage({chatId,eventId:ev.eventId,senderType:'customer',authorId:ev.authorId,text:ev.text,normalizedText:normalizeText(ev.text),intent:detectIntent(ev.text),createdAt:ev.createdAt,attachments:ev.attachments||[]})) inserted++;
    } else if (type==='agent') {
      if (await ingestAgentEvent(chatId,ev,chat,livechat,{allowTakeover:true,allowGreetingTrigger:true})) inserted++;
    }
  }
  if (latest) {
    const type=senderType(latest,chat);
    if (isWelcomeTriggerEvent(latest)) {
      if (await ingestAgentEvent(chatId,latest,chat,livechat,{allowTakeover:false,allowGreetingTrigger:true})) inserted++;
    } else if (type==='customer' && ageSeconds(latest.createdAt) <= config.bootstrapReplyMaxAgeSeconds) {
      const r=await processCustomerMessage({chatId,eventId:latest.eventId,threadId:latest.threadId,text:latest.text,createdAt:latest.createdAt,livechat,attachments:latest.attachments||[]});
      if (!r?.skipped) processed++;
      if (r?.skipped!=='duplicate') inserted++;
    } else if (type==='customer') {
      if (await db.insertMessage({chatId,eventId:latest.eventId,senderType:'customer',authorId:latest.authorId,text:latest.text,normalizedText:normalizeText(latest.text),intent:detectIntent(latest.text),createdAt:latest.createdAt})) inserted++;
    } else if (type==='agent') {
      if (await ingestAgentEvent(chatId,latest,chat,livechat,{allowTakeover:true,allowGreetingTrigger:true})) inserted++;
    }
  }
  await db.markBootstrapped(chatId);
  return {inserted,processed};
}

export async function syncOnce(livechat,{manual=false}={}){
  if (inFlight) return {skipped:'already_running'};
  inFlight=true; lastError=null; const syncStarted=Date.now(); lastTick=new Date(syncStarted).toISOString();
  try {
    if (!manual) {
      const enabled=Boolean(await db.getSetting('system_enabled',true));
      if (!enabled) { paused=true; lastSuccess=new Date().toISOString(); lastResult={ok:true,paused:true,skipped:'system_off'}; return lastResult; }
    }
    paused=false;
    const data=await livechat.listChats({paginate:false});
    const rawChats=data?._normalizedChats || data?.chats_summary || data?.chats || [];
    const chats=livechat.filterInbox(rawChats);
    // Do not clear the inbox before rebuilding it. The dashboard polls independently;
    // clearing first caused a visible empty/partial list while a sync was in progress.
    const seenChatIds=[];
    let newMessages=0, processed=0, fetched=0, unchanged=0, fetchErrors=0, bootstrapped=0;

    for (const [rank, summary] of chats.entries()) {
      if (!summary?.id) continue;
      const chatId=String(summary.id);
      seenChatIds.push(chatId); trackedChatIds.add(chatId);
      const fp=summaryFingerprint(summary);
      const oldFp=summaryFingerprints.get(chatId);
      const state={...livechat.chatState(summary),rank};
      await db.upsertConversation(summary,{visible:true,state});
      await db.updateTypingFromSummary(chatId,summary).catch(()=>{});
      const dbState=await db.getConversationState(chatId);

      // If already bootstrapped and summary unchanged, no API detail fetch is needed.
      if (dbState?.bootstrapped_at && Number(dbState?.message_count||0) > 0 && oldFp === fp) { unchanged++; continue; }

      let chat=summary;
      if (!Array.isArray(chat?.threads) || chat.threads.length===0) {
        try { chat=await livechat.getChat(chatId, summary); fetched++; }
        catch (e) { fetchErrors++; await db.logError('poller','GET_CHAT_FAILED',e.message,{chatId}); continue; }
      }
      if (!chat?.id) continue;
      await db.upsertConversation(chat,{visible:true,state});
      const events=extractChatEvents(chat);

      if (!events.length) {
        await db.clearBootstrapped(chatId);
        await db.logError('poller','EMPTY_CHAT_DETAIL','LiveChat get_chat returned no readable message events',{chatId,diagnostics:livechat.chatDiagnostics(chat)});
        summaryFingerprints.delete(chatId);
        continue;
      }

      // CRITICAL ORDERING: System banner/session boundary must be resolved BEFORE any
      // customer message in this snapshot. This prevents stale workflow/proof/history
      // from producing a wrong first reply and prevents greeting from arriving last.
      await ensureFreshWelcomeGreeting(chatId,events,livechat);

      if (!dbState?.bootstrapped_at || Number(dbState?.message_count||0)===0) {
        const b=await bootstrapChat(chatId,chat,events,livechat);
        newMessages+=b.inserted; processed+=b.processed; bootstrapped++;
        summaryFingerprints.set(chatId,fp);
        continue;
      }

      // Coalesce message bursts: ingest every newly seen event, but invoke AI only for
      // the newest customer event when it is also the newest event in the chat. This
      // prevents 2-4 AI replies when a member sends several short fragments quickly.
      const unseen=[];
      for (const ev of events) if (!(await db.messageExists(chatId,ev.eventId))) unseen.push(ev);
      const newest=unseen.at(-1) || null;
      for (const ev of unseen) {
        const type=senderType(ev,chat);
        const isNewest = newest && ev.eventId===newest.eventId;
        if (isWelcomeTriggerEvent(ev)) {
          if (await ingestAgentEvent(chatId,ev,chat,livechat,{allowTakeover:false,allowGreetingTrigger:true})) newMessages++;
        } else if (type==='customer' && isNewest) {
          // Debounce burst pesan member. Jangan tandai event sebagai processed sebelum member berhenti sejenak.
          if (ageSeconds(ev.createdAt)*1000 < config.memberDebounceMs) {
            summaryFingerprints.delete(chatId);
            continue;
          }
          const result=await processCustomerMessage({chatId,eventId:ev.eventId,threadId:ev.threadId,text:ev.text,createdAt:ev.createdAt,livechat,attachments:ev.attachments||[]});
          if (!result?.skipped) processed++;
          if (result?.skipped!=='duplicate') newMessages++;
        } else if (type==='customer') {
          if (await db.insertMessage({chatId,eventId:ev.eventId,senderType:'customer',authorId:ev.authorId,text:ev.text,normalizedText:normalizeText(ev.text),intent:detectIntent(ev.text),createdAt:ev.createdAt,attachments:ev.attachments||[]})) newMessages++;
        } else if (type==='agent') {
          if (await ingestAgentEvent(chatId,ev,chat,livechat,{allowTakeover:true,allowGreetingTrigger:true})) newMessages++;
        }
      }
      await ensureFreshWelcomeGreeting(chatId,events,livechat);
      if (!newest || await db.messageExists(chatId,newest.eventId)) summaryFingerprints.set(chatId,fp);
      else summaryFingerprints.delete(chatId);
    }
    // Fast polling is intentionally NON-authoritative: it only sees the recent first page.
    // Never hide conversations from a partial inventory. Background deep sync owns reconciliation.
    lastSuccess=new Date().toISOString();
    lastResult={ok:true,listSource:data?._listSource||'unknown',rawChats:rawChats.length,chats:chats.length,fetched,unchanged,fetchErrors,bootstrapped,newMessages,processed,pagesFetched:data?._pagesFetched||1,inventoryComplete:Boolean(data?._inventoryComplete)};
    await db.setIntegrationHealth('livechat_poll',{status:'OK',latencyMs:Date.now()-syncStarted,meta:{chats:chats.length,newMessages,processed,fetchErrors}}).catch(()=>{});
    return lastResult;
  } catch(e){
    lastError=e.message;
    await db.setIntegrationHealth('livechat_poll',{status:'ERROR',latencyMs:Date.now()-syncStarted,error:e.message}).catch(()=>{});
    await db.logError('poller','SYNC_FAILED',e.message);
    throw e;
  }
  finally { inFlight=false; }
}

async function mapBounded(items,concurrency,fn){
  const list=Array.from(items||[]); let next=0;
  const workers=Array.from({length:Math.min(Math.max(1,Number(concurrency)||1),list.length||1)},async()=>{
    while(true){ const i=next++; if(i>=list.length)return; await fn(list[i],i); }
  });
  await Promise.all(workers);
}

export async function deepSyncOnce(livechat){
  if(deepState.running) return {skipped:'already_running',generation:deepState.generation};
  const generation=deepState.generation+1;
  deepState.generation=generation; deepState.running=true; deepState.status='RUNNING'; deepState.lastError=null; deepState.inventoryComplete=false;
  const started=Date.now();
  try{
    const data=await livechat.listChats({paginate:true,maxPages:10000,retries:2});
    const rawChats=data?._normalizedChats || data?.chats_summary || data?.chats || [];
    deepState.pagesFetched=Number(data?._pagesFetched||1); deepState.inventorySize=rawChats.length;
    if(data?._inventoryComplete!==true){
      const e=new Error(`LIVECHAT_INVENTORY_PARTIAL:${data?._paginationStopReason||'unknown'}`); e.code='LIVECHAT_INVENTORY_PARTIAL'; throw e;
    }
    const active=livechat.filterInbox(rawChats);
    const activeIds=[...new Set(active.map(x=>String(x?.id||'')).filter(Boolean))];
    const activeSet=new Set(activeIds);
    const providerById=new Map(rawChats.filter(x=>x?.id!=null).map(x=>[String(x.id),x]));

    // Upsert summaries only; never fetch complete message history in the background inventory.
    await mapBounded(active,8,async(summary,rank)=>{
      if(!summary?.id)return;
      await db.upsertConversation(summary,{visible:true,state:{...livechat.chatState(summary),rank}});
    });

    // A newer generation must never be overwritten by this response.
    if(generation!==deepState.generation){ deepState.status='IDLE'; return {skipped:'stale_generation',generation}; }

    const visibleBefore=await db.getVisibleInboxConversationIds();
    const terminal=[];
    for(const id of visibleBefore){
      if(activeSet.has(id))continue;
      const summary=providerById.get(id);
      if(summary && livechat.chatActiveFlag(summary)===false) terminal.push(id);
    }
    // Provider-confirmed terminal chats preserve the existing archive workflow.
    await mapBounded(terminal,4,async id=>{ await db.markConversationEnded(id); });
    const hidden=await db.reconcileInboxVisibilityAuthoritative(activeIds);

    trackedChatIds.clear(); for(const id of activeIds) trackedChatIds.add(id);
    for(const id of [...summaryFingerprints.keys()]) if(!activeSet.has(id)) summaryFingerprints.delete(id);
    deepState.completedGeneration=generation; deepState.lastSuccess=new Date().toISOString(); deepState.inventoryComplete=true; deepState.status='COMPLETED'; deepState.lastDurationMs=Date.now()-started;
    const visibleAfter=await db.getVisibleInboxConversationIds();
    const meta={ok:true,rawChats:rawChats.length,deduplicatedChats:rawChats.length,pagesFetched:deepState.pagesFetched,inventorySize:rawChats.length,inventoryComplete:true,myActiveChats:activeIds.length,providerMyActiveChats:activeIds.length,expectedVisibleInbox:activeIds.length,actualVisibleInbox:visibleAfter.length,inboxMismatch:visibleAfter.length-activeIds.length,deepGeneration:generation,deepCompletedGeneration:generation,deepSyncRunning:false,reconciledClosed:terminal.length,reconciledHidden:hidden.length,durationMs:deepState.lastDurationMs};
    await db.setIntegrationHealth('livechat_discovery',{status:'OK',latencyMs:deepState.lastDurationMs,meta}).catch(()=>{});
    return meta;
  }catch(e){
    deepState.lastError=String(e?.message||e); deepState.inventoryComplete=false; deepState.status='FAILED'; deepState.lastDurationMs=Date.now()-started;
    await db.setIntegrationHealth('livechat_discovery',{status:'ERROR',latencyMs:deepState.lastDurationMs,error:deepState.lastError,meta:{pagesFetched:deepState.pagesFetched,inventorySize:deepState.inventorySize,inventoryComplete:false,deepGeneration:generation,deepCompletedGeneration:deepState.completedGeneration}}).catch(()=>{});
    throw e;
  }finally{ deepState.running=false; if(deepState.status==='COMPLETED') deepState.status='IDLE'; }
}

function scheduleDeep(livechat,delay){
  if(!loopStarted)return;
  if(deepTimer)clearTimeout(deepTimer);
  deepTimer=setTimeout(async()=>{
    deepTimer=null;
    try{await deepSyncOnce(livechat);}catch(e){await db.logError('poller','DEEP_SYNC_FAILED',e.message).catch(()=>{});}
    finally{ if(loopStarted)scheduleDeep(livechat,Math.max(30000,config.lcPollMs*30)); }
  },Math.max(0,delay));
  deepTimer.unref?.();
}

export function startPoller(livechat){
  if (config.lcSyncMode!=='polling' || loopStarted) return;
  loopStarted=true;
  const run=async()=>{
    if(!loopStarted)return;
    try{await syncOnce(livechat);}catch{} finally{
      if(loopStarted){timer=setTimeout(run,config.lcPollMs);timer.unref?.();}
    }
  };
  void run();
  scheduleDeep(livechat,2500);
}
export async function stopPoller({waitMs=5000}={}){
  loopStarted=false;
  if(timer)clearTimeout(timer); timer=null;
  if(deepTimer)clearTimeout(deepTimer); deepTimer=null;
  // Invalidate any deep result that completes after shutdown/restart.
  deepState.generation++;
  const until=Date.now()+waitMs;
  while((inFlight||deepState.running)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
  return !inFlight&&!deepState.running;
}
