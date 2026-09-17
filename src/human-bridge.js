import { TelegramClient } from './telegram.js';
import { decryptSecret } from './secure-store.js';
import * as db from './db.js';
import { CATEGORIES, bridgeCategory, isTelegramBridgeCategory } from './bridge-category.js';
import { config } from './config.js';
import { extractUserIdFromText, extractRequestedUserIdFromText } from './user-id.js';
let running=false, maintenanceRunning=false, stop=false, answerHandler=null, actionHandler=null, currentBotUser=null, currentBotToken='';
let lastError=null,lastPollAt=null,lastHandledAt=null,lastBacklogScanAt=0,lastSlaScanAt=0;

function routeFor(settings,category){
  const routes=settings.routes&&typeof settings.routes==='object'?settings.routes:{};
  const aliases={
    RESET_PASSWORD:['RESET_PASSWORD','RESET','PASSWORD'],
    WD_PROBLEM:['WD_PROBLEM','WD','WITHDRAW'],
    DEPOSIT_PROBLEM:['DEPOSIT_PROBLEM','DEPOSIT','DP'],
    BONUS:['BONUS'],
    ISSUE:['ISSUE','GANGGUAN']
  }[category]||[category,'ISSUE'];
  let r={};
  for(const key of aliases){
    const candidate=routes[key];
    if(candidate&&typeof candidate==='object'&&(String(candidate.chatId||'').trim()||String(candidate.topicId||'').trim())){ r=candidate; break; }
  }
  if(!String(r.chatId||'').trim() && category!=='ISSUE'){
    const issue=routes.ISSUE||routes.GANGGUAN||{};
    if(String(issue.chatId||'').trim()) r=issue;
  }
  return {chatId:String(r.chatId||settings.defaultChatId||'').trim(),topicId:String(r.topicId||'').trim()||null};
}
function clean(s,max=1200){ return String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').trim().slice(0,max); }

function formatWibTime(value=new Date()){
  try{
    return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(value).replace(' pukul ',' ')+' WIB';
  }catch{ return new Date(value).toISOString(); }
}

async function telegramTicketIdentity(ticket,request){
  const chatId=String(request?.chat_id||ticket?.chat_id||'').trim();
  const identity=chatId?await db.getConversationIdentity(chatId).catch(()=>null):null;
  const workflow=chatId?await db.getConversationWorkflow(chatId).catch(()=>null):null;
  const ctx=chatId?await db.getContext(chatId,30).catch(()=>[]):[];
  const wd=workflow?.workflow_data&&typeof workflow.workflow_data==='object'?workflow.workflow_data:{};
  let userId=clean(wd.userId||wd.user_id||wd.memberUserId||wd.member_user_id||wd.username||'',80);
  if(!userId){
    const texts=[request?.member_message,request?.ai_question,...ctx.slice().reverse().filter(x=>String(x?.sender_type||'').toLowerCase()!=='system').map(x=>x?.text)].filter(Boolean);
    for(const text of texts){
      userId=extractUserIdFromText(text)||'';
      if(userId) break;
    }
    if(!userId){
      for(const text of texts){
        userId=extractRequestedUserIdFromText(text)||'';
        if(userId) break;
      }
    }
  }
  return {
    lcName:clean(identity?.customer_name||'-',120)||'-',
    chatId:clean(chatId||'-',160)||'-',
    userId:clean(userId||'-',80)||'-'
  };
}

async function completedTicketText({ticket,request,displayAction,who}){
  const info=await telegramTicketIdentity(ticket,request);
  return `✅ ${ticket.ticket_code} — ${clean(displayAction,120)}\n👤 Nama LC: ${info.lcName}\n🆔 LiveChat ID: ${info.chatId}\n🔑 User ID: ${info.userId}\nStatus: ${clean(displayAction,120)}\nDiproses oleh: ${clean(who,120)}\nWaktu: ${formatWibTime()}`;
}
function ticketText(ticket,request,attachmentUrls=[],customerName=''){
  const body=clean(request.ai_question||request.member_message||'Mohon dibantu cek.',1800);
  // Bukti gambar dikirim sebagai Telegram photo, bukan URL mentah di isi ticket.
  const files='';
  // Initial Telegram ticket intentionally stays simple like normal CS chat.
  // Routing safety is kept internally using telegram message_id -> ticket_id -> livechat_chat_id.
  const name=clean(customerName||'-',120)||'-';
  return `🔔 ${ticket.ticket_code}\n👤 Nama LC: ${name}\nKategori: ${ticket.category}\n\n${body}${files}`.trim();
}

function ticketKeyboard(ticket,request=null){
  const d=(action)=>`hb:${ticket.id}:${action}`;
  const intent=String(request?.intent||'').toUpperCase();
  // Account-change tickets share the stable WD Telegram route for backward compatibility,
  // but WD queue/limit buttons are not valid actions for a bank-change request.
  if(intent==='ACCOUNT_CHANGE_REQUEST') return null;
  if(ticket.category==='RESET_PASSWORD'){
    const q=String(request?.ai_question||'').toLowerCase();
    if(q.includes('member sudah deposit') || q.includes('bukti verifikasi')) return {inline_keyboard:[[ {text:'BELUM MASUK',callback_data:d('RESET_DEPOSIT_NOT_IN')} ]]};
    return {inline_keyboard:[
      [{text:'Silakan Melakukan Deposit',callback_data:d('RESET_DEPOSIT_FIRST')}],
      [{text:'Tidak Terdaftar',callback_data:d('RESET_NOT_REGISTERED')}]
    ]};
  }
  // Legacy labels retained for regression/history compatibility only: Deposit Done / Detail Bukti / Bukti Tidak Jelas.
  // Current proof-review workflow intentionally exposes only the three operator actions requested below.
  if(ticket.category==='DEPOSIT_PROBLEM' && intent==='DEPOSIT_CANCEL') return {inline_keyboard:[
    [{text:'DONE',callback_data:d('DP_CANCEL_DONE')},{text:'TIDAK BISA DIBATALKAN',callback_data:d('DP_CANCEL_REJECTED')}]
  ]};
  if(ticket.category==='DEPOSIT_PROBLEM') return {inline_keyboard:[
    [{text:'Deposit done',callback_data:d('DP_PROCESSED')}],
    [{text:'DANA TIDAK MASUK',callback_data:d('DP_DANA_NOT_IN')}],
    [{text:'DPPGA',callback_data:d('DP_DPPGA')},{text:'BARCODE',callback_data:d('DP_BARCODE')}],
    [{text:'WD sedang diproses',callback_data:d('WD_QUEUE')}],
    [{text:'Clear cache',callback_data:d('CLEAR_CACHE')}]
  ]};
  if(ticket.category==='WD_PROBLEM') return {inline_keyboard:[
    [{text:'WD dalam antrian',callback_data:d('WD_QUEUE')}],
    [{text:'Minta rek valid',callback_data:d('WD_REQUEST_VALID_ACCOUNT')},{text:'DANA limit',callback_data:d('WD_DANA_LIMIT')}]
  ]};
  if(ticket.category==='BONUS') {
    const q=String(request?.ai_question||request?.member_message||'').toLowerCase();
    if(q.includes('bonus new member')) return {inline_keyboard:[[
      {text:'DONE',callback_data:d('BONUS_NEW_MEMBER_DONE')},
      {text:'SALDO SUDAH DIMAINKAN',callback_data:d('BONUS_NEW_MEMBER_PLAYED')}
    ]]};
    if(q.includes('bonus ronda')) return {inline_keyboard:[
      [{text:'DONE',callback_data:d('BONUS_RONDA_DONE')},{text:'SALDO SUDAH DIMAINKAN',callback_data:d('BONUS_RONDA_PLAYED')}],
      [{text:'SAMA IP',callback_data:d('BONUS_RONDA_SAME_IP')}]
    ]};
    if(q.includes('freebet 50%') || q.includes('freebet') && q.includes('member sudah setuju')) return {inline_keyboard:[[
      {text:'DONE',callback_data:d('BONUS_FREEBET_DONE')},
      {text:'TIDAK BISA CLAIM',callback_data:d('BONUS_FREEBET_NOT_ELIGIBLE')}
    ]]};
    return {inline_keyboard:[[ {text:'DONE',callback_data:d('BONUS_DONE')},{text:'Deposit dahulu',callback_data:d('BONUS_DEPOSIT_FIRST')} ]]};
  }
  return null;
}


async function configuredKeyboard(ticket,request){
  const text=`${request?.member_message||''} ${request?.ai_question||''}`;
  const direct=await db.getActiveTelegramCtas(String(request?.intent||''),text).catch(()=>[]);
  const fallback=await db.getActiveTelegramCtas(ticket.category,text).catch(()=>[]);
  const items=[...direct,...fallback].filter((x,i,a)=>a.findIndex(y=>String(y.id)===String(x.id))===i).sort((a,b)=>Number(b.priority||0)-Number(a.priority||0));
  if(!items.length) return null;
  const rows=[];
  for(let i=0;i<items.length;i+=2) rows.push(items.slice(i,i+2).map(x=>({text:String(x.button_label).slice(0,60),callback_data:`hb:${ticket.id}:CFG_${x.id}`})));
  return {inline_keyboard:rows};
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

export async function notifyTelegramEvent({intent='ISSUE',text='',chatId='',title='INFO LIVECHAT'}={}){
  try{
    const settings=await db.getTelegramSettingsInternal();
    if(!settings.enabled||!settings.botToken) return {ok:false,skipped:'telegram_disabled'};
    const mapped=bridgeCategory(intent); const category=mapped==='PANEL_ONLY'?'ISSUE':mapped;
    const route=routeFor(settings,category);
    if(!route.chatId) return {ok:false,skipped:'route_missing'};
    const tg=new TelegramClient(decryptSecret(settings.botToken));
    const identity=chatId?await db.getConversationIdentity(chatId).catch(()=>null):null;
    const lcName=clean(identity?.customer_name||'-',120)||'-';
    const body=`ℹ️ ${clean(title,80)}\n👤 Nama LC: ${lcName}\nKategori: ${clean(category,40)}\nIntent: ${clean(intent,60)}${chatId?`\nChat: ${clean(chatId,120)}`:''}\n\n${clean(text,1800)}`;
    let err=null;
    for(let i=0;i<config.bridgeMaxRetries;i++){
      try{ const msg=await tg.sendMessage(route.chatId,body,{topicId:route.topicId}); return {ok:true,messageId:String(msg.message_id),chatId:String(msg.chat.id)}; }
      catch(e){ err=e; if(i<config.bridgeMaxRetries-1) await sleep(Math.min(config.bridgeRetryBaseMs*Math.pow(2,i),8000)); }
    }
    const fallback=String(config.telegramFailoverChatId||'').trim();
    if(fallback && fallback!==String(route.chatId)){
      const msg=await tg.sendMessage(fallback,`⚠️ FAILOVER\n${body}`,{topicId:config.telegramFailoverTopicId||null});
      return {ok:true,failover:true,messageId:String(msg.message_id),chatId:String(msg.chat.id)};
    }
    throw err||new Error('TELEGRAM_NOTIFY_FAILED');
  }catch(e){
    lastError=e.message; await db.logError('human_bridge','NOTIFY_FAILED',e.message,{intent,chatId}).catch(()=>{});
    return {ok:false,error:e.message};
  }
}
function authorizedTelegramUser(user){
  // Default behavior: every non-bot member in the configured Telegram group/topic
  // may use Human Bridge buttons and reply to tickets. A whitelist is enforced only
  // when TELEGRAM_OPERATOR_ACCESS_MODE=whitelist is explicitly configured. This keeps
  // legacy TELEGRAM_ALLOWED_USER_IDS values from unexpectedly blocking staff.
  const mode=String(config.telegramOperatorAccessMode||'all').toLowerCase();
  if(mode!=='whitelist') return true;
  const allowed=config.telegramAllowedUserIds||[];
  if(!allowed.length) return false;
  return allowed.includes(String(user?.id||''));
}
async function sendWithRetry(tg,chatId,text,opts,ticket){
  let lastErr=null; const max=config.bridgeMaxRetries;
  for(let i=0;i<max;i++){
    try{return await tg.sendMessage(chatId,text,opts);}catch(e){lastErr=e; const delay=config.bridgeRetryBaseMs*Math.pow(2,i); await db.scheduleBridgeRetry(ticket.id,e.message,i+1,delay).catch(()=>{}); if(i<max-1)await sleep(Math.min(delay,8000));}
  }
  throw lastErr||new Error('TELEGRAM_SEND_FAILED');
}
async function sendPhotoWithRetry(tg,chatId,photo,caption,opts,ticket){
  let lastErr=null; const max=config.bridgeMaxRetries;
  for(let i=0;i<max;i++){
    try{return await tg.sendPhoto(chatId,photo,{...opts,caption});}
    catch(e){lastErr=e; const delay=config.bridgeRetryBaseMs*Math.pow(2,i); await db.scheduleBridgeRetry(ticket.id,e.message,i+1,delay).catch(()=>{}); if(i<max-1)await sleep(Math.min(delay,8000));}
  }
  throw lastErr||new Error('TELEGRAM_SEND_PHOTO_FAILED');
}
export async function dispatchHumanRequest(request){
  try{
    const settings=await db.getTelegramSettingsInternal();
    if(!settings.enabled||!settings.botToken) return {ok:false,skipped:'telegram_disabled'};
    if(!isTelegramBridgeCategory(request.intent)) return {ok:false,skipped:'panel_only'};
    const category=bridgeCategory(request.intent); let route=routeFor(settings,category);
    const ctaText=`${request.member_message||''} ${request.ai_question||''}`;
    const matchingCtas=[...(await db.getActiveTelegramCtas(request.intent,ctaText).catch(()=>[])),...(await db.getActiveTelegramCtas(category,ctaText).catch(()=>[]))].filter((x,i,a)=>a.findIndex(y=>String(y.id)===String(x.id))===i).sort((a,b)=>Number(b.priority||0)-Number(a.priority||0));
    const routedCta=matchingCtas.find(x=>String(x.telegram_chat_id||'').trim());
    if(routedCta) route={chatId:String(routedCta.telegram_chat_id).trim(),topicId:String(routedCta.telegram_topic_id||'').trim()||null};
    if(!route.chatId) return {ok:false,skipped:'route_missing'};
    const ticket=await db.ensureBridgeTicket(request,{category,telegramChatId:route.chatId,telegramTopicId:route.topicId});
    await db.transitionCaseState(request.id,'SENT_TO_TELEGRAM').catch(()=>{});
    const timeoutCta=matchingCtas.find(x=>Number(x.timeout_seconds)>0); if(timeoutCta) await db.setBridgeTicketTimeout(ticket.id,timeoutCta.timeout_seconds).catch(()=>{});
    if(ticket.telegram_message_id){await db.transitionCaseState(request.id,'WAITING_CS').catch(()=>{});return {ok:true,existing:true,ticket};}
    const tg=new TelegramClient(decryptSecret(settings.botToken));
    const ctx=await db.getContext(request.chat_id,8); const attachmentUrls=ctx.flatMap(m=>Array.isArray(m.attachments)?m.attachments:[]).map(a=>a?.url).filter(u=>/^https?:\/\//i.test(String(u||''))).slice(-3);
    if(!(await db.bridgeRetryDue(ticket.id))) return {ok:false,skipped:'retry_backoff',ticket};
    const identity=await db.getConversationIdentity(request.chat_id).catch(()=>null);
    const customerName=identity?.customer_name||'';
    const body=ticketText(ticket,request,attachmentUrls,customerName); const customKeyboard=await configuredKeyboard(ticket,request); const replyMarkup=customKeyboard||ticketKeyboard(ticket,request); const opts={topicId:route.topicId,replyMarkup};
    const proofPhoto=attachmentUrls[attachmentUrls.length-1]||'';
    let msg=null,usedChat=route.chatId,usedTopic=route.topicId;
    try{
      msg=proofPhoto
        ? await sendPhotoWithRetry(tg,route.chatId,proofPhoto,body.slice(0,1000),opts,ticket)
        : await sendWithRetry(tg,route.chatId,body,opts,ticket);
    }
    catch(primaryError){
      const fallback=String(config.telegramFailoverChatId||'').trim();
      if(fallback && fallback!==String(route.chatId)){
        usedChat=fallback; usedTopic=String(config.telegramFailoverTopicId||'').trim()||null;
        const failBody=`⚠️ FAILOVER ${ticket.ticket_code}\n${body}`;
        msg=proofPhoto
          ? await sendPhotoWithRetry(tg,usedChat,proofPhoto,failBody.slice(0,1000),{topicId:usedTopic,replyMarkup},ticket)
          : await sendWithRetry(tg,usedChat,failBody,{topicId:usedTopic,replyMarkup},ticket);
      }else throw primaryError;
    }
    const saved=await db.markBridgeTicketSent(ticket.id,{messageId:String(msg.message_id),telegramChatId:String(msg.chat.id),topicId:msg.message_thread_id?String(msg.message_thread_id):usedTopic});
    await db.transitionCaseState(request.id,'WAITING_CS').catch(()=>{});
    return {ok:true,ticket:saved};
  }catch(e){
    lastError=e.message; await db.logError('human_bridge','DISPATCH_FAILED',e.message,{humanRequestId:request?.id});
    const t=request?.id?await db.ensureBridgeTicket(request,{category:bridgeCategory(request.intent),telegramChatId:'',telegramTopicId:null}).catch(()=>null):null;
    if(t && Number(t.delivery_attempts||0)>=config.bridgeMaxRetries){
      await db.addDeadLetter({source:'telegram_bridge',eventKey:t.ticket_code,chatId:request.chat_id,payload:{humanRequestId:request.id,intent:request.intent},error:e.message,attempts:t.delivery_attempts}).catch(()=>{});
      await db.markBridgeDeadLetter(t.id).catch(()=>{});
    }
    return {ok:false,error:e.message};
  }
}

function inferCategoryFromHumanAnswer(text=''){
  const v=String(text||'').toLowerCase();
  if(/(?:user\s*id|userid|username)\s*[:=]|password\s*[:=]|link\s*login\s*[:=]/i.test(v)) return 'RESET_PASSWORD';
  if(/\b(?:dp|deposit)\b.*\b(?:sudah|masuk|belum|pending)\b|\b(?:sudah|belum)\b.*\b(?:dp|deposit)\b/i.test(v)) return 'DEPOSIT_PROBLEM';
  if(/\b(?:wd|withdraw)\b|dana\s+lim(?:it|id)|rekening\s+(?:valid|pengganti)/i.test(v)) return 'WD_PROBLEM';
  if(/\bbonus\b|claim\s+bonus|klaim\s+bonus/i.test(v)) return 'BONUS';
  return null;
}

async function tryResolveUnquotedTicket(m){
  const chatId=String(m?.chat?.id||''); if(!chatId) return null;
  const answer=String(m?.text||m?.caption||'').trim(); if(!answer) return null;
  const category=inferCategoryFromHumanAnswer(answer); if(!category) return null;

  // Sensitive operational replies MUST be reply-to-ticket (or explicit ticket code).
  // Never infer RESET/REGISTER/DP/WD/BONUS from a random group message, even if only
  // one case appears open; this closes a cross-member leakage path.
  if(['RESET_PASSWORD','DEPOSIT_PROBLEM','WD_PROBLEM','BONUS'].includes(category)) return null;

  const topicId=m?.message_thread_id?String(m.message_thread_id):null;
  let rows=await db.listOpenBridgeTicketsForTelegram(chatId,{category,topicId,limit:10});
  if(!rows.length && topicId) rows=await db.listOpenBridgeTicketsForTelegram(chatId,{category,limit:10});
  if(rows.length===1) return rows[0];
  return null;
}

async function resolveTicketFromTelegramMessage(m){
  const chatId=String(m?.chat?.id||''); if(!chatId) return null;
  const replyId=m?.reply_to_message?.message_id;
  if(replyId){
    const exact=await db.findOpenBridgeTicketByTelegram(chatId,String(replyId));
    if(exact) return exact;

    // Reset replies must never be lost merely because ticket state and Human Request
    // state drifted apart (for example after a prior button action/restart). When the
    // operator REPLIES to the exact Telegram reset ticket, allow it if the bound Human
    // Request is still OPEN. This is still safe because routing is anchored by the
    // Telegram message_id -> ticket -> LiveChat chat_id chain; no fuzzy inference.
    const prior=await db.findBridgeTicketByTelegram(chatId,String(replyId));
    if(prior && prior.category==='RESET_PASSWORD'){
      const priorRequest=await db.getHumanRequest(prior.human_request_id).catch(()=>null);
      if(priorRequest?.status==='OPEN') return {...prior,_resetContinuation:true};
      const priorAction=String(prior?.human_answer||'');
      if(/^ACTION:RESET_DEPOSIT_FIRST$/i.test(priorAction) || /^ACTION:RESET_DEPOSIT_NOT_IN$/i.test(priorAction)){
        return {...prior,_resetContinuation:true};
      }
    }
  }
  const own=String(m?.text||m?.caption||'');
  // Reset credentials are sensitive. Never auto-route them from an unquoted
  // Telegram message or a typed ticket code. Staff must REPLY to the exact ticket.
  const lines=own.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const likelyReset=/password|psw|userid|user id|username|https?:\/\//i.test(own) || lines.length>=3;
  if(likelyReset) return null;
  const quoted=String(m?.reply_to_message?.text||m?.reply_to_message?.caption||'');
  const combined=`${quoted}\n${own}`;
  const code=combined.match(/\b(?:RST|WD|DP|BON|CUS)-\d{8}-[A-Z0-9]{4,8}\b/i)?.[0];
  if(code) return db.findOpenBridgeTicketByCode(code);
  return tryResolveUnquotedTicket(m);
}

async function handleCallback(u,livechat){
  const q=u?.callback_query; if(!q||q.from?.is_bot) return false;
  const m=String(q.data||'').match(/^hb:(\d+):([A-Z0-9_]+)$/); if(!m) return false;

  // CallbackQuery MUST be acknowledged before any DB/ticket/LiveChat work. The poll
  // loop now performs a zero-DB fast ACK as soon as Telegram returns the update. Keep
  // this fallback ACK for recovery when that first network call fails.
  let tg=null;
  try{
    let token=currentBotToken;
    if(!token){ const settings=await db.getTelegramSettingsInternal(); token=decryptSecret(settings.botToken); }
    tg=new TelegramClient(token);
    if(!authorizedTelegramUser(q.from)){
      if(!u?._fastCallbackAcked) await tg.answerCallbackQuery(q.id,'Akun Telegram ini belum diizinkan.').catch(()=>{});
      return true;
    }
    if(!u?._fastCallbackAcked) await tg.answerCallbackQuery(q.id,'Sedang diproses…').catch(()=>{});
  }catch(e){
    lastError=e.message;
    await db.logError('human_bridge','CALLBACK_ACK_FAILED',e.message,{updateId:u?.update_id,userId:q.from?.id}).catch(()=>{});
  }

  const before=await db.getBridgeTicketById(m[1]);
  if(!before || (before.telegram_message_id && String(q.message?.message_id||'')!==String(before.telegram_message_id))){
    if(tg) await tg.sendMessage(String(q.message?.chat?.id||''),`⚠️ Tombol ticket sudah tidak valid.`,{replyTo:q.message?.message_id,topicId:q.message?.message_thread_id||null}).catch(()=>{});
    return true;
  }

  // Claim atomically before any slow LiveChat call. Prevents double execution when
  // operators tap the same button repeatedly or multiple bot loops overlap briefly.
  const ticket=await db.claimBridgeTicketAction(m[1],m[2]);
  if(!ticket){
    const existing=await db.getBridgeTicketById(m[1]);
    const text=existing?.status==='PROCESSING'?'Ticket sedang diproses…':'Ticket sudah selesai / tidak ditemukan';
    if(tg) await tg.sendMessage(String(q.message?.chat?.id||before.telegram_chat_id),`ℹ️ ${before.ticket_code}: ${text}`,{replyTo:q.message?.message_id,topicId:q.message?.message_thread_id||null}).catch(()=>{});
    return true;
  }

  const request=await db.getHumanRequest(ticket.human_request_id);
  if(!request||request.status!=='OPEN'){
    await db.closeBridgeTicket(ticket.id,'ANSWERED',{telegramReplyMessageId:String(q.message?.message_id||''),humanAnswer:'REQUEST_ALREADY_CLOSED'}).catch(()=>{});
    return true;
  }
  try{
    let completes=true; let displayAction=m[2];
    if(String(m[2]).startsWith('CFG_')){
      const cta=await db.getTelegramCtaConfig(String(m[2]).slice(4));
      if(!cta||!cta.active||String(cta.category).toUpperCase()!==String(ticket.category).toUpperCase()) throw new Error('CTA_NOT_AVAILABLE');
      displayAction=cta.button_label;
      if(String(cta.member_response||'').trim()) await livechat.sendMessage(request.chat_id,String(cta.member_response).trim());
      if(cta.keep_ai_active) await db.clearHumanTakeover(request.chat_id); else await db.setHumanTakeover(request.chat_id,'telegram_cta');
      if(cta.auto_end_chat){await livechat.endChat(request.chat_id);await db.markConversationEnded(request.chat_id);}
      completes=Boolean(cta.completes_case);
    }else{
      if(!actionHandler) throw new Error('BRIDGE_ACTION_HANDLER_NOT_READY');
      await actionHandler({request,action:m[2],livechat});
    }
    await db.clearBridgeDeliveryFailure(ticket.id);
    const who=q.from?.username?`@${q.from.username}`:(q.from?.first_name||String(q.from?.id||'admin'));
    if(completes){
      await db.closeBridgeTicket(ticket.id,'ANSWERED',{telegramReplyMessageId:String(q.message?.message_id||''),humanAnswer:`ACTION:${m[2]}`});
      const completedText=await completedTicketText({ticket,request,displayAction,who});
      await tg.editMessageText(String(q.message?.chat?.id||ticket.telegram_chat_id),q.message?.message_id,completedText).catch(async()=>{
        await tg.clearMessageButtons(String(q.message?.chat?.id||ticket.telegram_chat_id),q.message?.message_id).catch(()=>{});
        await tg.sendMessage(String(q.message?.chat?.id||ticket.telegram_chat_id),completedText,{replyTo:q.message?.message_id,topicId:q.message?.message_thread_id||null}).catch(()=>{});
      });
    }else{
      await db.reopenBridgeTicket(ticket.id,'CTA_NON_TERMINAL').catch(()=>{});
      await tg.sendMessage(String(q.message?.chat?.id||ticket.telegram_chat_id),`✅ ${ticket.ticket_code}: ${displayAction} dijalankan oleh ${who}. Case tetap terbuka.`,{replyTo:q.message?.message_id,topicId:q.message?.message_thread_id||null}).catch(()=>{});
    }
    lastHandledAt=new Date().toISOString();
  }catch(e){
    await db.recordBridgeDeliveryFailure(ticket.id,e.message);
    await db.reopenBridgeTicket(ticket.id,e.message).catch(()=>{});
    lastError=e.message;
    await tg.sendMessage(String(q.message?.chat?.id||ticket.telegram_chat_id),`❌ ${ticket.ticket_code}: ${String(e.message).slice(0,250)}. Ticket tetap aktif, silakan tekan lagi.`,{replyTo:q.message?.message_id,topicId:q.message?.message_thread_id||null}).catch(()=>{});
  }
  return true;
}

async function handleUpdate(u,livechat){
  if(await handleCallback(u,livechat)) return;
  const m=u?.message||u?.edited_message; if(!m) return;
  const chatId=String(m.chat?.id||''); if(!chatId) return;

  // Telegram "Send As group/channel" / anonymous admins may arrive with from.is_bot=true
  // (often GroupAnonymousBot) plus sender_chat. Do not discard those replies.
  // Security: a bot-shaped sender is accepted ONLY when it has sender_chat AND is a
  // direct reply to an exact bridge ticket in this same Telegram chat.
  const anonymousAdminReply=Boolean(m.from?.is_bot && m.sender_chat && m.reply_to_message?.message_id);
  if(m.from?.is_bot && !anonymousAdminReply) return;
  if(!anonymousAdminReply && !authorizedTelegramUser(m.from)) return;

  const ticket=await resolveTicketFromTelegramMessage(m); if(!ticket) return;
  if(anonymousAdminReply){
    const repliedId=String(m.reply_to_message?.message_id||'');
    if(!repliedId || String(ticket.telegram_chat_id||'')!==chatId || String(ticket.telegram_message_id||'')!==repliedId) return;
  }
  const answer=String(m.text||m.caption||'').trim(); if(!answer) return;
  let request=await db.getHumanRequest(ticket.human_request_id);
  if(!request) return;
  // If CS replied to the original reset ticket after choosing deposit verification,
  // prefer the newest OPEN reset request for the SAME LiveChat chat. This covers the
  // normal flow where the member has already sent proof and a fresh verification
  // request/ticket was created. The routing key stays chat_id, so credentials cannot
  // jump to another member.
  if(ticket._resetContinuation && request.status!=='OPEN'){
    const active=await db.getOpenHumanRequest(ticket.chat_id);
    if(active && String(active.intent||'').toUpperCase()==='FORGOT_PASSWORD') request=active;
  }
  const allowAnsweredReset=Boolean(ticket._resetContinuation && String(request.intent||'').toUpperCase()==='FORGOT_PASSWORD');
  if(request.status!=='OPEN' && !allowAnsweredReset) return;
  try{
    if(!answerHandler) throw new Error('BRIDGE_ANSWER_HANDLER_NOT_READY');
    const result=await answerHandler({request,humanAnswer:answer,saveAsKnowledge:false,livechat});
    await db.clearBridgeDeliveryFailure(ticket.id);
    await db.closeBridgeTicket(ticket.id,'ANSWERED',{telegramReplyMessageId:String(m.message_id),humanAnswer:answer});
    // When a reply to the original reset ticket was redirected to a newer OPEN
    // Human Request, close that newer bridge ticket too. This prevents a second CS
    // reply from sending the same credentials twice.
    if(String(request.id)!==String(ticket.human_request_id)) await db.closeBridgeTicketByRequest(request.id,'ANSWERED').catch(()=>{});
    const settings=await db.getTelegramSettingsInternal(); const tg=new TelegramClient(decryptSecret(settings.botToken));
    const ack=result?.silent
      ? `✅ ${ticket.ticket_code}: status WD pending disimpan. Tidak ada balasan tambahan ke member; tunggu member chat lagi.`
      : `✅ ${ticket.ticket_code} sudah diteruskan ke member LiveChat yang benar.`;
    await tg.sendMessage(chatId,ack,{replyTo:m.message_id,topicId:m.message_thread_id||null}).catch(()=>{});
    lastHandledAt=new Date().toISOString();
  }catch(e){
    lastError=e.message;
    await db.recordBridgeDeliveryFailure(ticket.id,e.message);
    await db.reopenBridgeTicket(ticket.id,e.message).catch(()=>{});
    await db.logError('human_bridge','TELEGRAM_REPLY_FAILED',e.message,{ticketId:ticket.id,updateId:u.update_id});
    const settings=await db.getTelegramSettingsInternal(); if(settings.botToken){ const tg=new TelegramClient(decryptSecret(settings.botToken));
      const msg=String(e.message).startsWith('RESET_REPLY_INCOMPLETE')
        ? `⚠️ ${ticket.ticket_code}: data reset belum lengkap. Reply lagi ke ticket ini dengan User ID/Username, Password, dan Link Login. Ticket tetap OPEN.`
        : String(e.message).startsWith('REGISTER_REPLY_INCOMPLETE')
          ? `⚠️ ${ticket.ticket_code}: data akun baru belum lengkap. Reply lagi ke ticket ini dengan User ID/Username, Password, dan Link Login. Ticket tetap OPEN.`
          : String(e.message).startsWith('STALE_SESSION_REQUEST')
            ? `⚠️ ${ticket.ticket_code}: ticket berasal dari sesi LiveChat lama. Tidak ada pesan yang dikirim ke sesi baru.`
            : `❌ ${ticket.ticket_code} belum berhasil diteruskan: ${String(e.message).slice(0,300)}. Ticket tetap OPEN dan sistem akan retry.`;
      await tg.sendMessage(chatId,msg,{replyTo:m.message_id,topicId:m.message_thread_id||null}).catch(()=>{}); }
    // Important: bubble the failure to handleUpdatesConcurrent so telegram_processed_updates
    // becomes FAILED instead of DONE. The same update can then be retried safely.
    throw e;
  }
}

export function bridgeStatus(){ return {running,maintenanceRunning,lastError,lastPollAt,lastHandledAt,botUsername:currentBotUser?.username||null}; }

async function handleUpdatesConcurrent(updates,livechat,limit=8){
  const items=Array.isArray(updates)?updates:[];
  if(!items.length) return;
  let index=0;
  const worker=async()=>{
    while(true){
      const i=index++;
      if(i>=items.length) return;
      const updateId=items[i]?.update_id;
      try{
        if(updateId!=null && !(await db.claimTelegramUpdate(updateId))) continue;
        await handleUpdate(items[i],livechat);
        if(updateId!=null) await db.finishTelegramUpdate(updateId);
      }
      catch(e){
        if(updateId!=null) await db.failTelegramUpdate(updateId,e.message).catch(()=>{});
        await db.logError('human_bridge','UPDATE_FAILED',e.message,{updateId}).catch(()=>{});
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},worker));
}

export async function startHumanBridge({livechat,onAnswer,onAction}){
  if(running) return;
  running=true;
  stop=false;
  answerHandler=onAnswer;
  actionHandler=onAction;

  // FAST PATH: Telegram updates are polled in their own loop. Maintenance work
  // (backlog retries, SLA reminders, stale-ticket recovery) must never sit in
  // front of getUpdates(), otherwise a large backlog can delay a staff reply
  // to LiveChat by minutes.
  (async()=>{
    while(!stop){
      try{
        const settings=await db.getTelegramSettingsInternal();
        if(!settings.enabled||!settings.botToken){ await new Promise(r=>setTimeout(r,1000)); continue; }
        const token=decryptSecret(settings.botToken);
        currentBotToken=token;
        const tg=new TelegramClient(token);
        if(!tg.ready()) throw new Error('TELEGRAM_BOT_TOKEN_INVALID');
        if(!currentBotUser) currentBotUser=await tg.getMe();

        const offset=Number(settings.lastUpdateId||0)+1;
        const pollStarted=Date.now();
        // Shorter long-poll window keeps recovery snappy after transient network
        // problems while still returning immediately as soon as Telegram has data.
        const updates=await tg.getUpdates({offset,timeout:3});
        lastPollAt=new Date().toISOString();

        // ULTRA-FAST CALLBACK ACK: stop Telegram's spinner BEFORE touching Postgres.
        // This intentionally bypasses claimTelegramUpdate(), ticket lookups, learning,
        // SLA scans and LiveChat delivery. Those operations continue immediately after
        // the button has already been acknowledged to the operator.
        for(const u of updates||[]){
          const q=u?.callback_query;
          if(!q || q.from?.is_bot || !/^hb:\d+:[A-Z0-9_]+$/.test(String(q.data||''))) continue;
          try{
            const allowed=authorizedTelegramUser(q.from);
            await tg.answerCallbackQuery(q.id,allowed?'Sedang diproses…':'Akun Telegram ini belum diizinkan.');
            u._fastCallbackAcked=true;
          }catch(e){
            // Do not block processing; handleCallback() will retry the ACK.
            u._fastCallbackAckError=String(e?.message||e);
          }
        }

        await db.setIntegrationHealth('telegram_poll',{status:'OK',latencyMs:Date.now()-pollStarted,meta:{updates:Array.isArray(updates)?updates.length:0}}).catch(()=>{});

        let max=Number(settings.lastUpdateId||0);
        for(const u of updates||[]) max=Math.max(max,Number(u.update_id||0));
        await handleUpdatesConcurrent(updates,livechat,8);
        if(max>Number(settings.lastUpdateId||0)) await db.setTelegramLastUpdateId(max);
        lastError=null;
      }catch(e){
        lastError=e.message;
        await db.setIntegrationHealth('telegram_poll',{status:'ERROR',error:e.message}).catch(()=>{});
        await db.logError('human_bridge','POLL_FAILED',e.message).catch(()=>{});
        await new Promise(r=>setTimeout(r,1500));
      }
    }
    running=false;
  })();

  // SLOW PATH: all periodic housekeeping is isolated from the update receiver.
  // This preserves existing behavior but cannot hold up RESET/BONUS/DP/WD replies.
  (async()=>{
    maintenanceRunning=true;
    while(!stop){
      try{
        const settings=await db.getTelegramSettingsInternal();
        if(settings.enabled&&settings.botToken){
          const token=decryptSecret(settings.botToken);
          const tg=new TelegramClient(token);
          if(tg.ready()){
            if(Date.now()-lastBacklogScanAt>10000){
              const opens=await db.listHumanRequests('OPEN',200);
              const pending=opens.filter(req=>isTelegramBridgeCategory(req.intent));
              // Small concurrent batches: faster backlog recovery without blocking
              // the dedicated Telegram update polling loop.
              for(let i=0;i<pending.length;i+=6){
                await Promise.all(pending.slice(i,i+6).map(req=>dispatchHumanRequest(req).catch(()=>null)));
              }
              lastBacklogScanAt=Date.now();
            }

            await db.recoverStaleBridgeProcessing(120).catch(()=>{});
            await db.expireStaleHumanRequests(120).catch(()=>{});

            if(Date.now()-lastSlaScanAt>30000){
              const breached=await db.listSlaBreachedBridgeTickets(30).catch(()=>[]);
              const alertChat=String(config.telegramFailoverChatId||settings.defaultChatId||'').trim();
              for(const t of breached){
                const stage=Number(t.due_stage||1);
                const base=Math.max(1,Number(t.base_minutes||config.bridgeSlaMinutes||5));
                const mins=stage>=3?base*4:stage===2?base*2:base;
                const label=stage>=3?'🚨 SLA ESCALATION':stage===2?'⚠️ SLA WARNING':'⏰ SLA REMINDER';
                if(alertChat) await tg.sendMessage(alertChat,`${label} ${t.ticket_code}\nCase belum dijawab melewati ${mins} menit. Mohon segera dicek.`,{topicId:config.telegramFailoverTopicId||null}).catch(()=>{});
                await db.markBridgeSlaAlerted(t.id,stage).catch(()=>{});
              }
              lastSlaScanAt=Date.now();
            }
          }
        }
      }catch(e){
        lastError=e.message;
        await db.logError('human_bridge','MAINTENANCE_FAILED',e.message).catch(()=>{});
      }
      await new Promise(r=>setTimeout(r,5000));
    }
    maintenanceRunning=false;
  })();
}
export async function stopHumanBridge({waitMs=7000}={}){stop=true;currentBotToken='';currentBotUser=null;const until=Date.now()+waitMs;while((running||maintenanceRunning)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));return !(running||maintenanceRunning)}
export {CATEGORIES};
