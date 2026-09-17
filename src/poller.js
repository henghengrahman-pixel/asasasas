import crypto from 'node:crypto';
import { config } from './config.js';
import { extractChatEvents } from './livechat.js';
import { normalizeText, detectIntent } from './normalizer.js';
import { processCustomerMessage, processGreetingTrigger } from './engine.js';
import * as db from './db.js';
import { isGreetingTriggerMessage } from './greeting.js';

let running=false, timer=null, lastTick=null, lastError=null, lastResult=null, paused=false;
const summaryFingerprints = new Map();
export function pollerStatus(){ return {running,paused,lastTick,lastError,lastResult,mode:config.lcSyncMode,pollMs:config.lcPollMs,trackedChats:summaryFingerprints.size}; }

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
  if (!manual) {
    const enabled=Boolean(await db.getSetting('system_enabled',true));
    if (!enabled) { paused=true; lastResult={ok:true,paused:true,skipped:'system_off'}; return lastResult; }
  }
  paused=false;
  if (running) return {skipped:'already_running'};
  running=true; lastError=null; const syncStarted=Date.now();
  try {
    const data=await livechat.listChats();
    const rawChats=data?._normalizedChats || data?.chats_summary || data?.chats || [];
    const chats=livechat.filterInbox(rawChats);
    // Do not clear the inbox before rebuilding it. The dashboard polls independently;
    // clearing first caused a visible empty/partial list while a sync was in progress.
    const seenChatIds=[];
    let newMessages=0, processed=0, fetched=0, unchanged=0, fetchErrors=0, bootstrapped=0;

    for (const [rank, summary] of chats.entries()) {
      if (!summary?.id) continue;
      const chatId=String(summary.id);
      seenChatIds.push(chatId);
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
    // Reconcile only after the whole LiveChat list has been processed. Missing chats get a
    // short grace period so one incomplete provider response cannot make the LC-style inbox blink/disappear.
    await db.reconcileInboxVisibility(seenChatIds,25);
    lastTick=new Date().toISOString();
    lastResult={ok:true,listSource:data?._listSource||'unknown',rawChats:rawChats.length,chats:chats.length,fetched,unchanged,fetchErrors,bootstrapped,newMessages,processed};
    await db.setIntegrationHealth('livechat_poll',{status:'OK',latencyMs:Date.now()-syncStarted,meta:{chats:chats.length,newMessages,processed,fetchErrors}}).catch(()=>{});
    return lastResult;
  } catch(e){
    lastError=e.message;
    await db.setIntegrationHealth('livechat_poll',{status:'ERROR',latencyMs:Date.now()-syncStarted,error:e.message}).catch(()=>{});
    await db.logError('poller','SYNC_FAILED',e.message);
    throw e;
  }
  finally { running=false; }
}

export function startPoller(livechat){
  if (config.lcSyncMode!=='polling') return;
  const run=async()=>{ try{await syncOnce(livechat);}catch{} finally{timer=setTimeout(run,config.lcPollMs);} };
  timer=setTimeout(run,1200);
}
export async function stopPoller({waitMs=5000}={}){ if(timer) clearTimeout(timer); timer=null; const until=Date.now()+waitMs; while(running&&Date.now()<until)await new Promise(r=>setTimeout(r,50)); return !running; }
