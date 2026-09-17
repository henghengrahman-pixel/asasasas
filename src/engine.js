import { config } from './config.js';
import { normalizeText, detectIntent } from './normalizer.js';
import { OpenAIClient } from './ai.js';
import * as db from './db.js';
import { guardDecision } from './guard.js';
import { greetingText, daypart, canAutoGreetFromHistory, isGreetingTriggerMessage } from './greeting.js';
import { dispatchHumanRequest, notifyTelegramEvent } from './human-bridge.js';
import { isTelegramBridgeCategory } from './bridge-category.js';
import { inferResetAccountData, resetMissing, resetAskFor, isDepositConfirmedText } from './reset-logic.js';
import { normalizeBrain, applyBrainGate } from './brain.js';
import { validateProDecision } from './response-validator.js';
import { detectMultiIntents, detectPromptInjection, extractConversationFacts, detectCorrection, actionRisk } from './advanced-logic.js';
import { formatImportantForAI } from './important-info.js';
import { extractUserIdFromText, extractRequestedUserIdFromText } from './user-id.js';
import { pickBonusLabel, formatBonusClaimQuestion } from './bonus-label.js';
import { FREEBET_TERMS, FREEBET_DONE_REPLY, FREEBET_NOT_ELIGIBLE_REPLY, isFreebet50, isFreebetAgreement } from './freebet.js';
import { NEW_MEMBER_TERMS, RONDA_TERMS, DEPOSIT_CANCEL_DONE_REPLY, SPECIAL_BONUS_DONE_REPLY, NEW_MEMBER_PLAYED_REPLY, RONDA_PLAYED_REPLY, RONDA_SAME_IP_REPLY, isNewMemberBonus, isRondaBonus } from './special-bonus.js';
import { DP_DPPGA_REPLY, DP_BARCODE_REPLY, DP_DANA_NOT_IN_REPLY } from './deposit-actions.js';
import { REGISTER_FORM, REGISTER_WAITING_REPLY, parseRegistrationText, registrationMissing, registrationTicket } from './registration.js';
import { detectGenericAmbiguity, isClosingMessage, isReopenMessage, extractTransactionAmount, extractWaitingDuration, attachmentClass, priorityForIntent, shouldHardSwitch, topicFamily, redactSensitive, fuzzyConfidence, validateRegistrationData, contradictionStatus, bonusStageAllowed } from './ops-hardening.js';
import { getRelevantBotResponses } from './services/bot-responses.js';

const ai = new OpenAIClient();
const WAITING_CHECK_REPLY='Mohon tunggu sebentar ya bosku 😊\nKami cek terlebih dahulu permintaannya. Terima kasih atas kesabarannya 🙏';
const WD_PROCESSING_REPLY='Withdraw bosku sedang kami proses ya 😊🙏\nMohon ditunggu beberapa saat. Jika bosku ingin meninggalkan akun terlebih dahulu juga tidak masalah, withdraw tetap akan kami proses sampai selesai ya bosku ☺️❤️';
const WD_WAITING_STAFF_REPLY=WD_PROCESSING_REPLY;
const WD_ACK_WAIT_REPLY='Terima kasih sudah mau menunggu bosku 😊';
const WD_DANA_LIMIT_REPLY='Di sini kami cek rekening bosku sedang limit. Silakan dibantu rekening dengan atas nama yang sama ya bosku, tarik dana akan kami alihkan ke rekening tersebut karena kendala tarik dana bosku sedang limit.\n\nNama rek :\nNomor rek :\nJenis rek :';
function formatRows(rows, fields){ return rows.map(r=>fields.map(f=>r[f]).filter(Boolean).join(' | ')).join('\n'); }
function promoForMember(promo,{full=false}={}){
  if(!promo) return '';
  const template=String(promo.reply_template||'').trim();
  if(!full && template) return template;
  const lines=[String(promo.name||'').trim()];
  if(promo.min_deposit) lines.push(`Minimal Deposit: ${promo.min_deposit}`);
  if(promo.max_bonus) lines.push(`Maks Bonus: ${promo.max_bonus}`);
  if(promo.turnover) lines.push(`Turnover: ${promo.turnover}`);
  if(promo.claim_limit) lines.push(`Batas Klaim: ${promo.claim_limit}`);
  if(promo.active_hours) lines.push(`Jam Berlaku: ${promo.active_hours}`);
  if(promo.game_scope) lines.push(`Game Berlaku: ${promo.game_scope}`);
  if(promo.rules) lines.push('',String(promo.rules).trim());
  if(template) lines.push('',template);
  return lines.filter((x,i)=>i===0||x!==undefined).join('\n').trim();
}
async function bestPromo(text=''){ return (await db.getRelevantPromoRules(text,6))[0]||null; }
function safeHoldingReply(){ return 'Baik bosku, kami bantu cek dulu ya 😊🙏'; }
function isAbusiveText(s=''){ return /(kontol|goblok|bodoh|bangsat|anjing|babi|tolol|kampret|sialan)/i.test(normalizeText(s)); }
function isLossText(s=''){ const n=normalizeText(s); return ['kalah','rungkad','rugi','boncos'].some(x=>n.includes(x)); }
function isAcknowledgementText(s=''){
  const n=normalizeText(s).trim();
  if(!n) return false;
  // Pure acknowledgements only. Do not swallow messages such as
  // "oke wd belum masuk" or "iya bonus saya belum masuk".
  return /^(?:ok|oke|okay|sip|siap|noted|iya|ya|yoi|baik|mantap)(?:\s+(?:bos|bosku|kak|min|admin))?[.!🙏😊👍]*$/i.test(n);
}
function isWaitingAcknowledgementText(s=''){
  const n=normalizeText(s).trim();
  if(!n) return false;
  // While a WD case is already waiting for staff, conversational follow-ups such as
  // "ok saya tunggu tolong dibantu segera" are acknowledgements, not a request to
  // repeat the full WD status template. Never swallow a fresh problem statement.
  if(/\b(?:belum|blm|belom|gagal|error|kendala|masalah|ga\s+masuk|gak\s+masuk|tidak\s+masuk)\b/i.test(n)) return false;
  const hasAck=/\b(?:ok|oke|okay|sip|siap|iya|ya|baik|noted|mantap)\b/i.test(n);
  const hasWait=/\b(?:tunggu|menunggu|ditunggu|nunggu)\b/i.test(n);
  const asksHelp=/\btolong\s+(?:di\s*)?bantu(?:\s+segera)?\b/i.test(n);
  return (hasAck && (hasWait || asksHelp)) || (hasWait && asksHelp);
}
function isGratitudeText(s=''){
  const n=normalizeText(s).trim();
  if(!n) return false;
  // Keep this intentionally strict so "makasih, tapi WD saya belum masuk"
  // continues into the operational workflow instead of being swallowed.
  return /^(?:(?:makasih|makasi|terima kasih|thanks|thank you|thx)(?:\s+(?:ya|yaa|bos|bosku|kak|min|admin))?|(?:oke|ok|siap|sip)\s+(?:makasih|makasi|terima kasih|thanks|thank you|thx)(?:\s+(?:ya|yaa|bos|bosku|kak|min|admin))?)[.!🙏😊👍❤️]*$/i.test(n);
}
function acknowledgementReply(){ return 'Oke bosku 😊'; }
function gratitudeReply(){ return 'Terima kasih kembali, bosku 😊 Senang bisa membantu. Semoga aktivitas bosku selalu lancar dan menyenangkan. Selamat melanjutkan aktivitas kembali ya, bosku 🙏'; }
function abuseCount(rows=[]){ return customerTexts(rows).filter(isAbusiveText).length; }
async function resolveBonusLabel(text=''){
  const n=normalizeText(text);
  const direct=pickBonusLabel(text);
  // Bekal Bot is the authoritative promo catalogue. It must be checked before
  // legacy Menu Penting PROMO rows so admin edits take effect immediately.
  const promos=await db.getRelevantPromoRules(n,12);
  if(promos.length){
    const top=promos[0];
    const directNorm=normalizeText(direct||'');
    const promoNorm=normalizeText(top.name||'');
    // If the deterministic parser only found a generic family (e.g. BONUS HARIAN),
    // prefer a strongly matched concrete promo from Bekal Bot.
    if(!direct || directNorm===promoNorm || Number(top._score||0)>=8) return String(top.name||'').toUpperCase().slice(0,100);
  }
  if(direct) return direct;
  // Menu Penting PROMO is compatibility fallback only.
  const important=(await db.getRelevantImportantInfo(n,30)).filter(x=>String(x.item_type||'').toUpperCase()==='PROMO');
  if(important.length) return String(important[0].title||important[0].item_key||'').toUpperCase().slice(0,100);
  if(!n.includes('bonus')) return '';
  // Learn the available bonus names from Responses Manual / Knowledge source instead of
  // hard-coding every campaign. This makes typos and newly-added bonus responses discoverable.
  const rows=await db.getRelevantCanned(n,25);
  const bonusRows=rows.filter(r=>{
    const hay=normalizeText(`${r.shortcut||''} ${r.title||''} ${r.category||''} ${(r.tags||[]).join(' ')} ${r.content||''}`);
    return String(r.category||'').toUpperCase().includes('BONUS') || hay.includes('bonus');
  });
  const best=bonusRows[0];
  if(!best) return '';
  const title=String(best.title||'').trim();
  const shortcut=String(best.shortcut||'').replace(/^#/,'').replace(/[_-]+/g,' ').trim();
  const label=(title||shortcut).replace(/\b(response|template|claim|klaim)\b/ig,'').trim();
  return label ? label.toUpperCase().slice(0,80) : '';
}

function customerTexts(rows){ return rows.filter(x=>x.sender_type==='customer').map(x=>String(x.text||'').trim()).filter(Boolean); }
async function getOperationalHistory(chatId){
  // A LiveChat promo/welcome banner is the hard boundary of a NEW member session.
  // Old DP/WD/bonus state and old customer messages must not contaminate the new case.
  // Compatibility markers retained for regression guards from older releases:
  // db.getFullContext(chatId,10000)
  // db.getContextSlice(chatId,digested,take)
  return db.getCurrentSessionContext(chatId,10000);
}
function extractUserId(rows){
  // Search from newest customer message to oldest. The previous implementation joined
  // the whole history and could return an old ID before the ID in the current claim.
  const texts=customerTexts(rows);
  for(let i=texts.length-1;i>=0;i--){
    const found=extractUserIdFromText(texts[i]);
    if(found) return found;
  }
  return '';
}

// When the workflow itself has already asked for a User ID, members commonly answer with
// only the ID (for example: "Mimi77") without writing "ID:" again. Treat the latest
// standalone token as the requested ID, but only when the caller explicitly enables this
// workflow-aware fallback. This avoids mistaking ordinary one-word messages for an account ID.
function extractStandaloneRequestedUserId(rows){
  const latest=[...rows].reverse().find(x=>x.sender_type==='customer' && String(x.text||'').trim());
  const raw=String(latest?.text||'').trim();
  if(!raw) return '';
  if(!/^[a-z0-9_.-]{3,40}$/i.test(raw)) return '';
  if(/^\d{8,22}$/.test(raw.replace(/[^0-9]/g,''))) return ''; // likely phone/account number
  const blocked=new Set(['ok','oke','iya','ya','sip','siap','halo','hai','bos','bosku','done','sudah','udah','belum','bukti','deposit','depo','wd','dana','bca','bri','bni','seabank']);
  if(blocked.has(raw.toLowerCase())) return '';
  return raw;
}
function currentCaseUserId(text='',wf=null,ctx=[]){
  // Explicit forms (ID: xxx / UserID xxx / username xxx) are always safe.
  const explicit=extractUserIdFromText(text);
  if(explicit) return explicit;

  const prev=String(wf?.workflow_data?.userId||'').trim();
  if(prev) return prev;

  // IMPORTANT: free-form/standalone ID inference is ONLY permitted after the bot
  // has explicitly asked for ID. This prevents words such as "blm", customer names,
  // or arbitrary chat tokens from being mistaken for a User ID.
  const waitingId=/WAITING_ID/.test(String(wf?.workflow_state||''));
  if(waitingId){
    const requested=extractRequestedUserIdFromText(text);
    if(requested) return requested;
    return extractStandaloneRequestedUserId(ctx);
  }
  return '';
}
function extractOperationalAmount(rows){
  const texts=customerTexts(rows);
  for(let i=texts.length-1;i>=0;i--){
    const raw=String(texts[i]||'');
    const m=raw.match(/(?:\b(?:nominal|wd|withdraw|penarikan|depo|deposit|transfer|bet|taruhan|menang|kemenangan)\b[^0-9]{0,24}|\brp\s*)([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{1,9})\s*(rb|ribu|k|jt|juta)?/i) || raw.match(/\b([0-9]{1,6})\s*(rb|ribu|k|jt|juta)\b/i);
    if(!m) continue;
    let n=Number(String(m[1]).replace(/[.,]/g,''));
    const unit=String(m[2]||'').toLowerCase();
    if(['rb','ribu','k'].includes(unit)) n*=1000;
    if(['jt','juta'].includes(unit)) n*=1000000;
    if(Number.isFinite(n) && n>=1000) return n;
  }
  return null;
}
function detectGameImpact(rows){
  const n=normalizeText(customerTexts(rows).slice(-8).join(' | '));
  const financial=/saldo (?:ke)?potong|saldo terpotong|saldo berkurang|uang hilang|bet terpotong|taruhan terpotong|menang tidak masuk/.test(n);
  const resultMissing=/result tidak keluar|hasil tidak keluar|round|putaran|history tidak ada|riwayat tidak ada/.test(n);
  return {financial,resultMissing,needsProof:financial||resultMissing};
}

function extractAccountData(rows){
  const text=customerTexts(rows).join('\n');
  const lower=text.toLowerCase();
  const types=['seabank','bca','bri','bni','mandiri','cimb','jago','dana','ovo','gopay','linkaja','shopeepay','bank'];
  const type=types.find(x=>lower.includes(x))||'';
  const noRaw=(text.match(/(?:no\.?\s*(?:rek(?:ening)?|rekening|akun)|nomor\s*(?:rek(?:ening)?|rekening|akun))\s*[:=]?\s*((?:\d[\s.\-]?){6,22})/i)||text.match(/\b((?:\d[\s.\-]?){8,22})\b/))?.[1]||'';
  const no=String(noRaw).replace(/[^0-9]/g,'').slice(0,22);
  const name=(text.match(/(?:nama\s*(?:rek(?:ening)?|rekening)?|atas\s*nama|a\.?n\.?)\s*[:=]?\s*([a-z][a-z .'-]{2,60})/i))?.[1]?.trim()||'';
  return {type,name,no};
}

function latestProof(rows){
  const all=rows.filter(x=>x.sender_type==='customer').flatMap(x=>Array.isArray(x.attachments)?x.attachments:[]);
  return all.reverse().find(a=>a?.isImage||String(a?.mimeType||a?.type||'').startsWith('image/'))||null;
}

async function safeHoldingReplyForIntent(intent='GENERAL',mode='staff'){
  const it=String(intent||'GENERAL').toUpperCase();
  if(it==='WITHDRAW_PROBLEM') return responseText('#WD_TUNGGU','Baik bosku 😊🙏 Permintaan WD bosku sudah kami terima. Mohon ditunggu sebentar ya, kami sedang bantu lanjutkan pengecekannya.');
  if(['DEPOSIT_PROBLEM','DEPOSIT_REQUEST','DEPOSIT_CANCEL'].includes(it)) return responseText('#DP_TUNGGU','Baik bosku 😊🙏 Permintaan deposit bosku sudah kami terima. Mohon ditunggu sebentar ya, kami sedang bantu lanjutkan pengecekannya.');
  if(['BONUS_REQUEST','BONUS_CLAIM'].includes(it)) return responseText('#BONUS_TUNGGU','Baik bosku 😊🙏 Permintaan bonus bosku sudah kami terima. Mohon ditunggu sebentar ya, kami sedang bantu lanjutkan pengecekannya.');
  if(['FORGOT_PASSWORD','RESET_PASSWORD'].includes(it)) return responseText('#RESET_TUNGGU','Baik bosku 😊🙏 Permintaan reset password bosku sudah kami terima. Mohon ditunggu sebentar ya, kami sedang bantu lanjutkan pengecekannya.');
  if(mode==='error') return 'Mohon tunggu sebentar ya bosku 😊🙏 Pesan bosku sudah kami terima. Kami sedang bantu cek agar jawaban yang diberikan tepat.';
  return 'Mohon tunggu sebentar ya bosku 😊🙏 Pesan bosku sudah kami terima dan sedang kami bantu cek. Begitu ada hasil, langsung kami informasikan.';
}
async function askAndTrack(livechat,chatId,intent,type,state,data,reply){
  let nextData={...(data||{})};
  if(['BONUS_CLAIM','FREEBET_CLAIM'].includes(String(type||'').toUpperCase())){
    const stageMap={
      ASK_TYPE:'TERMS_SHOWN',
      WAITING_AGREEMENT:'WAITING_AGREEMENT',
      WAITING_ID:'WAITING_ID',
      WAITING_ID_AFTER_AGREEMENT:'WAITING_ID',
      WAITING_HUMAN:'WAITING_STAFF'
    };
    const nextStage=stageMap[String(state||'').toUpperCase()]||nextData.bonusStage||'NONE';
    const current=(await db.getConversationWorkflow(chatId).catch(()=>null))?.workflow_data?.bonusStage||'NONE';
    if(!bonusStageAllowed(current,nextStage) && current!=='NONE'){
      await db.appendCaseAudit({chatId,eventType:'BONUS_STAGE_BLOCKED',intent,payload:{current,next:nextStage,type,state}}).catch(()=>{});
      throw new Error(`INVALID_BONUS_STAGE:${current}->${nextStage}`);
    }
    nextData.bonusStage=nextStage;
  }
  await db.setConversationWorkflow(chatId,{type,state,data:nextData});
  await sendAndStore(livechat,chatId,reply,intent);
  return {intent,workflow:type,state,sent:true,reply};
}
async function makeHumanRequest({chatId,eventId,intent,text,question,holding='',livechat,telegram=true,requireTelegramDelivery=false}){
  // Enrich staff ticket with structured facts extracted from THIS case only.
  const amount=extractTransactionAmount(text,intent);
  const waiting=extractWaitingDuration(text);
  const sessionRows=await db.getCurrentSessionContext(chatId,80).catch(()=>[]);
  const attachments=sessionRows.flatMap(r=>Array.isArray(r.attachments)?r.attachments:[]);
  const attachmentType=attachmentClass({intent,text,attachments});
  const enrich=[
    amount?`Nominal terdeteksi: Rp${Number(amount).toLocaleString('id-ID')}`:'',
    waiting?`Durasi tunggu: ${waiting.raw}`:'',
    attachmentType?`Jenis lampiran: ${attachmentType}`:''
  ].filter(Boolean).join('\n');
  const enrichedQuestion=[question,enrich].filter(Boolean).join('\n\n').slice(0,3800);

  const reopenedFrom=isReopenMessage(text)?(await db.findRecentClosedHumanRequest(chatId,180).catch(()=>null))?.id:null;
  const req=await db.createHumanRequest({
    chatId,sourceEventId:eventId,intent,memberMessage:text,question:enrichedQuestion,
    priority:priorityForIntent(intent),ttlMinutes:120,reopenedFrom
  });
  if(amount) await db.upsertCaseEntity({chatId,caseKey:req.case_key||String(req.id),key:'amount',value:String(amount),confidence:.9,sourceEventId:eventId}).catch(()=>{});
  if(waiting) await db.upsertCaseEntity({chatId,caseKey:req.case_key||String(req.id),key:'waiting_duration',value:waiting.raw,confidence:.85,sourceEventId:eventId}).catch(()=>{});
  if(attachmentType) await db.upsertCaseEntity({chatId,caseKey:req.case_key||String(req.id),key:'attachment_type',value:attachmentType,confidence:.8,sourceEventId:eventId}).catch(()=>{});

  let tgResult={ok:false,skipped:'not_requested'};
  if(telegram){
    const started=Date.now();
    try{
      tgResult=await dispatchHumanRequest(req);
      await db.setIntegrationHealth('telegram',{status:tgResult?.ok?'OK':'ERROR',latencyMs:Date.now()-started,error:tgResult?.ok?'':String(tgResult?.error||tgResult?.skipped||'dispatch_failed'),meta:{requestId:req.id}}).catch(()=>{});
    }catch(err){
      await db.setIntegrationHealth('telegram',{status:'ERROR',latencyMs:Date.now()-started,error:String(err?.message||err),meta:{requestId:req.id}}).catch(()=>{});
      await db.addDeadLetter({source:'TELEGRAM_DISPATCH',eventKey:req.case_key||String(req.id),chatId,payload:{humanRequestId:req.id,intent},error:String(err?.message||err),attempts:1}).catch(()=>{});
      tgResult={ok:false,error:String(err?.message||err)};
    }
  }

  await db.appendCaseAudit({chatId,caseKey:req.case_key||null,eventType:'TELEGRAM_DISPATCH_RESULT',intent,payload:{ok:Boolean(tgResult?.ok),requestId:req.id}}).catch(()=>{});

  // Financial/bonus claims must never look completed when the staff bridge did not
  // actually receive the ticket.
  if(requireTelegramDelivery && !tgResult?.ok){
    await db.logError('engine','REQUIRED_TELEGRAM_DISPATCH_PENDING',String(tgResult?.error||tgResult?.skipped||'telegram_not_delivered'),{chatId,humanRequestId:req.id,intent});
    if(!(await db.isHumanTakeover(chatId))){
      const fallback=await safeHoldingReplyForIntent(intent,'telegram_retry');
      await sendAndStore(livechat,chatId,fallback,intent);
      return {intent,humanRequestId:req.id,sent:true,reply:fallback,waitingHuman:true,telegram:false,telegramPending:true};
    }
    return {intent,humanRequestId:req.id,sent:false,waitingHuman:true,telegram:false,telegramPending:true,skipped:'human_takeover'};
  }

  if(holding) await sendAndStore(livechat,chatId,holding,intent);
  return {intent,humanRequestId:req.id,sent:Boolean(holding),waitingHuman:true,telegram:Boolean(tgResult?.ok),telegramPending:Boolean(telegram&&!tgResult?.ok)};
}
function workflowIntentFromType(type=''){
  const wfType=String(type||'').toUpperCase();
  return (
    wfType==='DEPOSIT_VERIFY' ? 'DEPOSIT_PROBLEM' :
    wfType==='DEPOSIT_CANCEL' ? 'DEPOSIT_CANCEL' :
    ['WD_CHECK','WD_STATUS','WD_REPLACEMENT'].includes(wfType) ? 'WITHDRAW_PROBLEM' :
    wfType==='RESET_PASSWORD' ? 'FORGOT_PASSWORD' :
    ['BONUS_CLAIM','FREEBET_CLAIM'].includes(wfType) ? 'BONUS_REQUEST' :
    wfType==='PAYOUT_CHECK' ? 'PAYOUT_NOT_RECEIVED' :
    wfType==='ACCOUNT_CHANGE' ? 'ACCOUNT_CHANGE_REQUEST' :
    wfType==='ACCOUNT_LIMIT' ? 'BANK_ACCOUNT_LIMIT' :
    wfType==='GAME_CHECK' ? 'GAME_PROBLEM' :
    wfType==='ACCESS_CHECK' ? 'LINK_PROBLEM' :
    wfType==='REGISTER_CHECK' ? 'REGISTER_PROBLEM' :
    wfType==='LOSS_REVIEW' ? 'LOSS_COMPLAINT' :
    wfType==='TRANSACTION_CLARIFY' ? 'TRANSACTION_AMBIGUOUS' : ''
  );
}
async function resolveContextualIntent(chatId,currentIntent,text,attachments=[]){
  const current=String(currentIntent||'GENERAL').toUpperCase();
  const wf=await db.getConversationWorkflow(chatId);
  const wfType=String(wf?.workflow_type||'').toUpperCase();

  // Explicit topic switch MUST beat an old collecting/waiting workflow.
  // Example: a conversation was collecting DEPOSIT proof, then the member says
  // "proses wd ga masuk". The fresh WITHDRAW intent must not be rewritten to
  // DEPOSIT just because DEPOSIT_VERIFY still exists in conversation_workflow.
  const workflowIntent=workflowIntentFromType(wfType);

  const fresh=String(detectIntent(text)||'GENERAL').toUpperCase();
  const explicitOperational=new Set([
    'DEPOSIT_PROBLEM','DEPOSIT_CANCEL','WITHDRAW_PROBLEM','FORGOT_PASSWORD','BONUS_REQUEST','BONUS_DAILY',
    'ACCOUNT_CHANGE_REQUEST','PAYOUT_NOT_RECEIVED','BANK_ACCOUNT_LIMIT','REGISTER_PROBLEM',
    'LINK_PROBLEM','LOGIN_PROBLEM','GAME_PROBLEM','GENERAL_DISTURBANCE','LOSS_COMPLAINT','TRANSACTION_AMBIGUOUS'
  ]);
  if(workflowIntent && explicitOperational.has(fresh) && fresh!==workflowIntent){
    await db.logError('engine','OPERATIONAL_TOPIC_SWITCH',`Workflow ${workflowIntent} -> ${fresh}`,{chatId,workflowType:wfType,workflowState:wf?.workflow_state||null,text:String(text||'').slice(0,240)}).catch(()=>{});
    // Human requests/tickets are persisted independently, so clearing the single
    // conversation workflow does not delete an already-created Telegram case.
    // It only prevents the stale workflow from hijacking the member's new topic.
    await db.clearConversationWorkflow(chatId);
    return fresh;
  }

  if(wfType==='DEPOSIT_VERIFY') return 'DEPOSIT_PROBLEM';
  if(wfType==='DEPOSIT_CANCEL') return 'DEPOSIT_CANCEL';
  if(wfType==='WD_CHECK' || wfType==='WD_STATUS' || wfType==='WD_REPLACEMENT') return 'WITHDRAW_PROBLEM';
  if(wfType==='RESET_PASSWORD') return 'FORGOT_PASSWORD';
  if(wfType==='BONUS_CLAIM' || wfType==='FREEBET_CLAIM') return 'BONUS_REQUEST';
  if(wfType==='PAYOUT_CHECK') return 'PAYOUT_NOT_RECEIVED';
  if(wfType==='ACCOUNT_CHANGE') return 'ACCOUNT_CHANGE_REQUEST';
  if(wfType==='ACCOUNT_LIMIT') return 'BANK_ACCOUNT_LIMIT';
  if(wfType==='GAME_CHECK') return 'GAME_PROBLEM';
  if(wfType==='ACCESS_CHECK') return 'LINK_PROBLEM';
  if(wfType==='REGISTER_CHECK') return 'REGISTER_PROBLEM';
  if(wfType==='LOSS_REVIEW') return 'LOSS_COMPLAINT';
  if(wfType==='TRANSACTION_CLARIFY') return 'TRANSACTION_AMBIGUOUS';

  if(['DEPOSIT_PROBLEM','DEPOSIT_CANCEL','WITHDRAW_PROBLEM','WITHDRAW_REQUEST','FORGOT_PASSWORD','BONUS_REQUEST','BONUS_DAILY','ACCOUNT_CHANGE_REQUEST','PAYOUT_NOT_RECEIVED','BANK_ACCOUNT_LIMIT','REGISTER_PROBLEM','LINK_PROBLEM','LOGIN_PROBLEM','GAME_PROBLEM','GENERAL_DISTURBANCE','LOSS_COMPLAINT','TRANSACTION_AMBIGUOUS'].includes(current)) return current;

  const rows=await getOperationalHistory(chatId);
  const recent=rows.filter(x=>x.sender_type==='customer').slice(-8);
  const recentRaw=[...recent.map(x=>String(x.text||'')),String(text||'')].join(' | ');
  const n=normalizeText(recentRaw);
  const hasCurrentImage=(attachments||[]).some(a=>a?.isImage || String(a?.mimeType||a?.type||'').startsWith('image/'));
  const hasRecentImage=Boolean(latestProof(rows));

  const depositWord=/\bdeposit\b/.test(n) || /\b(?:dp|dpo|dps|depo)\d*\b/i.test(recentRaw);
  const depositProblem=/(?:belum|tidak)\s+masuk|pending|lama|cek\s+(?:deposit|depo)|bukti\s+(?:deposit|transfer|tf)|(?:transfer|tf).*?(?:belum|tidak).*?masuk|saldo.*(?:belum|tidak).*?masuk|masuk.*belum/i.test(n);
  // A generic image is NOT deposit evidence by itself. Members often send game/history
  // screenshots while complaining about loss. Deposit requires an explicit transaction
  // problem; generic proof triage is handled by PROOF_REVIEW separately.
  if(depositWord && depositProblem) return 'DEPOSIT_PROBLEM';
  // Legacy regression compatibility only (NOT runtime logic):
  // depositWord && (depositProblem || hasCurrentImage || hasRecentImage)
  // depositWord -> hasCurrentImage -> DEPOSIT_PROBLEM

  const withdrawWord=/\b(?:withdraw|penarikan)\b/.test(n) || /\bwd\d*\b/i.test(recentRaw);
  const withdrawProblem=/(?:belum|tidak)\s+masuk|pending|lama|proses|cek|status/i.test(n);
  if(withdrawWord && withdrawProblem) return 'WITHDRAW_PROBLEM';

  return current;
}

// Legacy regression compatibility marker only: const uid=extractUserIdFromText(text) || extractRequestedUserIdFromText(text) || extractUserId(ctx)
// Legacy regression compatibility: extractUserId(ctx) || (workflowAskedForId ? extractStandaloneRequestedUserId(ctx) : '')
// Legacy regression compatibility: extractUserIdFromText(text) || extractUserId(ctx) || extractStandaloneRequestedUserId(ctx)
async function maybeHandleOperationalFlow({chatId,eventId,text,intent,livechat}){
  const wf=await db.getConversationWorkflow(chatId);
  const ctx=await getOperationalHistory(chatId);
  const effective=String(intent||'GENERAL').toUpperCase();

  // Hard-lock an operational case after the Telegram ticket has been delivered,
  // BUT never let an old WAITING_HUMAN workflow swallow a new explicit topic.
  // Example: PROOF_REVIEW is still waiting, then the member says "kalah terus, ga ada gacor".
  // That is a new LOSS_COMPLAINT and must leave the old proof workflow instead of replying
  // "bukti/foto masih dalam pengecekan".
  const waitingWorkflowType=String(wf?.workflow_type||'');
  const waitingWorkflowIntent={
    WD_CHECK:'WITHDRAW_PROBLEM',
    DEPOSIT_VERIFY:'DEPOSIT_PROBLEM',
    DEPOSIT_CANCEL:'DEPOSIT_CANCEL',
    PROOF_REVIEW:'PROOF_REVIEW',
    RESET_PASSWORD:'FORGOT_PASSWORD',
    BONUS_CLAIM:'BONUS_REQUEST',
    FREEBET_CLAIM:'BONUS_REQUEST',
    PAYOUT_CHECK:'PAYOUT_NOT_RECEIVED',
    ACCOUNT_CHANGE:'ACCOUNT_CHANGE_REQUEST',
    ACCOUNT_LIMIT:'BANK_ACCOUNT_LIMIT',
    GAME_CHECK:'GAME_PROBLEM',
    ACCESS_CHECK:'LINK_PROBLEM',
    REGISTER_CHECK:'REGISTER_PROBLEM',
    LOSS_REVIEW:'LOSS_COMPLAINT',
    TRANSACTION_CLARIFY:'TRANSACTION_AMBIGUOUS'
  }[waitingWorkflowType]||'';
  const explicitTopicIntents=new Set([
    'WITHDRAW_PROBLEM','WITHDRAW_REQUEST','DEPOSIT_PROBLEM','DEPOSIT_CANCEL','FORGOT_PASSWORD','BONUS_REQUEST','BONUS_DAILY',
    'PAYOUT_NOT_RECEIVED','ACCOUNT_CHANGE_REQUEST','BANK_ACCOUNT_LIMIT','GAME_PROBLEM',
    'LINK_PROBLEM','LOGIN_PROBLEM','REGISTER_PROBLEM','GENERAL_DISTURBANCE','LOSS_COMPLAINT','TRANSACTION_AMBIGUOUS'
  ]);
  const sameWithdrawFamily = waitingWorkflowType==='WD_CHECK' && ['WITHDRAW_PROBLEM','WITHDRAW_REQUEST'].includes(effective);
  const isExplicitTopicSwitch = wf?.workflow_state==='WAITING_HUMAN'
    && explicitTopicIntents.has(effective)
    && effective!==waitingWorkflowIntent
    && !sameWithdrawFamily
    && !(waitingWorkflowType==='FREEBET_CLAIM' && ['BONUS_REQUEST','BONUS_DAILY'].includes(effective));

  // Follow-ups such as "sudah 10 menit", "lama", or a repeated ID must never restart slot collection.
  // Explicit new topics bypass this lock and are handled by their own workflow below.
  if(wf?.workflow_state==='WAITING_HUMAN'
    && !isExplicitTopicSwitch
    && ['WD_CHECK','DEPOSIT_VERIFY','DEPOSIT_CANCEL','PROOF_REVIEW','RESET_PASSWORD','BONUS_CLAIM','FREEBET_CLAIM','PAYOUT_CHECK','ACCOUNT_CHANGE','ACCOUNT_LIMIT','GAME_CHECK','ACCESS_CHECK','REGISTER_CHECK','LOSS_REVIEW'].includes(waitingWorkflowType)){
    const label={WD_CHECK:'WD',DEPOSIT_VERIFY:'deposit',DEPOSIT_CANCEL:'pembatalan deposit',PROOF_REVIEW:'bukti/foto',RESET_PASSWORD:'reset password',BONUS_CLAIM:'bonus',FREEBET_CLAIM:'bonus FreeBet',PAYOUT_CHECK:'kemenangan/payout',ACCOUNT_CHANGE:'ganti rekening',ACCOUNT_LIMIT:'rekening limit',GAME_CHECK:'permainan',ACCESS_CHECK:'akses',REGISTER_CHECK:'pendaftaran',LOSS_REVIEW:'keluhan'}[waitingWorkflowType]||'permintaan';
    const reply=`Mohon ditunggu sebentar ya bosku 🙏 Permintaan ${label} masih dalam pengecekan staff. Begitu ada hasil, langsung kami informasikan.`;
    await sendAndStore(livechat,chatId,reply,effective);
    return {intent:effective,workflow:waitingWorkflowType,state:'WAITING_HUMAN',sent:true,reply,waitingHuman:true};
  }

  // Cancel/reject Deposit: ask only for User ID, then route to Telegram.
  if(effective==='DEPOSIT_CANCEL' || wf?.workflow_type==='DEPOSIT_CANCEL'){
    const prev=wf?.workflow_data||{};
    const asked=wf?.workflow_type==='DEPOSIT_CANCEL' && !prev.userId;
    const uid=extractUserIdFromText(text) || (asked?extractRequestedUserIdFromText(text):'') || prev.userId || (asked?extractStandaloneRequestedUserId(ctx):'');
    if(!uid){
      return askAndTrack(livechat,chatId,'DEPOSIT_CANCEL','DEPOSIT_CANCEL','WAITING_ID',{},'Boleh kirim User ID akunnya ya bosku 🙏 Biar kami bantu batalkan permintaan depositnya.');
    }
    const question=`🛑 BATALKAN / REJECT DEPOSIT

UserID : ${uid}

minta batalkan fom deposit nya`;
    const result=await makeHumanRequest({chatId,eventId,intent:'DEPOSIT_CANCEL',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question,requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'DEPOSIT_CANCEL',state:'WAITING_HUMAN',data:{userId:uid,humanRequestId:result.humanRequestId}});
    return result;
  }

  // Ambiguous "saldo/uang belum masuk": do not guess DP vs WD.
  // First ask which transaction the member means. On the next short answer,
  // switch into the deterministic DP or WD workflow.
  if(wf?.workflow_type==='TRANSACTION_CLARIFY' && wf?.workflow_state==='WAITING_TYPE'){
    const n=normalizeText(text);
    const saysWd=/\b(withdraw|penarikan)\b/.test(n);
    const saysDp=/\bdeposit\b/.test(n);
    if(saysWd){
      await db.clearConversationWorkflow(chatId);
      const uid=extractUserIdFromText(text) || extractRequestedUserIdFromText(text);
      if(!uid){
        return askAndTrack(livechat,chatId,'WITHDRAW_PROBLEM','WD_CHECK','WAITING_ID',{requestType:'PROBLEM'},'Boleh kirim ID akunnya ya bosku 🙏 Biar kami bantu cek kepastian WD-nya.');
      }
    }
    if(saysDp){
      await db.clearConversationWorkflow(chatId);
      return askAndTrack(livechat,chatId,'DEPOSIT_PROBLEM','DEPOSIT_VERIFY','WAITING_ID',{},'Boleh kirim User ID akunnya dulu ya bosku 🙏 Biar kami lanjut cek depositnya.');
    }
    return askAndTrack(livechat,chatId,'TRANSACTION_AMBIGUOUS','TRANSACTION_CLARIFY','WAITING_TYPE',wf?.workflow_data||{},'Yang belum masuk deposit atau withdraw-nya ya bosku?');
  }

  if(effective==='TRANSACTION_AMBIGUOUS'){
    return askAndTrack(
      livechat,chatId,'TRANSACTION_AMBIGUOUS','TRANSACTION_CLARIFY','WAITING_TYPE',
      {originalText:String(text||'').slice(0,500)},
      'Yang belum masuk deposit atau withdraw-nya ya bosku?'
    );
  }

  // v1.31 Website Profile is the authoritative source for website identity and active links.
  // This runs before Menu Penting so stale links/history can never override the current profile.
  if(effective==='LINK_ACCESS'){
    const profile=await db.getSetting('website_profile',{})||{};
    const alternatives=(Array.isArray(profile.alternativeLinks)?profile.alternativeLinks:[]).filter(x=>x&&x.active!==false&&String(x.url||'').trim()).sort((a,b)=>Number(b.priority||0)-Number(a.priority||0));
    const urls=[profile.mainUrl?`Link Utama: ${profile.mainUrl}`:'',...alternatives.map((x,i)=>`${x.label||`Link Alternatif ${i+1}`}: ${x.url}`),profile.registerUrl?`Link Daftar: ${profile.registerUrl}`:''].filter(Boolean);
    if(urls.length){
      const name=String(profile.siteName||'website kami').trim();
      const reply=`Link akses ${name} yang aktif saat ini ya bosku 😊\n\n${urls.join('\n')}`.slice(0,1800);
      await sendAndStore(livechat,chatId,reply,effective);
      const notice=await notifyTelegramEvent({intent:effective,chatId,text:`Member meminta link akses. Website Profile aktif sudah dikirim.\nPesan member: ${text}`,title:'LINK AKSES'});
      return {intent:effective,sent:true,reply,source:'WEBSITE_PROFILE',telegramNotified:Boolean(notice?.ok)};
    }
  }
  if(effective==='RTP_INFO'){
    const profile=await db.getSetting('website_profile',{})||{};
    if(String(profile.rtpUrl||'').trim()){
      const reply=`Untuk informasi RTP yang tersedia, bosku bisa cek melalui link resmi ini ya 😊\n${String(profile.rtpUrl).trim()}`;
      await sendAndStore(livechat,chatId,reply,effective);
      return {intent:effective,sent:true,reply,source:'WEBSITE_PROFILE_RTP'};
    }
  }

  // Menu Penting remains the authoritative source for other current operational data.
  if(['LINK_ACCESS','RTP_INFO','PREDIKSI_TOGEL'].includes(effective)){
    const wanted={LINK_ACCESS:'LINK',RTP_INFO:'RTP',PREDIKSI_TOGEL:'PREDIKSI_TOGEL'}[effective];
    const rows=(await db.getRelevantImportantInfo(text,20)).filter(x=>String(x.item_type||'').toUpperCase()===wanted);
    if(rows.length){
      const best=rows[0];
      const reply=String(best.content||'').trim().slice(0,1800);
      if(reply){await sendAndStore(livechat,chatId,reply,effective);const notice=effective==='LINK_ACCESS'?await notifyTelegramEvent({intent:effective,chatId,text:`Member meminta link akses. Link resmi dari Menu Penting sudah dikirim.\nPesan member: ${text}`,title:'LINK AKSES'}):{ok:true,skipped:'not_required'};return {intent:effective,sent:true,reply,source:`IMPORTANT_${wanted}`,importantId:best.id,telegramNotified:Boolean(notice?.ok)};}
    }
    return makeHumanRequest({chatId,eventId,intent:effective==='LINK_ACCESS'?'LINK_PROBLEM':effective,text,livechat,telegram:effective==='LINK_ACCESS',holding:'',question:`Data ${wanted} yang aktif belum ditemukan di Menu Penting. Tolong beri jawaban resmi untuk member.`,requireTelegramDelivery:effective==='LINK_ACCESS'});
  }

  // Loss/rungkad: respond naturally and supportively. Do NOT misroute to deposit,
  // do NOT ask for ID/proof, and do NOT promise a win/JP. RTP may be offered only
  // as reference information and, if requested, must come from Menu Penting.
  if(effective==='LOSS_COMPLAINT'){
    const all=customerTexts(ctx).slice(-6).join(' | ');
    const reply=await responseText(
      '#KOMPLAIN_KALAH',
      'Jangan berkecil hati ya bosku 😊 Kami paham kalau sedang kalah terus memang bikin kesal. Kalau bosku mau, kami bisa bantu berikan informasi RTP yang sedang tersedia sebagai referensi ya bosku. Tetap bermain dengan sabar dan sesuai batas yang nyaman. Semoga permainan berikutnya lebih baik dan mendapatkan hasil yang menyenangkan 🙏'
    );
    await sendAndStore(livechat,chatId,reply,'LOSS_COMPLAINT');
    await db.clearConversationWorkflow(chatId).catch(()=>{});
    const notice=await notifyTelegramEvent({
      intent:'LOSS_COMPLAINT',
      chatId,
      title:'KELUHAN KALAH / RUNGKAD',
      text:`Member mengeluh kalah/rungkad. Bot sudah memberi respons tenang dan menawarkan RTP sebagai referensi tanpa jaminan hasil.\n\n${all.slice(-900)}`
    }).catch(()=>({ok:false}));
    return {intent:'LOSS_COMPLAINT',sent:true,reply,telegramNotified:Boolean(notice?.ok),lossSupport:true};
  }

  // Member kasar/emosi: tetap tenang. Tidak pernah membalas kasar.
  if(['ABUSIVE','COMPLAINT'].includes(effective)){
    const count=abuseCount(ctx);
    if(effective==='ABUSIVE' && count>=3){
      const reply=await responseText('#KOMPLAIN_MAKI_ULANG','Mohon maaf bosku 🙏 Oke bosku, kalau ada kendala yang mau dibantu cek kabari kami ya.');
      await sendAndStore(livechat,chatId,reply,effective);
      return {intent:effective,sent:true,reply,complaintMode:'REPEATED_ABUSE'};
    }
    const reply=await responseText('#KOMPLAIN_MAKI','Mohon maaf ya bosku 🙏 Ada kendala apa yang bisa kami bantu cek?');
    await sendAndStore(livechat,chatId,reply,effective);
    return {intent:effective,sent:true,reply,complaintMode:'CALM'};
  }

  // Generic proof/photo review: when member sends a screenshot/photo first, ask only for ID.
  // Once ID + photo are available, send the ACTUAL photo to Telegram (not a raw image link)
  // with triage buttons: Deposit done / WD sedang diproses / Clear cache.
  if(wf?.workflow_type==='PROOF_REVIEW' || (latestProof(ctx) && ['GENERAL','GREETING','UNKNOWN'].includes(effective))){
    const prev=wf?.workflow_data||{};
    const proof=latestProof(ctx);
    const userId=currentCaseUserId(text,wf,ctx) || prev.userId || '';
    const data={...prev,userId,proofUrl:proof?.url||prev.proofUrl||''};
    if(!data.userId){
      return askAndTrack(livechat,chatId,'DEPOSIT_PROBLEM','PROOF_REVIEW','WAITING_ID',data,'Boleh kirim user ID-nya ya bosku 🙏 Bukti/fotonya sudah kami terima.');
    }
    if(data.proofUrl){
      const result=await makeHumanRequest({
        chatId,eventId,intent:'DEPOSIT_PROBLEM',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,
        question:`📷 CEK BUKTI MEMBER\n\nUser ID : ${data.userId}\n\nSilakan cek foto/bukti member.`,
        requireTelegramDelivery:true
      });
      if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'PROOF_REVIEW',state:'WAITING_HUMAN',data:{...data,humanRequestId:result.humanRequestId}});
      return result;
    }
  }

  // Legacy regression compatibility only; runtime v1.27.5 asks ID first:
// Boleh kirim user ID sama bukti transfernya ya bosku
// user ID sama bukti transfernya
// Deposit complaint: member may send ID and proof separately. Persist/merge both, then send one verification ticket to Telegram CS.
  if(['DEPOSIT_PROBLEM','DEPOSIT_REQUEST'].includes(effective) || wf?.workflow_type==='DEPOSIT_VERIFY'){
    const workflowAskedForId = wf?.workflow_type==='DEPOSIT_VERIFY' && !wf?.workflow_data?.userId;
    const userId=currentCaseUserId(text,wf,ctx) || (workflowAskedForId ? extractStandaloneRequestedUserId(ctx) : '');
    const proof=latestProof(ctx);
    const mustBeNewProof=['WAITING_DETAIL_PROOF','WAITING_CLEAR_PROOF'].includes(String(wf?.workflow_state||''));
    const proofIsNew=Boolean(proof?.url && (!mustBeNewProof || proof.url!==wf?.workflow_data?.previousProofUrl));
    const data={...(wf?.workflow_data||{}),userId:userId||wf?.workflow_data?.userId||'',proofUrl:proofIsNew?proof.url:(mustBeNewProof?'':(wf?.workflow_data?.proofUrl||''))};
    const missing=[]; if(!data.userId)missing.push('user ID'); if(!data.proofUrl)missing.push('bukti transfer');
    if(missing.length){
      if(!data.userId && !data.proofUrl){
        return askAndTrack(
          livechat,chatId,'DEPOSIT_PROBLEM','DEPOSIT_VERIFY','WAITING_ID',
          data,
          'Boleh kirim User ID akunnya dulu ya bosku 🙏 Setelah ID kami terima, baru kami lanjut cek bukti transfer depositnya.'
        );
      }
      if(!data.userId){
        return askAndTrack(
          livechat,chatId,'DEPOSIT_PROBLEM','DEPOSIT_VERIFY','WAITING_ID',
          data,
          'Boleh kirim User ID akunnya ya bosku 🙏 Bukti transfernya sudah kami terima.'
        );
      }
      return askAndTrack(
        livechat,chatId,'DEPOSIT_PROBLEM','DEPOSIT_VERIFY','WAITING_PROOF',
        data,
        'Boleh kirim bukti transfernya ya bosku 🙏 User ID-nya sudah kami terima.'
      );
    }
    const depositAmount=extractOperationalAmount(ctx);
    const depositAmountLine=depositAmount?`
Nominal : Rp${depositAmount.toLocaleString('id-ID')}`:'';
    const result=await makeHumanRequest({
      chatId,eventId,intent:'DEPOSIT_PROBLEM',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,
      question:`💰 DEPOSIT PROBLEM

User ID : ${data.userId}${depositAmountLine}

Bukti transfer ikut terlampir.
Silakan cek deposit member.`,
      requireTelegramDelivery:true
    });
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'DEPOSIT_VERIFY',state:'WAITING_HUMAN',data:{...data,humanRequestId:result.humanRequestId}});
    return result;
  }

  // Reset password: NEVER ask user ID. Collect registered account data one slot at a time.
  // Required fields: jenis rekening/bank/e-wallet, nama rekening, nomor rekening.
  // Member may send name -> bank/e-wallet -> account number in separate messages; we persist and merge them.
  if(effective==='FORGOT_PASSWORD' || wf?.workflow_type==='RESET_PASSWORD'){
    const prev=wf?.workflow_data||{};
    const data=inferResetAccountData(ctx,prev);
    const resetHistory=customerTexts(ctx).join(' ');
    const forgotUserId=Boolean(prev.forgotUserId || /\b(?:lupa|lpa)\s*(?:user\s*)?id\b/i.test(resetHistory) || /\b(?:id|user\s*id)\s*(?:lupa|hilang|tidak ingat)\b/i.test(resetHistory));
    data.forgotUserId=forgotUserId;

    // Staff previously asked member to deposit first. Once member confirms deposit, re-open a fresh reset ticket.
    if(wf?.workflow_type==='RESET_PASSWORD' && wf?.workflow_state==='WAITING_DEPOSIT'){
      const proof=latestProof(ctx);
      const proofIsNew=Boolean(proof?.url && proof.url!==prev.previousProofUrl);
      const merged={...data,proofUrl:proofIsNew?proof.url:(prev.proofUrl||'')};
      await db.setConversationWorkflow(chatId,{type:'RESET_PASSWORD',state:'WAITING_DEPOSIT',data:merged});
      const depositConfirmed=isDepositConfirmedText(text) || proofIsNew;
      if(depositConfirmed && !merged.proofUrl){
        return askAndTrack(livechat,chatId,'FORGOT_PASSWORD','RESET_PASSWORD','WAITING_DEPOSIT_PROOF',merged,'Boleh kirim bukti deposit verifikasinya ya bosku 🙏 Setelah bukti kami terima, langsung kami lanjutkan pengecekan reset password.');
      }
      if(depositConfirmed && merged.proofUrl){
        const result=await makeHumanRequest({
          chatId,eventId,intent:'FORGOT_PASSWORD',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,
          question:`🔐 RESET PASSWORD — VERIFIKASI DEPOSIT

DATA REKENING/WALLET YANG MAU DI RESET
Nama Rekening : ${merged.name||'-'}
No Rek/Wallet : ${merged.no||'-'}
Jenis         : ${merged.type||'-'}

✅ Member sudah deposit untuk verifikasi kepemilikan akun.
Bukti verifikasi ikut terlampir.

Silakan cek apakah deposit masuk. Jika sudah masuk, REPLY ticket ini dengan:
USER ID
PASSWORD
LINK`,
          requireTelegramDelivery:true
        });
        if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'RESET_PASSWORD',state:'WAITING_HUMAN',data:{...merged,humanRequestId:result.humanRequestId}});
        return result;
      }
      return {intent:'FORGOT_PASSWORD',workflow:'RESET_PASSWORD',state:'WAITING_DEPOSIT',sent:false,waitingDeposit:true};
    }
    if(wf?.workflow_type==='RESET_PASSWORD' && wf?.workflow_state==='WAITING_DEPOSIT_PROOF'){
      const proof=latestProof(ctx);
      const merged={...data,proofUrl:proof?.url||prev.proofUrl||''};
      if(!merged.proofUrl){
        return askAndTrack(livechat,chatId,'FORGOT_PASSWORD','RESET_PASSWORD','WAITING_DEPOSIT_PROOF',merged,'Boleh kirim bukti deposit verifikasinya ya bosku 🙏');
      }
      const result=await makeHumanRequest({
        chatId,eventId,intent:'FORGOT_PASSWORD',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,
        question:`🔐 RESET PASSWORD — VERIFIKASI DEPOSIT

DATA REKENING/WALLET YANG MAU DI RESET
Nama Rekening : ${merged.name||'-'}
No Rek/Wallet : ${merged.no||'-'}
Jenis         : ${merged.type||'-'}

✅ Bukti deposit verifikasi sudah diterima dan ikut terlampir.
Silakan cek apakah deposit masuk. Jika sudah masuk, REPLY ticket ini dengan:
USER ID
PASSWORD
LINK`,
        requireTelegramDelivery:true
      });
      if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'RESET_PASSWORD',state:'WAITING_HUMAN',data:{...merged,humanRequestId:result.humanRequestId}});
      return result;
    }

    const missing=resetMissing(data);
    if(missing.length){
      const field=missing[0];
      return askAndTrack(livechat,chatId,'FORGOT_PASSWORD','RESET_PASSWORD','COLLECTING',data,resetAskFor(field,missing));
    }
    const result=await makeHumanRequest({chatId,eventId,intent:'FORGOT_PASSWORD',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question:`${data.forgotUserId?'🔐 LUPA ID + RESET PASSWORD':'🔐 RESET PASSWORD'}

NO REK ${data.no}
a/n ${data.name}
JENIS REK : ${data.type||'-'}

${data.forgotUserId?'Member lupa User ID dan password. Mohon cari akun dari data rekening/e-wallet terdaftar lalu kirim USER ID + PASSWORD + LINK.':'reset password ko'}`,requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'RESET_PASSWORD',state:'WAITING_HUMAN',data:{...data,humanRequestId:result.humanRequestId}});
    return result;
  }

  // Legacy regression compatibility: holding:WD_WAITING_STAFF_REPLY
  // Every WD problem goes to Telegram staff. Ask member ID only if it is not already present. // kendala wd
  // Continue an active WD ID collection BEFORE relying on the current-message intent.
  // Members often answer only `CHAGE` or `id. CHAGE`, which normalizes to GENERAL.
  // Once an ID is present, Telegram delivery is mandatory before acknowledging the check.
  if(wf?.workflow_type==='WD_CHECK' && wf?.workflow_state==='WAITING_ID'){
    // Legacy regression marker: holding:WD_WAITING_STAFF_REPLY
    const uid=extractUserIdFromText(text) || extractRequestedUserIdFromText(text);
    const isEligibility=wf?.workflow_data?.requestType==='ELIGIBILITY';
    const wdIntent=isEligibility?'WITHDRAW_REQUEST':'WITHDRAW_PROBLEM';
    if(!uid) return askAndTrack(livechat,chatId,wdIntent,'WD_CHECK','WAITING_ID',wf?.workflow_data||{},'Boleh kirim ID akunnya ya bosku 🙏');
    const all=customerTexts(ctx).slice(-5).join(' | ');
    const question=isEligibility
      ? `💸 CEK KELAYAKAN / PERMINTAAN WD\nID : ${uid}\n\nMember menanyakan kapan / apakah sudah bisa WD.\n${all.slice(-500)}`
      : `💸 CEK WITHDRAW\nID : ${uid}${extractOperationalAmount(ctx)?`\nNominal : Rp${extractOperationalAmount(ctx).toLocaleString('id-ID')}`:''}\n\ncek kepastian wd\n${all.slice(-500)}`;
    const holding=isEligibility
      ? 'Mohon tunggu sebentar ya bosku 😊🙏 Kami bantu tanyakan ke staff terlebih dahulu apakah akun bosku sudah bisa melakukan WD.'
      : WD_WAITING_STAFF_REPLY;
    const result=await makeHumanRequest({
      chatId,eventId,intent:wdIntent,text,livechat,telegram:true,holding,question,
      requireTelegramDelivery:true
    });
    // Keep workflow state if Telegram is temporarily unavailable so the pending request
    // remains recoverable and the member is never told that WD is already processing.
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'WD_CHECK',state:'WAITING_HUMAN',data:{...(wf?.workflow_data||{}),userId:uid,humanRequestId:result.humanRequestId}});
    return result;
  }

  if(['WITHDRAW_PROBLEM','WITHDRAW_REQUEST'].includes(effective)){
    const isEligibility=effective==='WITHDRAW_REQUEST';
    const uid=extractUserIdFromText(text) || extractRequestedUserIdFromText(text);
    if(!uid){
      const ask=isEligibility
        ? 'Boleh kirim ID akunnya ya bosku 🙏 Biar kami bantu cek apakah akun bosku sudah bisa melakukan WD.'
        : 'Boleh kirim ID akunnya ya bosku 🙏 Biar kami bantu cek kepastian WD-nya.';
      return askAndTrack(livechat,chatId,effective,'WD_CHECK','WAITING_ID',{requestType:isEligibility?'ELIGIBILITY':'PROBLEM'},ask);
    }
    const all=customerTexts(ctx).slice(-5).join(' | ');
    const question=isEligibility
      ? `💸 CEK KELAYAKAN / PERMINTAAN WD\nID : ${uid}\n\nMember menanyakan kapan / apakah sudah bisa WD.\n${all.slice(-500)}`
      : `💸 CEK WITHDRAW\nID : ${uid}${extractOperationalAmount(ctx)?`\nNominal : Rp${extractOperationalAmount(ctx).toLocaleString('id-ID')}`:''}\n\ncek kepastian wd\n${all.slice(-500)}`;
    const holding=isEligibility
      ? 'Mohon tunggu sebentar ya bosku 😊🙏 Kami bantu tanyakan ke staff terlebih dahulu apakah akun bosku sudah bisa melakukan WD.'
      : WD_WAITING_STAFF_REPLY;
    const result=await makeHumanRequest({
      chatId,eventId,intent:effective,text,livechat,telegram:true,holding,question,requireTelegramDelivery:true
    });
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'WD_CHECK',state:'WAITING_HUMAN',data:{userId:uid,requestType:isEligibility?'ELIGIBILITY':'PROBLEM',humanRequestId:result.humanRequestId}});
    return result;
  }

  // Informational bonus questions
  // Bonus information: Bekal Bot is authoritative. Menu Penting PROMO is legacy fallback.
  if(effective==='BONUS_INFO'){
    const promo=await bestPromo(text);
    if(promo){
      const reply=String(promoForMember(promo,{full:false})||promoForMember(promo,{full:true})).slice(0,3500);
      await sendAndStore(livechat,chatId,reply,'BONUS_INFO');
      return {intent:'BONUS_INFO',sent:true,reply,source:'BEKAL_BOT',promoId:promo.id,bonusType:String(promo.name||'').toUpperCase()};
    }
    const matched=(await db.getRelevantImportantInfo(text,12)).filter(x=>String(x.item_type||'').toUpperCase()==='PROMO');
    const n=normalizeText(text);
    let reply=''; let source='IMPORTANT_PROMO_FALLBACK';
    if(matched.length && !/^(bonus|promo|event)( apa| apa saja| apa aja| apa yang ada| saja| aja)?$/i.test(n)){
      reply=String(matched[0].content||'').trim();
    }else{
      const allPromos=await db.listPromoRules({activeOnly:true,limit:100});
      if(allPromos.length){
        reply=`Promo & event yang sedang aktif ya bosku 😊\n\n${allPromos.map(x=>`🔥 ${x.name}`).join('\n')}\n\nKalau bosku mau tahu detail salah satunya, sebutkan nama promonya ya.`;
        source='BEKAL_BOT_LIST';
      }else{
        const all=await db.listImportantInfo({activeOnly:true,type:'PROMO',limit:100});
        if(all.length) reply=`Promo & event yang sedang aktif ya bosku 😊\n\n${all.map(x=>`🔥 ${x.title}`).join('\n')}\n\nKalau bosku mau tahu detail salah satunya, sebutkan nama promonya ya.`;
        else { reply=await responseText('#BONUS_MINGGUAN','Untuk informasi promo terbaru, boleh tunggu sebentar ya bosku. Kami cek dulu promo yang sedang aktif.'); source='RESPONSES_MANUAL_FALLBACK'; }
      }
    }
    reply=String(reply||'').slice(0,3500);
    await sendAndStore(livechat,chatId,reply,'BONUS_INFO');
    return {intent:'BONUS_INFO',sent:true,reply,source};
  }

  // Generic bonus claim: ask which bonus first, then ensure member ID exists before Telegram.
  if(effective==='BONUS_REQUEST' && wf?.workflow_type!=='BONUS_CLAIM'){
    const bonusType=await resolveBonusLabel(text);
    if(isFreebet50(text,bonusType)){
      const uid=currentCaseUserId(text,wf,ctx);
      return startFreebetTerms({chatId,text,livechat,userId:uid});
    }
    if(isNewMemberBonus(bonusType,text) || isRondaBonus(bonusType,text)){
      const isNew=isNewMemberBonus(bonusType,text);
      const canonical=isNew?'BONUS NEW MEMBER':'BONUS RONDA';
      const promo=await bestPromo(`${bonusType} ${text}`);
      const terms=promo?promoForMember(promo,{full:true}):(isNew?NEW_MEMBER_TERMS:RONDA_TERMS);
      await sendAndStore(livechat,chatId,terms,'BONUS_REQUEST');
      const uid=currentCaseUserId(text,wf,ctx);
      if(!uid){
        return askAndTrack(livechat,chatId,'BONUS_REQUEST','BONUS_CLAIM','WAITING_ID',{bonusType:canonical,rulesShown:true},'Jika ingin claim, boleh kirim ID akunnya ya bosku 🙏');
      }
      const question=`🎁 CLAIM ${canonical}
ID : ${uid}

Rules ${canonical} sudah diinformasikan ke member.
Silakan cek kelayakan claim member.`;
      const result=await makeHumanRequest({chatId,eventId,intent:'BONUS_REQUEST',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question,requireTelegramDelivery:true});
      if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'BONUS_CLAIM',state:'WAITING_HUMAN',data:{bonusType:canonical,rulesShown:true,userId:uid,humanRequestId:result.humanRequestId,bonusStage:'WAITING_STAFF'}});
      return result;
    }
    if(!bonusType){
      return askAndTrack(livechat,chatId,'BONUS_REQUEST','BONUS_CLAIM','ASK_TYPE',{},await responseText('#BONUS_TANYA','Bonus apa yang mau diklaim ya bosku? 😊'));
    }
    // If the claim type is already known but the account ID is not, enter the explicit
    // WAITING_ID state now. This lets terse follow-up replies be parsed deterministically.
    const uid=currentCaseUserId(text,wf,ctx);
    if(!uid){
      return askAndTrack(livechat,chatId,'BONUS_REQUEST','BONUS_CLAIM','WAITING_ID',{bonusType},'Boleh kirim ID akunnya ya bosku 🙏');
    }
    // Legacy regression marker: claim bonus ${String(bonusType).toLowerCase()} — requireTelegramDelivery:true
    const result=await makeHumanRequest({chatId,eventId,intent:'BONUS_REQUEST',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question:formatBonusClaimQuestion(uid,bonusType),requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'BONUS_CLAIM',state:'WAITING_HUMAN',data:{bonusType,userId:uid,humanRequestId:result.humanRequestId,bonusStage:'WAITING_STAFF'}});
    return result;
  }
  if(wf?.workflow_type==='BONUS_CLAIM' && wf?.workflow_state==='ASK_TYPE'){
    const bonusType=await resolveBonusLabel(text) || String(text||'').trim().slice(0,120);
    const uid=currentCaseUserId(text,wf,ctx);
    if(!uid) return askAndTrack(livechat,chatId,'BONUS_REQUEST','BONUS_CLAIM','WAITING_ID',{bonusType},'Boleh kirim ID akunnya ya bosku 🙏');
    // Legacy regression marker: claim bonus ${String(bonusType).toLowerCase()} — requireTelegramDelivery:true
    const result=await makeHumanRequest({chatId,eventId,intent:'BONUS_REQUEST',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question:formatBonusClaimQuestion(uid,bonusType),requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'BONUS_CLAIM',state:'WAITING_HUMAN',data:{bonusType,userId:uid,humanRequestId:result.humanRequestId,bonusStage:'WAITING_STAFF'}});
    return result;
  }
  if(wf?.workflow_type==='BONUS_CLAIM' && wf?.workflow_state==='WAITING_ID'){
    const uid=extractUserIdFromText(text) || extractRequestedUserIdFromText(text);
    const bonusType=String(wf?.workflow_data?.bonusType||'bonus').trim();
    if(!uid) return askAndTrack(livechat,chatId,'BONUS_REQUEST','BONUS_CLAIM','WAITING_ID',{bonusType},'Boleh kirim ID akunnya ya bosku 🙏');
    const isSpecial=isNewMemberBonus(bonusType,'') || isRondaBonus(bonusType,'');
    const question=isSpecial
      ? `🎁 CLAIM ${bonusType}\nID : ${uid}\n\nRules ${bonusType} sudah diinformasikan ke member.\nSilakan cek kelayakan claim member.`
      : formatBonusClaimQuestion(uid,bonusType);
    const result=await makeHumanRequest({chatId,eventId,intent:'BONUS_REQUEST',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question,requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'BONUS_CLAIM',state:'WAITING_HUMAN',data:{bonusType,rulesShown:Boolean(wf?.workflow_data?.rulesShown),userId:uid,humanRequestId:result.humanRequestId,bonusStage:'WAITING_STAFF'}});
    return result;
  }

  // Specific bonus (contoh: bonus harian). Pastikan ID ada sebelum lempar ke grup Bonus.
  if(effective.includes('BONUS')){
    const bonusType=await resolveBonusLabel(text) || effective.replace(/^BONUS_?/,'').replaceAll('_',' ');
    if(isFreebet50(text,bonusType)){
      const freebetUid=currentCaseUserId(text,wf,ctx);
      return startFreebetTerms({chatId,text,livechat,userId:freebetUid});
    }
    // A specific bonus intent (BONUS_DAILY, BONUS_MONTHLY, etc.) already gives us
    // enough context to safely parse an inline member ID from the *first* message.
    // Example: `Bonus deposit harian Safa01` must capture Safa01 immediately instead
    // of entering WAITING_ID and asking for the same ID again.
    const uid=currentCaseUserId(text,wf,ctx) || (wf?.workflow_type==='BONUS_CLAIM' ? extractStandaloneRequestedUserId(ctx) : '');
    if(!uid) return askAndTrack(livechat,chatId,effective,'BONUS_CLAIM','WAITING_ID',{bonusType},'Boleh kirim ID akunnya ya bosku 🙏');
    await db.appendCaseAudit({chatId,eventType:'BONUS_INLINE_ID_READY',intent:effective,payload:{bonusType,userId:uid,sourceEventId:eventId||null}}).catch(()=>{});
    const result=await makeHumanRequest({chatId,eventId,intent:effective,text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question:formatBonusClaimQuestion(uid,bonusType),requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'BONUS_CLAIM',state:'WAITING_HUMAN',data:{bonusType,userId:uid,humanRequestId:result.humanRequestId,bonusStage:'WAITING_STAFF'}});
    return result;
  }

  // Kemenangan/payout belum dibayar: kumpulkan ID + bukti/riwayat, lalu WAJIB Telegram.
  if(effective==='PAYOUT_NOT_RECEIVED' || wf?.workflow_type==='PAYOUT_CHECK'){
    const workflowAskedForId=wf?.workflow_type==='PAYOUT_CHECK' && !wf?.workflow_data?.userId;
    const uid=extractUserIdFromText(text) || (workflowAskedForId?extractRequestedUserIdFromText(text):'') || extractUserId(ctx) || (workflowAskedForId?extractStandaloneRequestedUserId(ctx):'');
    const proof=latestProof(ctx);
    const data={...(wf?.workflow_data||{}),userId:uid||wf?.workflow_data?.userId||'',proofUrl:proof?.url||wf?.workflow_data?.proofUrl||''};
    const missing=[]; if(!data.userId) missing.push('ID akun'); if(!data.proofUrl) missing.push('screenshot kemenangan / riwayat permainan');
    if(missing.length){
      const reply=missing.length===2?'Boleh kirim ID akun dan screenshot kemenangan/riwayat permainannya ya bosku 🙏 Biar kami bantu cek pembayarannya.':missing[0]==='ID akun'?'Boleh kirim ID akunnya ya bosku 🙏 Bukti kemenangannya sudah kami terima.':'Boleh kirim screenshot kemenangan atau riwayat permainannya ya bosku 🙏 ID akun sudah kami terima.';
      return askAndTrack(livechat,chatId,'PAYOUT_NOT_RECEIVED','PAYOUT_CHECK','COLLECTING',data,reply);
    }
    const all=customerTexts(ctx).slice(-8).join(' | ');
    const result=await makeHumanRequest({chatId,eventId,intent:'PAYOUT_NOT_RECEIVED',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question:`💰 KEMENANGAN / PAYOUT BELUM DIBAYAR
ID : ${data.userId}
Bukti/riwayat ikut terlampir.
${all.slice(-700)}`,requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'PAYOUT_CHECK',state:'WAITING_HUMAN',data:{...data,humanRequestId:result.humanRequestId}});
    return result;
  }

  // Ganti rekening adalah perubahan sensitif: kumpulkan ID + rekening/wallet baru lalu WAJIB Telegram.
  if(effective==='ACCOUNT_CHANGE_REQUEST' || wf?.workflow_type==='ACCOUNT_CHANGE'){
    const workflowAskedForId=wf?.workflow_type==='ACCOUNT_CHANGE' && !wf?.workflow_data?.userId;
    const uid=extractUserIdFromText(text) || (workflowAskedForId?extractRequestedUserIdFromText(text):'') || extractUserId(ctx) || (workflowAskedForId?extractStandaloneRequestedUserId(ctx):'');
    const account=extractAccountData(ctx); const prev=wf?.workflow_data||{};
    const data={...prev,userId:uid||prev.userId||'',type:account.type||prev.type||'',name:account.name||prev.name||'',no:account.no||prev.no||''};
    const missing=[]; if(!data.userId) missing.push('ID akun'); if(!data.type) missing.push('jenis rekening/e-wallet'); if(!data.name) missing.push('atas nama'); if(!data.no) missing.push('nomor rekening/e-wallet');
    if(missing.length){
      const reply=`Boleh dibantu ${missing.join(', ')} ya bosku 🙏 Data ini diperlukan untuk meneruskan permintaan ganti rekening.`;
      return askAndTrack(livechat,chatId,'ACCOUNT_CHANGE_REQUEST','ACCOUNT_CHANGE','COLLECTING',data,reply);
    }
    const result=await makeHumanRequest({chatId,eventId,intent:'ACCOUNT_CHANGE_REQUEST',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question:`🏦 GANTI REKENING — minta ganti rekening
ID : ${data.userId}
Jenis : ${data.type}
Atas nama : ${data.name}
No rek/wallet : ${data.no}
Mohon verifikasi kepemilikan sebelum perubahan.`,requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'ACCOUNT_CHANGE',state:'WAITING_HUMAN',data:{...data,humanRequestId:result.humanRequestId}});
    return result;
  }

  // Rekening/e-wallet limit: perlu ID agar staff dapat menentukan penanganan yang benar.
  if(effective==='BANK_ACCOUNT_LIMIT' || wf?.workflow_type==='ACCOUNT_LIMIT'){
    const workflowAskedForId=wf?.workflow_type==='ACCOUNT_LIMIT' && !wf?.workflow_data?.userId;
    const uid=extractUserIdFromText(text) || (workflowAskedForId?extractRequestedUserIdFromText(text):'') || extractUserId(ctx) || (workflowAskedForId?extractStandaloneRequestedUserId(ctx):'');
    const account=extractAccountData(ctx); const data={...(wf?.workflow_data||{}),userId:uid||wf?.workflow_data?.userId||'',type:account.type||wf?.workflow_data?.type||'',name:account.name||wf?.workflow_data?.name||'',no:account.no||wf?.workflow_data?.no||''};
    if(!data.userId) return askAndTrack(livechat,chatId,'BANK_ACCOUNT_LIMIT','ACCOUNT_LIMIT','WAITING_ID',data,'Boleh kirim ID akunnya ya bosku 🙏 Biar kendala rekening limitnya kami teruskan untuk dicek.');
    const all=customerTexts(ctx).slice(-6).join(' | ');
    const result=await makeHumanRequest({chatId,eventId,intent:'BANK_ACCOUNT_LIMIT',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question:`🏦 REKENING / E-WALLET LIMIT
ID : ${data.userId}
${data.type?`Jenis : ${data.type}
`:''}${data.name?`Atas nama : ${data.name}
`:''}${data.no?`Nomor : ${data.no}
`:''}${all.slice(-600)}`,requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'ACCOUNT_LIMIT',state:'WAITING_HUMAN',data:{...data,humanRequestId:result.humanRequestId}});
    return result;
  }

  // Pendaftaran member baru: collect structured data, email/phone optional.
  if(effective==='REGISTER_REQUEST' || wf?.workflow_type==='REGISTER_CREATE'){
    const prev=wf?.workflow_data||{};
    const sessionRows=await db.getCurrentSessionContext(chatId,200);
    let data={...prev};
    for(const row of sessionRows){
      if(row.sender_type==='customer') data=parseRegistrationText(row.text,data);
    }
    data=parseRegistrationText(text,data);
    const missing=registrationMissing(data);

    if(!prev.formShown && missing.length>=3){
      await sendAndStore(livechat,chatId,REGISTER_FORM,'REGISTER_REQUEST');
      await db.setConversationWorkflow(chatId,{type:'REGISTER_CREATE',state:'COLLECTING',data:{...data,formShown:true}});
      return {intent:'REGISTER_REQUEST',sent:true,reply:REGISTER_FORM,collecting:true};
    }
    if(missing.length){
      const reply=`Data pendaftarannya masih kurang: ${missing.join(', ')} ya bosku 🙏\n\n${REGISTER_FORM}\n\nEmail dan Nomor Telepon boleh dikosongkan kalau belum ada.`;
      return askAndTrack(livechat,chatId,'REGISTER_REQUEST','REGISTER_CREATE','COLLECTING',{...data,formShown:true},reply);
    }
    const registrationValidation=validateRegistrationData(data);
    if(!registrationValidation.ok){
      const reply=`Ada data pendaftaran yang perlu diperbaiki ya bosku 🙏\n• ${registrationValidation.errors.join('\n• ')}\n\nSilakan kirim ulang data yang diperbaiki.`;
      return askAndTrack(livechat,chatId,'REGISTER_REQUEST','REGISTER_CREATE','COLLECTING',{...data,formShown:true},reply);
    }

    const result=await makeHumanRequest({
      chatId,eventId,intent:'REGISTER_REQUEST',text,livechat,telegram:true,
      holding:REGISTER_WAITING_REPLY,
      question:registrationTicket(data),
      requireTelegramDelivery:true
    });
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'REGISTER_CREATE',state:'WAITING_HUMAN',data:{...data,formShown:true,humanRequestId:result.humanRequestId}});
    return result;
  }

  // Login/access/barcode/general disturbance: ask for screenshot first so staff receives
  // concrete evidence. The actual image attachment is forwarded to Telegram by the bridge.
  if(['LOGIN_PROBLEM','LINK_PROBLEM','REGISTER_PROBLEM','GENERAL_DISTURBANCE'].includes(effective) || wf?.workflow_type==='ACCESS_CHECK'){
    const prev=wf?.workflow_data||{};
    const uid=currentCaseUserId(text,wf,ctx) || prev.userId || '';
    const proof=latestProof(ctx);
    const proofUrl=proof?.url || prev.proofUrl || '';
    const currentIntent=wf?.workflow_data?.originalIntent || effective;
    const normalizedIssue=normalizeText(text);
    const label=/\bqris\b|\bqr\b/.test(normalizedIssue)?'QRIS tidak muncul / tidak bisa digunakan':
      /\bbarcode\b|\bscan\b/.test(normalizedIssue)?'scan barcode tidak bisa':
      ({
        LOGIN_PROBLEM:'tidak bisa login / masuk',
        LINK_PROBLEM:'link / website tidak bisa diakses',
        REGISTER_PROBLEM:'pendaftaran gagal / tidak bisa daftar',
        GENERAL_DISTURBANCE:'gangguan umum / maintenance'
      }[currentIntent]||'gangguan akses');

    if(!proofUrl){
      return askAndTrack(
        livechat,chatId,currentIntent,'ACCESS_CHECK','WAITING_PROOF',
        {...prev,userId:uid,originalIntent:currentIntent},
        'Boleh dibantu kirimkan screenshot kendalanya ya, bosku 🙏 Agar kami bisa cek dan memberikan solusi yang tepat untuk bosku 😊🙏'
      );
    }

    const all=customerTexts(ctx).slice(-8).join(' | ');
    const result=await makeHumanRequest({
      chatId,eventId,intent:currentIntent,text,livechat,telegram:true,
      holding:'Mohon tunggu sebentar ya bosku 😊 Screenshot kendalanya sudah kami teruskan ke staff untuk dicek. Begitu ada hasil, langsung kami informasikan ya bosku 🙏',
      question:`🛠️ KENDALA AKSES / LOGIN

${uid?`ID : ${uid}
`:''}Keterangan : mohon dicek
Jenis Kendala : ${label}

${all.slice(-900)}`,
      requireTelegramDelivery:true
    });
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'ACCESS_CHECK',state:'WAITING_HUMAN',data:{...prev,userId:uid,proofUrl,originalIntent:currentIntent,humanRequestId:result.humanRequestId}});
    return result;
  }

  // Game macet/error: minta ID. Jika saldo/result bermasalah, bukti/riwayat wajib supaya staff tidak menebak.
  if(effective==='GAME_PROBLEM' || wf?.workflow_type==='GAME_CHECK'){
    const workflowAskedForId=wf?.workflow_type==='GAME_CHECK' && !wf?.workflow_data?.userId;
    const uid=extractUserIdFromText(text) || (workflowAskedForId?extractRequestedUserIdFromText(text):'') || extractUserId(ctx) || (workflowAskedForId?extractStandaloneRequestedUserId(ctx):'');
    const proof=latestProof(ctx); const impact=detectGameImpact(ctx); const prev=wf?.workflow_data||{};
    const data={...prev,userId:uid||prev.userId||'',proofUrl:proof?.url||prev.proofUrl||'',financialImpact:Boolean(prev.financialImpact||impact.financial),resultMissing:Boolean(prev.resultMissing||impact.resultMissing)};
    if(!data.userId) return askAndTrack(livechat,chatId,'GAME_PROBLEM','GAME_CHECK','WAITING_ID',data,'Boleh kirim ID akunnya ya bosku 🙏 Biar kendala gamenya kami teruskan ke staff untuk dicek.');
    if((data.financialImpact||data.resultMissing) && !data.proofUrl) return askAndTrack(livechat,chatId,'GAME_PROBLEM','GAME_CHECK','WAITING_PROOF',data,'Boleh kirim screenshot game/riwayat permainannya ya bosku 🙏 Karena ada kendala saldo atau hasil permainan, bukti diperlukan untuk pengecekan.');
    const all=customerTexts(ctx).slice(-8).join(' | '); const amount=extractOperationalAmount(ctx);
    const amountLine=amount?`\nNominal terkait : Rp${amount.toLocaleString('id-ID')}`:'';
    const financialLine=data.financialImpact?'\nDampak : saldo/taruhan terpotong':'';
    const resultLine=data.resultMissing?'\nDampak : hasil/riwayat tidak muncul':'';
    const proofLine=data.proofUrl?'\nBukti/riwayat ikut terlampir.':'';
    const result=await makeHumanRequest({chatId,eventId,intent:'GAME_PROBLEM',text,livechat,telegram:true,holding:'Siap bosku, kendala gamenya kami teruskan untuk dicek ya 🙏',question:`🎮 GAME MACET / ERROR\nID : ${data.userId}${amountLine}${financialLine}${resultLine}${proofLine}\n${all.slice(-900)}`,requireTelegramDelivery:true});
    if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'GAME_CHECK',state:'WAITING_HUMAN',data:{...data,humanRequestId:result.humanRequestId}});
    return result;
  }
  return null;
}

function normalizeShortcut(s=''){ return String(s||'').trim().replace(/^#?/,'#'); }
async function responseText(shortcut,fallback){
  const r=await db.getCannedByShortcut(normalizeShortcut(shortcut));
  return String(r?.content||fallback||'').trim().slice(0,1200);
}
function parseResetCredentialReply(text=''){
  const s=String(text||'').trim();
  if(!s) return null;
  // Telegram staff often writes the whole reset answer on ONE line, e.g.
  // `UserID : abc Password : q123 Link Login : https://...`.
  // Stop each labelled field at the next known label instead of greedily taking
  // the rest of the line. This prevents malformed credentials and guarantees the
  // reply can be delivered back to the correct LiveChat member.
  const user=(s.match(/(?:user\s*id|userid|username)\s*[:=]\s*(.+?)(?=\s+(?:password|psw|pass|link(?:\s*login)?)\s*[:=]|$)/i)||[])[1]?.trim()||'';
  const password=(s.match(/(?:password|psw|pass)\s*[:=]\s*(.+?)(?=\s+(?:user\s*id|userid|username|link(?:\s*login)?)\s*[:=]|$)/i)||[])[1]?.trim()||'';
  const labelledLink=(s.match(/(?:link(?:\s*login)?)\s*[:=]\s*(https?:\/\/[^\s]+)/i)||[])[1]?.trim()||'';
  const anyLink=(s.match(/https?:\/\/[^\s]+/i)||[])[0]?.trim()||'';
  const link=labelledLink||anyLink;
  if(user && password && link){
    const linkPos=s.indexOf(link); const tail=linkPos>=0?s.slice(linkPos+link.length).trim():'';
    const note=tail.replace(/^[\s|,;:.\-]+/,'').slice(0,600);
    return {userId:user,password,link,note};
  }
  // Normal CS shorthand: line 1 = USER ID, line 2 = PASSWORD, line 3 = LOGIN LINK.
  const lines=s.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(lines.length>=3 && !/^(?:done|belum|pending)$/i.test(lines[0])){
    const possibleLink=lines.find((x,i)=>i>=2 && /^https?:\/\//i.test(x))||'';
    if(possibleLink && lines[0].length<=120 && lines[1].length<=160){
      const idx=lines.indexOf(possibleLink); const note=idx>=0?lines.slice(idx+1).join(' ').slice(0,600):'';
      return {userId:lines[0],password:lines[1],link:possibleLink,note};
    }
  }
  return null;
}
function resetReplyComplete(text=''){ return Boolean(parseResetCredentialReply(text)); }
function resetCredentialMemberReply(parsed){
  return [
    'Reset passwordnya sudah selesai ya bosku 😊',
    '',
    `User ID: ${parsed.userId}`,
    `Password: ${parsed.password}`,
    parsed.link?`Link: ${parsed.link}`:'',
    parsed.note?`\n${parsed.note}`:'',
    '',
    'Silakan login kembali menggunakan data tersebut ya bosku.'
  ].filter((x,i,a)=>x!=='' || (i>0 && a[i-1]!=='' )).join('\n').trim();
}
async function escalateFreebetAgreement({chatId,eventId,text,livechat,wf}){
  const ctx=await getOperationalHistory(chatId);
  const prev=wf?.workflow_data||{};
  const uid=extractUserIdFromText(text) || extractRequestedUserIdFromText(text) || prev.userId || extractUserId(ctx) || extractStandaloneRequestedUserId(ctx);
  if(!uid){
    await db.setConversationWorkflow(chatId,{type:'FREEBET_CLAIM',state:'WAITING_ID_AFTER_AGREEMENT',data:{...prev,agreed:true}});
    const reply='Oke bosku 😊 Syarat FreeBet sudah disetujui. Boleh kirim ID akunnya ya bosku 🙏';
    await sendAndStore(livechat,chatId,reply,'BONUS_REQUEST');
    return {intent:'BONUS_REQUEST',workflow:'FREEBET_CLAIM',state:'WAITING_ID_AFTER_AGREEMENT',sent:true,reply};
  }
  const question=`🎁 FREEBET 50% - MEMBER SUDAH SETUJU\n\nID : ${uid}\n\nMember sudah membaca dan menyetujui syarat Bonus FreeBet 50%.\nSilakan cek kelayakan claim member.`;
  const result=await makeHumanRequest({chatId,eventId,intent:'BONUS_REQUEST',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question,requireTelegramDelivery:true});
  if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'FREEBET_CLAIM',state:'WAITING_HUMAN',data:{...prev,agreed:true,userId:uid,humanRequestId:result.humanRequestId}});
  return result;
}

async function maybeHandleFreebetWorkflow({chatId,eventId,text,livechat}){
  const wf=await db.getConversationWorkflow(chatId);
  if(wf?.workflow_type!=='FREEBET_CLAIM') return null;
  if(wf.workflow_state==='WAITING_AGREEMENT'){
    if(!isFreebetAgreement(text)) return null;
    return escalateFreebetAgreement({chatId,eventId,text,livechat,wf});
  }
  if(wf.workflow_state==='WAITING_ID_AFTER_AGREEMENT'){
    return escalateFreebetAgreement({chatId,eventId,text,livechat,wf});
  }
  return null;
}

async function startFreebetTerms({chatId,text,livechat,userId=''}){
  await db.setConversationWorkflow(chatId,{type:'FREEBET_CLAIM',state:'WAITING_AGREEMENT',data:{bonusType:'BONUS FREEBET 50%',userId:userId||'',bonusStage:'WAITING_AGREEMENT'}});
  await sendAndStore(livechat,chatId,FREEBET_TERMS,'BONUS_REQUEST');
  return {intent:'BONUS_REQUEST',workflow:'FREEBET_CLAIM',state:'WAITING_AGREEMENT',sent:true,reply:FREEBET_TERMS};
}

async function maybeHandleWorkflow({chatId,eventId,text,intent,livechat}){
  const wf=await db.getConversationWorkflow(chatId);

  // Staff said WD is pending: do not send another message immediately.
  // Wait for the member's next message, then answer with the known pending state.
  if(wf?.workflow_type==='WD_STATUS' && ['PENDING','PENDING_FOLLOWUP'].includes(String(wf?.workflow_state||''))){
    const reply=await responseText('#WD_ANTRIAN','Withdraw bosku masih dalam proses ya 😊🙏 Mohon ditunggu beberapa saat, nanti tetap kami proses sampai selesai ya bosku.');
    await sendAndStore(livechat,chatId,reply,'WITHDRAW_PROBLEM');
    await db.setConversationWorkflow(chatId,{type:'WD_STATUS',state:'PENDING_FOLLOWUP',data:{...(wf?.workflow_data||{}),lastMemberEventId:eventId||null,lastMemberText:String(text||'').slice(0,300)}});
    return {intent:'WITHDRAW_PROBLEM',workflow:'WD_STATUS',state:'PENDING_FOLLOWUP',sent:true,reply,workflowPreserved:true};
  }

  if(wf?.workflow_type!=='WD_REPLACEMENT' || wf?.workflow_state!=='WAITING_MEMBER_ACCOUNT') return null;

  const ctx=await getOperationalHistory(chatId);
  const prev=wf?.workflow_data||{};
  const acc=extractAccountData(ctx);
  const data={
    type: acc.type || prev.type || '',
    name: acc.name || prev.name || '',
    no: acc.no || prev.no || ''
  };
  const missing=[];
  if(!data.name) missing.push('nama rekening');
  if(!data.no) missing.push('nomor rekening');
  if(!data.type) missing.push('jenis rekening');

  if(missing.length){
    await db.setConversationWorkflow(chatId,{type:'WD_REPLACEMENT',state:'WAITING_MEMBER_ACCOUNT',data:{...prev,...data}});
    const reply=`Boleh dilengkapi ${missing.join(', ')} ya bosku 🙏`;
    await sendAndStore(livechat,chatId,reply,'WITHDRAW_PROBLEM');
    return {intent:'WITHDRAW_PROBLEM',workflow:'WD_REPLACEMENT',state:'WAITING_MEMBER_ACCOUNT',sent:true,reply};
  }

  const req=await db.createHumanRequest({
    chatId,sourceEventId:eventId,intent:'WITHDRAW_PROBLEM',memberMessage:text,
    question:`NAMA REK : ${data.name}\\nNO REK : ${data.no}\\nJENIS REK : ${data.type}\\n\\nalihkan wd ke rekening ini`
  });
  await db.clearConversationWorkflow(chatId);
  await dispatchHumanRequest(req);
  await sendAndStore(livechat,chatId,WAITING_CHECK_REPLY,'WITHDRAW_PROBLEM');
  await db.logAI({chatId,sourceEventId:eventId,intent:'WITHDRAW_PROBLEM',action:'WORKFLOW_TO_HUMAN',confidence:1,reply:WAITING_CHECK_REPLY,reason:`WD replacement workflow -> Human Request #${req.id}`});
  return {intent:'WITHDRAW_PROBLEM',workflow:'WD_REPLACEMENT',humanRequestId:req.id,sent:true};
}

async function getReplyStyle(){
  return {
    replyStyle:String(await db.getSetting('reply_style','NATURAL_CS')||'NATURAL_CS'),
    replyLength:String(await db.getSetting('reply_length','SHORT')||'SHORT'),
    boskuUsage:String(await db.getSetting('bosku_usage','MODERATE')||'MODERATE'),
    emojiUsage:String(await db.getSetting('emoji_usage','LIGHT')||'LIGHT'),
    formalLanguage:Boolean(await db.getSetting('formal_language',false)),
    replyStyleNote:String(await db.getSetting('reply_style_note','')||'')
  };
}

function explicitGreetingReply(text='', now=new Date()){
  const n=normalizeText(text);
  const stated=(n.match(/\b(pagi|siang|sore|malam)\b/)||[])[1]||daypart(now,config.timezone);
  return `Selamat ${stated} juga, bosku 😊🙏 Ada yang bisa kami bantu ${stated} ini bosku?`;
}
function sanitizeOutboundMemberText(text='',intent='GENERAL'){
  let out=String(text||'').trim();
  // Internal canned/shortcut identifiers are control data, never member-facing text.
  // A bare token such as "#mak" or "#WD_QUEUE" must never leak into LiveChat.
  if(/^#[a-z0-9_\-]{2,60}$/i.test(out)){
    if(String(intent||'').toUpperCase()==='GREETING') return greetingText(new Date(),config.timezone);
    return 'Mohon maaf bosku 🙏 Bisa dijelaskan sedikit kendalanya supaya kami bantu dengan tepat?';
  }
  return out;
}
async function sendAndStore(livechat,chatId,text,intent,senderType='ai'){
  if(senderType==='ai' && await db.isHumanTakeover(chatId)) throw new Error('HUMAN_TAKEOVER_ACTIVE');
  text=sanitizeOutboundMemberText(text,intent);
  if(!text) throw new Error('EMPTY_OUTBOUND_REPLY');

  // Anti-repeat: identical AI text cannot be spammed every poll/retry while state is unchanged.
  // Human replies are never suppressed here.
  if(senderType==='ai' && String(intent||'').toUpperCase()!=='GREETING' && await db.shouldSuppressOutbound(chatId,text,120)){
    await db.appendCaseAudit({chatId,eventType:'OUTBOUND_SUPPRESSED_DUPLICATE',intent,payload:{textPreview:String(text).slice(0,180)}}).catch(()=>{});
    return {suppressed:true,reason:'duplicate_reply_guard'};
  }

  const started=Date.now();
  try{
    let sent=null;
    const maxAttempts=senderType==='human_bridge'?3:1;
    let lastSendError=null;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      try{
        sent=await livechat.sendMessage(chatId,text);
        lastSendError=null;
        break;
      }catch(err){
        lastSendError=err;
        if(attempt<maxAttempts) await new Promise(r=>setTimeout(r,Math.min(400*attempt,1200)));
      }
    }
    if(lastSendError) throw lastSendError;
    const sentEventId=sent?.event_id || sent?.id || null;
    await db.saveOutbound(chatId,text,sentEventId);
    if(sentEventId) await db.insertMessage({chatId,eventId:String(sentEventId),senderType,authorId:'',text,normalizedText:normalizeText(text),intent,createdAt:new Date().toISOString()});
    await db.setIntegrationHealth('livechat',{status:'OK',latencyMs:Date.now()-started,meta:{lastAction:'sendMessage'}}).catch(()=>{});
    await db.appendCaseAudit({chatId,eventType:'MEMBER_REPLY_SENT',intent,payload:{senderType,textPreview:String(text).slice(0,240)}}).catch(()=>{});
    return sent;
  }catch(err){
    await db.setIntegrationHealth('livechat',{status:'ERROR',latencyMs:Date.now()-started,error:String(err?.message||err),meta:{lastAction:'sendMessage'}}).catch(()=>{});
    await db.addDeadLetter({source:'LIVECHAT_SEND',eventKey:null,chatId,payload:{intent,textPreview:String(text).slice(0,500)},error:String(err?.message||err),attempts:1}).catch(()=>{});
    throw err;
  }
}

async function buildSources(chatId,intent,normalized){
  // Chat IDs can be reused by LiveChat. Only reason over messages that belong to the
  // current session (after the latest system promo/welcome banner).
  const sessionRows=await db.getCurrentSessionContext(chatId,10000);
  const total=sessionRows.length;
  const recentLimit=60;
  const recentRows=sessionRows.slice(-recentLimit);
  const query=`${normalized} ${recentRows.filter(m=>m.sender_type==='customer').slice(-8).map(m=>m.text).join(' ')}`;
  const rulesRows=await db.getRules(intent);
  const websiteProfile=await db.getSetting('website_profile',{});
  const kbRows=await db.getRelevantKnowledge(query,intent,14);
  const promoRows=await db.getRelevantPromoRules(query,8);
  const importantRows=await db.getRelevantImportantInfo(query,24);
  const humanCannedRows=await db.getRelevantCanned(query,14,intent); // compatibility/health only; never injected into AI prompt
  void humanCannedRows;
  const botResponseRows=await getRelevantBotResponses(query,intent,14);
  const learningRows=await db.getRelevantLearning(query,intent,10);
  const historyRows=await db.getAutoHistoryLearning(query,intent,12);
  const styleRows=await db.getHumanStyleExamples(30);
  // Never reuse a digest from an older LiveChat session. Current-session messages are
  // already bounded by getCurrentSessionContext(), so build a compact local digest only
  // when this session is long.
  let digest='';
  let digested=0;
  const target=Math.max(0,total-recentLimit);
  if(target>0){
    let cursor=0, loops=0;
    while(cursor<target && loops<30){
      const chunkRows=sessionRows.slice(cursor,Math.min(cursor+160,target));
      if(!chunkRows.length) break;
      const history=chunkRows.map(m=>`${m.sender_type==='customer'?'MEMBER':m.sender_type==='ai'?'AI':m.sender_type==='system'?'SYSTEM':'CS'}: ${String(m.text||'').trim()}`).join('\n');
      try{
        const d=await ai.digestConversation({history,previousDigest:digest});
        digest=d.digest; cursor+=chunkRows.length; digested=cursor;
      }catch(e){ await db.logError('engine','SESSION_CONTEXT_DIGEST_FAILED',e.message,{chatId,total,digested,target}); break; }
      loops++;
    }
  }
  const context=recentRows.map(m=>`${m.sender_type==='customer'?'MEMBER':m.sender_type==='ai'?'AI':m.sender_type==='system'?'SYSTEM':'CS'}: ${m.text}`).join('\n');
  const profileLinks=Array.isArray(websiteProfile?.alternativeLinks)?websiteProfile.alternativeLinks.filter(x=>x&&x.active!==false&&String(x.url||'').trim()):[];
  const websiteKnowledge=[
    websiteProfile?.siteName?`[WEBSITE PROFILE] Nama website: ${websiteProfile.siteName}`:'',
    websiteProfile?.mainUrl?`[WEBSITE PROFILE] Link utama aktif: ${websiteProfile.mainUrl}`:'',
    websiteProfile?.registerUrl?`[WEBSITE PROFILE] Link daftar: ${websiteProfile.registerUrl}`:'',
    websiteProfile?.rtpUrl?`[WEBSITE PROFILE] Link RTP: ${websiteProfile.rtpUrl}`:'',
    profileLinks.length?`[WEBSITE PROFILE] Link alternatif AKTIF: ${profileLinks.map(x=>`${x.label||'Link'}=${x.url}`).join(' | ')}`:'',
    websiteProfile?.notes?`[WEBSITE PROFILE] Catatan resmi: ${websiteProfile.notes}`:''
  ].filter(Boolean).join('\n');
  const rules=formatRows(rulesRows,['category','rule_type','content']);
  const manualKnowledge=kbRows.map(r=>`[KNOWLEDGE ${r.category||'GENERAL'}] ${r.title||''}: ${r.content||''}`).join('\n');
  const importantKnowledge=formatImportantForAI(importantRows);
  const promoKnowledge=promoRows.map(r=>`[PROMO AKTIF] ${r.name} | keyword:${(r.keywords||[]).join(', ')} | min deposit:${r.min_deposit||'-'} | max bonus:${r.max_bonus||'-'} | turnover:${r.turnover||'-'} | batas klaim:${r.claim_limit||'-'} | jam:${r.active_hours||'-'} | game:${r.game_scope||'-'} | rules:${r.rules||'-'} | template:${r.reply_template||'-'}`).join('\n');
  const responses=botResponseRows.map(r=>`[RESPONSE MANUAL ${r.name||r.id}] [${r.intent||'GENERAL'}] ${r.response_text}`).join('\n');
  const learning=learningRows.map(r=>`[BELAJAR ${r.source_type}] [${r.intent}] [similarity:${r.semantic_score??'-'}] Member: ${r.member_text} => Jawaban benar: ${r.correction_text||r.response_text}${r.context_snapshot?` | Konteks: ${String(r.context_snapshot).slice(0,500)}`:''}`).join('\n');
  const csStyleExamples=styleRows.map(r=>`- ${String(r.response_text||'').trim()}`).filter(Boolean).join('\n').slice(0,9000);
  const historyLearning=historyRows.map(r=>`[${r.intent}] [similarity:${r.semantic_score??'-'}] Member: ${r.sample_member||'-'} => Pola CS: ${r.sample_response} (dipakai ${r.occurrences}x)`).join('\n').slice(0,10000);
  const attachments=recentRows.filter(m=>m.sender_type==='customer').slice(-10).flatMap(m=>Array.isArray(m.attachments)?m.attachments:[]).filter(a=>a?.isImage).slice(-3);
  const brainRow=await db.getConversationBrain(chatId);
  const caseBrain=normalizeBrain(brainRow?.case_brain||{},intent);
  return {context,rules,knowledge:[websiteKnowledge,promoKnowledge,importantKnowledge,responses,manualKnowledge,learning].filter(Boolean).join('\n'),hasKnowledge:Boolean(websiteKnowledge||importantKnowledge||promoKnowledge||manualKnowledge||responses||learning),knowledgeCount:kbRows.length,responseCount:botResponseRows.length,attachments,conversationDigest:digest,csStyleExamples,historyLearning,totalMessages:total,caseBrain,digestCovered:digested,digestTarget:target,importantRows,websiteProfile};
}

export async function processCustomerMessage({chatId,eventId,threadId=null,text,createdAt,livechat,attachments=[],skipInsert=false,resumeReason=''}) {
  // Absolute safety guard: a LiveChat/System welcome banner is never a member message,
  // regardless of provider author metadata. Route it directly to the deterministic
  // time-aware greeting path and never let OpenAI/generic fallback answer it.
  if(isGreetingTriggerMessage(text)){
    await db.insertMessage({
      chatId,eventId,senderType:'system',authorId:'system',text,
      normalizedText:normalizeText(text),intent:'GREETING_TRIGGER',
      createdAt,attachments:attachments||[]
    }).catch(()=>{});
    return processGreetingTrigger({chatId,eventId,threadId,text,createdAt,livechat});
  }

  const beforeState=await db.getConversationState(chatId);
  // A system promo can be stored before the first customer message. message_count alone
  // therefore cannot decide whether this is a fresh conversation. Ignore system rows
  // and detect whether any meaningful customer/agent/AI conversation existed before it.
  const priorRows=!skipInsert ? await db.getContext(chatId,120) : [];
  const wasNewConversation=!skipInsert && canAutoGreetFromHistory(priorRows,null);
  const threadKey=String(threadId||'').trim();
  const normalized=normalizeText(text); let intent=detectIntent(text);
  if(!skipInsert){
    const inserted=await db.insertMessage({chatId,eventId,senderType:'customer',text,normalizedText:normalized,intent,createdAt,authorId:'',attachments});
    if (!inserted) return {skipped:'duplicate'};
  }else{
    await db.logAI({chatId,sourceEventId:eventId||null,intent,action:'RESUME_AFTER_HUMAN',confidence:1,reply:'',reason:resumeReason||'resume_existing_customer_message'}).catch(()=>{});
  }

  return db.withChatLock(chatId, async()=>{
    // Re-check after obtaining the per-chat lock so a human Take Over always wins
    // against an AI reply that was being prepared concurrently.
    if (await db.isHumanTakeover(chatId)) return {skipped:'human_takeover'};
    const systemEnabled=Boolean(await db.getSetting('system_enabled',true));
    if (!systemEnabled) return {skipped:'system_off',intent,normalized};
    const auto=Boolean(await db.getSetting('auto_reply',config.autoReplyDefault));
    if (!auto) return {skipped:'auto_reply_off',intent,normalized};

    // Greeting must happen before any operational return (Deposit/WD/Reset/Bonus).
    // Otherwise a member whose first message is already a problem never gets welcomed.
    // For reused chat_id, a known previous greeting_thread_id lets us safely identify
    // a genuinely new LiveChat thread. A fresh install with old history does not greet
    // mid-conversation merely because greeting_thread_id is still null.
    const greetingEnabled=Boolean(await db.getSetting('greeting_enabled',config.greetingEnabled));
    let greeted=false;
    if(greetingEnabled && !skipInsert){
      const eventAge=(()=>{const t=Date.parse(createdAt||'');return Number.isFinite(t)?Math.max(0,(Date.now()-t)/1000):Infinity;})();
      const knownThread=String(beforeState?.greeting_thread_id||'').trim();
      const authoritativeBannerSession=Boolean(String(beforeState?.session_key||'').trim() && beforeState?.greeting_sent_at);
      const newKnownThread=Boolean(threadKey && knownThread && threadKey!==knownThread);
      const eligibleFresh=eventAge<=Math.max(config.greetingTriggerMaxAgeSeconds,config.bootstrapReplyMaxAgeSeconds);
      let claimed=false;

      // The LiveChat promo/system banner is the authoritative new-session marker.
      // Once processGreetingTrigger has greeted that session, the first member message
      // MUST be processed for its real intent (bonus/DP/WD/reset/etc.), never greeted again.
      // Some LC payloads expose no thread_id on the banner but do expose one on the next
      // customer event; bind that real thread id silently instead of sending greeting #2.
      const activeWorkflowForGreeting=await db.getConversationWorkflow(chatId).catch(()=>null);
      const openHumanForGreeting=await db.getOpenHumanRequest(chatId).catch(()=>null);
      const activeOperationalCase=Boolean(activeWorkflowForGreeting?.workflow_type || openHumanForGreeting);

      if(authoritativeBannerSession){
        if(threadKey && newKnownThread) await db.bindGreetingThreadWithoutGreeting(chatId,threadKey).catch(()=>{});
      }else if(activeOperationalCase){
        // Never greet/restart in the middle of an active WD/DP/reset/bonus case merely
        // because LC suddenly exposes a different thread id on a customer event.
        if(threadKey && newKnownThread) await db.bindGreetingThreadWithoutGreeting(chatId,threadKey).catch(()=>{});
        await db.logAI({chatId,sourceEventId:eventId||null,intent:'GREETING',action:'GREETING_SUPPRESSED',confidence:1,reply:'',reason:'active_operational_case_customer_event'}).catch(()=>{});
      }else if(eligibleFresh && threadKey && (wasNewConversation || newKnownThread)){
        // A stable LiveChat thread identifier is the primary session boundary. Archive
        // the prior session and clear transient workflow state before this first event
        // is allowed to influence AI context.
        await db.beginNewConversationSession(chatId,{triggerEventId:eventId,threadKey:`thread:${threadKey}`,boundarySource:'LIVECHAT_THREAD_ID'});
        claimed=await db.claimGreetingForThread(chatId,threadKey);
      }else if(eligibleFresh && wasNewConversation){
        claimed=await db.claimGreeting(chatId,{onlyIfNew:false});
      }
      if(claimed){
        try{ await sendAndStore(livechat,chatId,greetingText(new Date(),config.timezone),'GREETING'); greeted=true; }
        catch(e){ if(e.message==='HUMAN_TAKEOVER_ACTIVE') return {skipped:'human_takeover'}; await db.logError('engine','GREETING_SEND_FAILED',e.message,{chatId,threadId:threadKey||null}); }
      }
    }

    const workflowBeforeResolve=await db.getConversationWorkflow(chatId);
    const freshDetected=String(detectIntent(text)||'GENERAL').toUpperCase();
    intent=await resolveContextualIntent(chatId,intent,text,attachments);

    // Hard topic switch: explicit fresh operational intent releases stale workflow state.
    const previousWorkflowIntent=workflowIntentFromType(workflowBeforeResolve?.workflow_type)||'GENERAL';
    if(shouldHardSwitch({previousIntent:previousWorkflowIntent,freshIntent:freshDetected,text})){
      await db.appendCaseAudit({chatId,eventType:'TOPIC_SWITCH',intent:freshDetected,payload:{from:previousWorkflowIntent,to:freshDetected,text:String(text||'').slice(0,240)}}).catch(()=>{});
      await db.clearConversationWorkflow(chatId).catch(()=>{});
      intent=freshDetected;
    }

    // Bind a short answer to the generic clarification question.
    if(String(workflowBeforeResolve?.workflow_type||'').toUpperCase()==='GENERIC_CLARIFY'){
      const n=normalizeText(text);
      const bound=
        /\b(?:deposit|depo)\b/.test(n)?'DEPOSIT_PROBLEM':
        /\b(?:withdraw|penarikan)\b/.test(n)?'WITHDRAW_PROBLEM':
        /\b(?:login|password|sandi|masuk akun)\b/.test(n)?'LOGIN_PROBLEM':
        /\bbonus\b/.test(n)?'BONUS_REQUEST':
        /\b(?:game|permainan|slot)\b/.test(n)?'GAME_PROBLEM':'';
      if(bound){
        await db.clearConversationWorkflow(chatId).catch(()=>{});
        intent=bound;
        await db.appendCaseAudit({chatId,eventType:'LAST_QUESTION_BOUND',intent:bound,payload:{answer:String(text||'').slice(0,120)}}).catch(()=>{});
      }
    }

    // Ambiguous one-liners are clarified once instead of being guessed.
    const ambiguity=detectGenericAmbiguity(text);
    if(ambiguity && ['GENERAL','TRANSACTION_AMBIGUOUS'].includes(String(intent||'GENERAL').toUpperCase())){
      return askAndTrack(livechat,chatId,'GENERAL','GENERIC_CLARIFY','WAITING_TOPIC',{originalText:String(text||'').slice(0,300)},ambiguity);
    }
    if(String(intent||'GENERAL').toUpperCase()==='GENERAL' && fuzzyConfidence(text)<0.55 && !(attachments||[]).length){
      const reply='Mohon maaf bosku, biar kami tidak salah bantu, boleh dijelaskan sedikit kendalanya terkait deposit, withdraw, login, bonus, atau permainan ya?';
      return askAndTrack(livechat,chatId,'GENERAL','GENERIC_CLARIFY','WAITING_TOPIC',{originalText:String(text||'').slice(0,300),lowConfidence:true},reply);
    }

    // Persist only current-case entities. Session key prevents reuse across reopened chats.
    const txAmount=extractTransactionAmount(text,intent);
    const waitInfo=extractWaitingDuration(text);
    const imgClass=attachmentClass({intent,text,attachments});
    if(txAmount) await db.upsertCaseEntity({chatId,caseKey:`active:${topicFamily(intent)}`,key:'amount',value:String(txAmount),confidence:.9,sourceEventId:eventId}).catch(()=>{});
    if(waitInfo) await db.upsertCaseEntity({chatId,caseKey:`active:${topicFamily(intent)}`,key:'waiting_duration',value:waitInfo.raw,confidence:.85,sourceEventId:eventId}).catch(()=>{});
    if(imgClass) await db.upsertCaseEntity({chatId,caseKey:`active:${topicFamily(intent)}`,key:'attachment_type',value:imgClass,confidence:.8,sourceEventId:eventId}).catch(()=>{});
    await db.appendCaseAudit({chatId,eventType:'MEMBER_MESSAGE_CLASSIFIED',intent,payload:{freshIntent:freshDetected,resolvedIntent:intent,amount:txAmount,waiting:waitInfo?.raw||null,attachmentType:imgClass||null,fuzzyConfidence:fuzzyConfidence(text)}}).catch(()=>{});

    // Re-open marker: if member says the problem is still unresolved after a prior close,
    // keep correlation in the audit timeline instead of treating it as unrelated GENERAL.
    if(isReopenMessage(text)){
      const prior=await db.findRecentClosedHumanRequest(chatId,180).catch(()=>null);
      if(prior) await db.appendCaseAudit({chatId,caseKey:prior.case_key||null,eventType:'CASE_REOPEN_SIGNAL',intent,payload:{reopenedFrom:prior.id,priorIntent:prior.intent}}).catch(()=>{});
    }

    // Closing intent: only explicit resolved language closes pending workflow/ticket.
    if(isClosingMessage(text)){
      const n=normalizeText(text);
      const explicitResolved=/\b(?:selesai|aman|beres|done|sudah masuk|sudah selesai)\b/.test(n);
      if(explicitResolved){
        await db.closeOpenHumanRequests(chatId,'MEMBER_CONFIRMED_RESOLVED').catch(()=>{});
        await db.clearConversationWorkflow(chatId).catch(()=>{});
        await db.appendCaseAudit({chatId,eventType:'CASE_CLOSED_BY_MEMBER',intent,payload:{text:String(text||'').slice(0,200)}}).catch(()=>{});
      }
    }

    // Advanced case intelligence: persist secondary intents and structured facts.
    // Member text is always untrusted data; prompt-like instructions never become internal commands.
    const multiIntents=detectMultiIntents(text);
    const secondary=multiIntents.filter(x=>x!==String(intent||'').toUpperCase());
    if(secondary.length) await db.enqueueSecondaryIntents(chatId,eventId,secondary);
    const extractedFacts=extractConversationFacts(text);
    if(extractedFacts.length) await db.upsertConversationFacts(chatId,extractedFacts);
    if(detectPromptInjection(text)) await db.logError('security','PROMPT_INJECTION_ATTEMPT','Untrusted member instruction detected',{chatId,eventId});
    if(detectCorrection(text)) await db.logError('engine','MEMBER_CORRECTION_DETECTED','Member corrected prior understanding',{chatId,eventId});

    // Explicit member greetings are deterministic and never sent to the LLM/canned matcher.
    // This makes shorthand such as "slmt mlm bos" behave like "selamat malam bos".
    if(intent==='GREETING' && !greeted){
      const reply=explicitGreetingReply(text,new Date());
      await sendAndStore(livechat,chatId,reply,'GREETING');
      await db.logAI({chatId,sourceEventId:eventId,intent:'GREETING',action:'AUTO_REPLY',confidence:1,reply,reason:'explicit_member_greeting'}).catch(()=>{});
      return {intent:'GREETING',sent:true,reply,deterministic:true};
    }

    // FreeBet agreement is a stateful acknowledgement and must be handled before
    // the generic `oke -> Oke bosku` shortcut. Otherwise the claim never reaches Telegram.
    const freebetWorkflowResult=await maybeHandleFreebetWorkflow({chatId,eventId,text,livechat});
    if(freebetWorkflowResult) return freebetWorkflowResult;

    // Pure conversational acknowledgements are terminal for this turn. They must
    // never fall through into an old WD/DP/bonus workflow and repeat a status message.
    // Examples: "Ok" -> "Oke bosku 😊"; "makasih" -> gratitude reply.
    // The workflow/ticket itself stays untouched so real follow-up messages can continue it.
    if(isGratitudeText(text)){
      const reply=gratitudeReply();
      await sendAndStore(livechat,chatId,reply,'GRATITUDE');
      await db.logAI({chatId,sourceEventId:eventId,intent:'GRATITUDE',action:'AUTO_REPLY',confidence:1,reply,reason:'pure_gratitude_does_not_retrigger_operational_workflow'}).catch(()=>{});
      return {intent:'GRATITUDE',sent:true,reply,workflowPreserved:true};
    }
    if(isAcknowledgementText(text)){
      const activeWorkflow=await db.getConversationWorkflow(chatId);
      const waitingWd=Boolean(activeWorkflow && ['WD_CHECK','WD_STATUS'].includes(String(activeWorkflow.workflow_type||'')) && ['WAITING_HUMAN','PENDING','PENDING_FOLLOWUP'].includes(String(activeWorkflow.workflow_state||'')));
      const reply=waitingWd ? WD_ACK_WAIT_REPLY : acknowledgementReply();
      await sendAndStore(livechat,chatId,reply,'ACKNOWLEDGEMENT');
      await db.logAI({chatId,sourceEventId:eventId,intent:'ACKNOWLEDGEMENT',action:'AUTO_REPLY',confidence:1,reply,reason:waitingWd?'wd_waiting_acknowledgement':'short_ack_does_not_retrigger_operational_workflow'}).catch(()=>{});
      return {intent:'ACKNOWLEDGEMENT',sent:true,reply,workflowPreserved:true};
    }
    {
      const activeWorkflow=await db.getConversationWorkflow(chatId);
      const waitingWd=Boolean(activeWorkflow && ['WD_CHECK','WD_STATUS'].includes(String(activeWorkflow.workflow_type||'')) && ['WAITING_HUMAN','PENDING','PENDING_FOLLOWUP'].includes(String(activeWorkflow.workflow_state||'')));
      const n=normalizeText(text);
      const wdContinuation=waitingWd
        && /\b(?:wd|withdraw|penarikan)\b/.test(n)
        && /\b(?:proses|process|lanjut|lagi|tolong|mau|saya|segera)\b/.test(n)
        && !/\b(?:belum|blm|gagal|error|kendala|masalah|limit|rekening|ganti|ubah|batal|cancel|tidak\s+masuk|ga\s+masuk|gak\s+masuk)\b/.test(n);
      if(wdContinuation){
        const reply=await responseText('#WD_ANTRIAN','Withdraw bosku masih dalam proses ya 😊🙏 Mohon ditunggu beberapa saat, nanti tetap kami proses sampai selesai ya bosku.');
        await sendAndStore(livechat,chatId,reply,'WITHDRAW_PROBLEM');
        await db.setConversationWorkflow(chatId,{type:'WD_STATUS',state:'PENDING_FOLLOWUP',data:{...(activeWorkflow?.workflow_data||{}),lastMemberEventId:eventId||null,lastMemberText:String(text||'').slice(0,300)}});
        await db.logAI({chatId,sourceEventId:eventId,intent:'WITHDRAW_PROBLEM',action:'AUTO_REPLY',confidence:1,reply,reason:'active_wd_case_continuation_no_restart'}).catch(()=>{});
        return {intent:'WITHDRAW_PROBLEM',sent:true,reply,workflowPreserved:true,continuation:true};
      }
      if(waitingWd && isWaitingAcknowledgementText(text)){
        const reply=WD_ACK_WAIT_REPLY;
        await sendAndStore(livechat,chatId,reply,'ACKNOWLEDGEMENT');
        await db.logAI({chatId,sourceEventId:eventId,intent:'ACKNOWLEDGEMENT',action:'AUTO_REPLY',confidence:1,reply,reason:'wd_waiting_natural_acknowledgement'}).catch(()=>{});
        return {intent:'ACKNOWLEDGEMENT',sent:true,reply,workflowPreserved:true};
      }
    }

    const workflowResult=await maybeHandleWorkflow({chatId,eventId,text,intent,livechat});
    if(workflowResult) return workflowResult;

    const operationalResult=await maybeHandleOperationalFlow({chatId,eventId,text,intent,livechat});
    if(operationalResult) return operationalResult;

    const openHuman=await db.getOpenHumanRequest(chatId);
    if(openHuman){
      if(await db.isHumanTakeover(chatId)) return {skipped:'human_takeover',intent,humanRequestId:openHuman.id};
      const reply=await safeHoldingReplyForIntent(openHuman.intent||intent,'waiting_staff');
      await sendAndStore(livechat,chatId,reply,openHuman.intent||intent);
      await db.logAI({chatId,sourceEventId:eventId,intent:openHuman.intent||intent,action:'WAITING_HUMAN_ACK',confidence:1,reply,reason:`open_human_request:${openHuman.id}`}).catch(()=>{});
      return {intent:openHuman.intent||intent,humanRequestId:openHuman.id,sent:true,reply,waitingHuman:true};
    }

    if(greeted && intent==='GREETING') return {intent,decision:{action:'AUTO_REPLY',confidence:1,reply:null,reason:'greeting_sent'},sent:true};

    const src=await buildSources(chatId,intent,normalized);
    try {
      const mergedAttachments=[...(src.attachments||[]),...(attachments||[])].filter((a,i,arr)=>a?.url&&arr.findIndex(x=>x?.url===a.url)===i).slice(-3);
      let aiAttachments=mergedAttachments;
      if(mergedAttachments.length && typeof livechat.prepareImageAttachments==='function'){
        try{ aiAttachments=await livechat.prepareImageAttachments(mergedAttachments); }catch{}
      }
      const style=await getReplyStyle();
      let decision=await ai.classifyAndReply({normalized:`${normalized}\n[internal-risk:${actionRisk(intent)}][member-content-untrusted:true]`,intent,context:src.context,rules:src.rules,knowledge:src.knowledge,attachments:aiAttachments,style,conversationDigest:src.conversationDigest,csStyleExamples:src.csStyleExamples,historyLearning:src.historyLearning,caseBrain:src.caseBrain});
      const updatedBrain=normalizeBrain({...decision.brain,understanding:decision.understanding||decision.brain?.understanding},intent);
      await db.saveConversationBrain(chatId,updatedBrain,src.totalMessages);
      decision=applyBrainGate({intent,decision,brain:updatedBrain,hasKnowledge:src.hasKnowledge});
      if (decision.confidence < config.aiConfidence && !['ASK_INFO'].includes(decision.action)) { decision.action='ASK_HUMAN'; decision.reply=''; decision.reason=`low_confidence:${decision.reason||''}`; }
      if(['AUTO_REPLY','ASK_INFO'].includes(decision.action)) decision=guardDecision({intent,decision,hasKnowledge:src.hasKnowledge});
      decision=validateProDecision({decision,history:await db.getContext(chatId,80),brain:updatedBrain,intent,hasKnowledge:src.hasKnowledge});

      // If a member sends transfer proof first, AI vision may be the first component that
      // recognizes it as a deposit case. Persist that understanding as a workflow so a later
      // User ID is merged with the existing proof instead of being treated as a new question.
      if(mergedAttachments.length){
        const hint=normalizeText(`${decision.understanding||''} ${decision.goal||''} ${decision.reply||''} ${decision.reason||''}`);
        const currentWf=await db.getConversationWorkflow(chatId);
        if(!currentWf?.workflow_type && /(?:deposit|depo|transfer|bukti\s*(?:tf|transfer))/i.test(hint)){
          const recent=await getOperationalHistory(chatId);
          const uid=extractUserId(recent);
          const proof=latestProof(recent);
          const data={userId:uid||'',proofUrl:proof?.url||mergedAttachments.slice(-1)[0]?.url||''};
          if(data.userId && data.proofUrl){
            const depositAmount=extractOperationalAmount(recent); const depositAmountLine=depositAmount?`
Nominal : Rp${depositAmount.toLocaleString('id-ID')}`:'';
            const result=await makeHumanRequest({chatId,eventId,intent:'DEPOSIT_PROBLEM',text,livechat,telegram:true,holding:WAITING_CHECK_REPLY,question:`💰 DEPOSIT PROBLEM

User ID : ${data.userId}${depositAmountLine}

Bukti transfer ikut terlampir.
Silakan cek deposit member.`,requireTelegramDelivery:true});
            if(result?.telegram) await db.setConversationWorkflow(chatId,{type:'DEPOSIT_VERIFY',state:'WAITING_HUMAN',data:{...data,humanRequestId:result.humanRequestId}});
            return result;
          }
          await db.setConversationWorkflow(chatId,{type:'DEPOSIT_VERIFY',state:'COLLECTING',data});
        }
      }

      // Human can press Take Over while OpenAI is thinking. Check once more before any action/send.
      if (await db.isHumanTakeover(chatId)) return {skipped:'human_takeover_after_ai'};

      if(['ASK_HUMAN','HANDOFF'].includes(decision.action)){
        const humanAsk=Boolean(await db.getSetting('human_ask_enabled',config.humanAskEnabled));
        if(humanAsk){
          const brain=normalizeBrain(decision.brain||src.caseBrain,intent);
          const question=decision.humanQuestion || `Mohon bantu tentukan jawaban untuk member ini. Intent: ${intent}. Masalah: ${decision.understanding||brain.understanding||'-'}. Tahap: ${brain.stage}. Data yang masih kurang: ${brain.missingInfo.join(', ')||'-'}. Pesan terbaru: ${text}`;
          const req=await db.createHumanRequest({chatId,sourceEventId:eventId,intent,memberMessage:text,question});
          if(isTelegramBridgeCategory(intent)) await dispatchHumanRequest(req).catch(()=>({ok:false}));
          if(await db.isHumanTakeover(chatId)) return {skipped:'human_takeover_after_handoff',intent,humanRequestId:req.id};
          const reply=await safeHoldingReplyForIntent(intent,'staff');
          await sendAndStore(livechat,chatId,reply,intent);
          await db.logAI({chatId,sourceEventId:eventId,intent,...decision,reply,reason:`understanding:${decision.understanding||'-'} | ${decision.reason||''} | human_request:${req.id} | safe_wait_staff`});
          return {intent,decision,humanRequestId:req.id,sent:true,reply,waitingHuman:true};
        }
        const reply=await safeHoldingReplyForIntent(intent,'staff_disabled');
        await sendAndStore(livechat,chatId,reply,intent);
        await db.logAI({chatId,sourceEventId:eventId,intent,...decision,reply,reason:`human_ask_disabled_safe_fallback | ${decision.reason||''}`});
        return {intent,decision,sent:true,reply};
      }

      if (!decision.reply) {
        if(await db.isHumanTakeover(chatId)) return {skipped:'human_takeover_before_empty_fallback'};
        const reply=await safeHoldingReplyForIntent(intent,'empty_reply');
        await sendAndStore(livechat,chatId,reply,intent);
        await db.logAI({chatId,sourceEventId:eventId,intent,...decision,reply,reason:`empty_ai_reply_safe_fallback | ${decision.reason||''}`});
        return {intent,decision,sent:true,reply,fallback:true};
      }
      if (await db.isHumanTakeover(chatId)) return {skipped:'human_takeover_before_send'};
      await sendAndStore(livechat,chatId,decision.reply,intent);
      await db.logAI({chatId,sourceEventId:eventId,intent,...decision});
      return {intent,decision,sent:true};
    } catch (e) {
      if(e.message==='HUMAN_TAKEOVER_ACTIVE') return {skipped:'human_takeover'};
      await db.logAI({chatId,sourceEventId:eventId,intent,error:e.message});
      await db.logError('engine','AI_PROCESS_FAILED',e.message,{chatId,eventId,intent});
      if(Boolean(await db.getSetting('human_ask_enabled',config.humanAskEnabled)) && !(await db.isHumanTakeover(chatId))){
        const req=await db.createHumanRequest({chatId,sourceEventId:eventId,intent,memberMessage:text,question:`AI gagal menentukan jawaban (${e.message}). Mohon berikan instruksi balasan untuk member.`});
        if(isTelegramBridgeCategory(intent)) await dispatchHumanRequest(req).catch(()=>({ok:false}));
        const reply=await safeHoldingReplyForIntent(intent,'error');
        await sendAndStore(livechat,chatId,reply,intent);
        return {intent,error:e.message,humanRequestId:req.id,waitingHuman:true,sent:true,reply,fallback:true};
      }
      if(!(await db.isHumanTakeover(chatId))){
        const reply=await safeHoldingReplyForIntent(intent,'error');
        await sendAndStore(livechat,chatId,reply,intent);
        return {intent,error:e.message,sent:true,reply,fallback:true};
      }
      return {intent,error:e.message,skipped:'human_takeover'};
    }
  });
}


export async function resumeConversationAfterHumanTakeover({chatId,livechat}){
  await db.appendCaseAudit({chatId,eventType:'HUMAN_TAKEOVER_RELEASED',intent:null,payload:{action:'RESYNC_LAST_CONTEXT'}}).catch(()=>{});
  const pending=await db.withChatLock(chatId, async()=>{
    if(await db.isHumanTakeover(chatId)) return {skipped:'human_takeover_still_active'};
    const rows=await db.getContext(chatId,240);
    if(!rows.length) return {skipped:'no_history'};
    let customerIndex=-1;
    for(let i=rows.length-1;i>=0;i--){
      if(String(rows[i]?.sender_type||'').toLowerCase()==='customer' && String(rows[i]?.text||'').trim()){ customerIndex=i; break; }
    }
    if(customerIndex<0) return {skipped:'no_customer_message'};
    const later=rows.slice(customerIndex+1);
    if(later.some(m=>['ai','agent'].includes(String(m?.sender_type||'').toLowerCase()) && String(m?.text||'').trim())){
      return {skipped:'latest_customer_already_answered'};
    }
    const last=rows[customerIndex];
    return {resume:{eventId:last.event_id,text:last.text,createdAt:last.created_at,attachments:last.attachments||[]}};
  });
  if(!pending?.resume){
    await db.appendCaseAudit({chatId,eventType:'AI_RESYNC_SKIPPED',intent:null,payload:{reason:pending?.skipped||'no_resume'}}).catch(()=>{});
    return pending;
  }
  const r=pending.resume;
  await db.appendCaseAudit({chatId,eventType:'AI_RESYNC_RESUMED',intent:null,payload:{eventId:r.eventId}}).catch(()=>{});
  return processCustomerMessage({chatId,eventId:r.eventId,text:r.text,createdAt:r.createdAt,attachments:r.attachments,livechat,skipInsert:true,resumeReason:'operator_returned_conversation_to_ai'});
}



export async function processGreetingTrigger({chatId,eventId,threadId=null,text,createdAt,livechat}){
  return db.withChatLock(chatId, async()=>{
    const rawThreadKey=String(threadId||'').trim();
    const exactWelcomeBanner=isAuthoritativeWelcomeBanner(text);

    // Fresh authoritative LiveChat System banner = NEW service session.
    // Old HUMAN takeover state belongs to the previous session and must not suppress
    // the new time-aware greeting. Non-authoritative triggers still respect takeover.
    if(!exactWelcomeBanner && await db.isHumanTakeover(chatId)) return {skipped:'human_takeover'};

    const systemEnabled=Boolean(await db.getSetting('system_enabled',true));
    if(!systemEnabled) return {skipped:'system_off'};
    const auto=Boolean(await db.getSetting('auto_reply',config.autoReplyDefault));
    if(!auto) return {skipped:'auto_reply_off'};
    const greetingEnabled=Boolean(await db.getSetting('greeting_enabled',config.greetingEnabled));
    // Explicit OMTOGEL System welcome banner is authoritative. While System + Auto Reply
    // are ON it must greet even if an old persisted greeting_enabled flag was turned off.
    if(!greetingEnabled && !exactWelcomeBanner) return {skipped:'greeting_off'};
    // A new OMTOGEL System banner is the real session marker. LiveChat may reuse the
    // same thread id across multiple visits, so using threadId alone can suppress a
    // legitimate new greeting. Key authoritative banners by event id instead.
    const bannerEventKey=String(eventId||createdAt||'').trim();
    const threadKey=rawThreadKey ? `thread:${rawThreadKey}` : `welcome:${bannerEventKey}`;
    const boundarySource=rawThreadKey?'LIVECHAT_THREAD_ID':(exactWelcomeBanner?'AUTHORITATIVE_SYSTEM_WELCOME':'VALIDATED_FALLBACK');
    const rows=await db.getContext(chatId,240).catch(()=>[]);
    const triggerAt=Date.parse(createdAt||'');
    const ageSeconds=Number.isFinite(triggerAt)?Math.max(0,(Date.now()-triggerAt)/1000):Infinity;
    const freshAuthoritativeBanner=Boolean(
      exactWelcomeBanner &&
      Number.isFinite(ageSeconds) &&
      ageSeconds<=Math.max(600,Number(config.greetingTriggerMaxAgeSeconds||0))
    );

    // A greeting is only useful before the bot/human has answered the new session.
    // If any outbound AI/agent message already exists after this banner, this trigger
    // arrived late (restart/race/legacy sync). Suppress it instead of appending a
    // greeting after DP/WD/bonus replies.
    if(Number.isFinite(triggerAt)){
      const outboundAfterTrigger=rows.some(m=>{
        if(String(m?.event_id||'')===String(eventId||'')) return false;
        const type=String(m?.sender_type||'').toLowerCase();
        if(!['ai','agent'].includes(type)) return false;
        const at=Date.parse(m?.created_at||'');
        return Number.isFinite(at) && at>triggerAt && Boolean(String(m?.text||'').trim());
      });
      if(outboundAfterTrigger){
        await db.logAI({chatId,sourceEventId:eventId||null,intent:'GREETING',action:'GREETING_SUPPRESSED',confidence:1,reply:'',reason:'late_banner_outbound_already_exists'}).catch(()=>{});
        return {skipped:'late_banner_outbound_exists'};
      }
    }

    // Never greet from old history/backfill. The 10-minute window tolerates provider
    // polling delays while still preventing hours-old System banners from greeting.
    if(exactWelcomeBanner && Number.isFinite(ageSeconds) && ageSeconds>Math.max(600,Number(config.greetingTriggerMaxAgeSeconds||0))){
      await db.logAI({chatId,sourceEventId:eventId||null,intent:'GREETING',action:'GREETING_SUPPRESSED',confidence:1,reply:'',reason:'stale_authoritative_system_banner'}).catch(()=>{});
      return {skipped:'stale_system_banner'};
    }

    if(Number.isFinite(triggerAt) && !freshAuthoritativeBanner){
      const hasConversationAfterTrigger=rows.some(m=>{
        if(String(m?.event_id||'')===String(eventId||'')) return false;
        const type=String(m?.sender_type||'').toLowerCase();
        if(!['customer','agent','ai'].includes(type)) return false;
        const at=Date.parse(m?.created_at||'');
        return Number.isFinite(at) && at>=triggerAt && Boolean(String(m?.text||'').trim());
      });
      if(hasConversationAfterTrigger){
        await db.logAI({
          chatId,sourceEventId:eventId||null,intent:'GREETING',
          action:'GREETING_SUPPRESSED',confidence:1,reply:'',
          reason:'conversation_already_started_after_trigger'
        }).catch(()=>{});
        return {skipped:'conversation_already_started'};
      }
    }

    const activeWorkflow=await db.getConversationWorkflow(chatId).catch(()=>null);
    const openHuman=await db.getOpenHumanRequest(chatId).catch(()=>null);

    if(!freshAuthoritativeBanner && !rawThreadKey && (activeWorkflow?.workflow_type || openHuman)){
      const latestReal=[...rows].reverse().find(m=>
        ['customer','agent','ai'].includes(String(m?.sender_type||'').toLowerCase()) &&
        String(m?.text||'').trim()
      );
      const latestAt=Date.parse(latestReal?.created_at||'');
      const recent=Number.isFinite(latestAt) && (Date.now()-latestAt)<=45*60*1000;
      if(recent){
        await db.logAI({
          chatId,sourceEventId:eventId||null,intent:'GREETING',
          action:'GREETING_SUPPRESSED',confidence:1,reply:'',
          reason:'active_case_duplicate_banner_without_thread'
        }).catch(()=>{});
        return {skipped:'active_case_banner_ignored'};
      }
    }

    if(!(await db.claimGreetingForThread(chatId,threadKey))){
      return {skipped:'greeting_already_sent_for_session'};
    }

    await db.beginNewConversationSession(chatId,{triggerEventId:eventId,threadKey,boundarySource});

    try{
      const reply=greetingText(new Date(),config.timezone);
      await sendAndStore(livechat,chatId,reply,'GREETING');
      await db.logAI({
        chatId,sourceEventId:eventId||null,intent:'GREETING',
        action:'AUTO_GREETING_TRIGGER',confidence:1,reply,
        reason:freshAuthoritativeBanner
          ? 'fresh_authoritative_omtogel_system_banner'
          : rawThreadKey
            ? 'LiveChat promo/welcome explicit thread'
            : 'LiveChat promo/welcome validated new session'
      }).catch(()=>{});
      return {sent:true,reply,authoritative:Boolean(freshAuthoritativeBanner)};
    }catch(e){
      await db.logError('engine','AUTO_GREETING_TRIGGER_FAILED',e.message,{
        chatId,eventId,threadId:rawThreadKey||null,authoritative:Boolean(freshAuthoritativeBanner)
      }).catch(()=>{});
      return {error:e.message};
    }
  });
}

function isAuthoritativeWelcomeBanner(text=''){
  const n=String(text||'').replace(/\s+/g,' ').trim().toLowerCase();
  return n.includes('lebih mudah menghubungi kami via telegram & whatsapp')
    && n.includes('layanancsomtogel.live')
    && n.includes('dapatkan prediksi bola akurat')
    && n.includes('livebolautama.ink');
}
function criticalHumanFacts(text=''){
  const s=String(text||''); const facts=new Set();
  const patterns=[/https?:\/\/\S+/gi,/\b\d{6,}\b/g,/\b(?:userid|user id|username|password|psw|link login|rekening|nominal)\s*[:=]\s*([^\n]{2,160})/gi];
  for(const re of patterns){let m;while((m=re.exec(s))){facts.add(String(m[1]||m[0]).trim().replace(/[.,;]+$/,''));}}
  return [...facts].filter(Boolean).slice(0,20);
}
function exactHumanFallback(answer,intent){
  const a=String(answer||'').trim();
  if(String(intent||'').toUpperCase()==='FORGOT_PASSWORD' && /(?:password|psw)\s*[:=]/i.test(a)) return `Siap bosku 😊🙏\n${a}\n\nSilakan dicoba terlebih dahulu ya bosku.`.slice(0,1200);
  return `Baik bosku 😊🙏\n${a}`.slice(0,1200);
}

export async function answerHumanRequest({request,humanAnswer,saveAsKnowledge=false,livechat,deliveryMode='send'}){
  return db.withChatLock(request.chat_id, async()=>{
    if(!(await db.isHumanRequestInCurrentSession(request))){
      const err=new Error('STALE_SESSION_REQUEST: ticket berasal dari sesi LiveChat lama dan tidak boleh dikirim ke sesi baru.'); err.code='STALE_SESSION_REQUEST'; throw err;
    }
    const systemEnabled=Boolean(await db.getSetting('system_enabled',true));
    if(!systemEnabled) throw new Error('LIVECHAT_AI_SYSTEM_OFF');
    // Explicit staff reply from Telegram is a HUMAN action, not an AI auto-reply.
    // It must still be deliverable while the LC room is in Human Takeover.
    if(await db.isHumanTakeover(request.chat_id)){
      await db.appendCaseAudit({chatId:request.chat_id,caseKey:request.case_key||null,eventType:'HUMAN_BRIDGE_REPLY_DURING_TAKEOVER',intent:request.intent,payload:{requestId:request.id}}).catch(()=>{});
    }
    const intent=String(request.intent||'GENERAL').toUpperCase();

    if(deliveryMode==='learn_only_if_takeover' && await db.isHumanTakeover(request.chat_id)){
      const learned=await db.saveHumanGuidanceLearning({request,humanAnswer});
      if(saveAsKnowledge){
        await db.brainPool.query(`INSERT INTO knowledge_base(category,title,content) VALUES($1,$2,$3)`,[intent,`Tanya Staff Human Takeover #${request.id}`,String(humanAnswer||'').trim()]);
      }
      const answered=await db.answerHumanRequest(request.id,{answer:humanAnswer,finalReply:'',saveAsKnowledge});
      await db.clearConversationWorkflow(request.chat_id);
      await db.appendCaseAudit({chatId:request.chat_id,caseKey:request.case_key||null,eventType:'HUMAN_GUIDANCE_LEARN_ONLY',intent,payload:{requestId:request.id,learningId:learned?.id||null,saveAsKnowledge:Boolean(saveAsKnowledge)}}).catch(()=>{});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent,action:'HUMAN_GUIDANCE_LEARN_ONLY',confidence:1,reply:'',reason:`Tanya Staff #${request.id}: room HUMAN, answer learned without member delivery`});
      return {...answered,learned:true,delivered:false,humanTakeover:true};
    }

    const wfNow=await db.getConversationWorkflow(request.chat_id).catch(()=>({}));
    const contradiction=contradictionStatus(wfNow?.workflow_state||'',humanAnswer);
    if(contradiction){
      await db.appendCaseAudit({chatId:request.chat_id,caseKey:request.case_key||null,eventType:'HUMAN_STATUS_OVERRIDE',intent,payload:{override:contradiction,previousState:wfNow?.workflow_state||null,humanAnswer:redactSensitive(humanAnswer).slice(0,300)}}).catch(()=>{});
    }
    await db.appendCaseAudit({chatId:request.chat_id,caseKey:request.case_key||null,eventType:'HUMAN_REPLY_RECEIVED',intent,payload:{answer:redactSensitive(humanAnswer).slice(0,400),requestId:request.id}}).catch(()=>{});

    if(intent==='REGISTER_REQUEST'){
      const credentials=parseResetCredentialReply(humanAnswer);
      if(!credentials){
        const e=new Error('REGISTER_REPLY_INCOMPLETE: reply ticket dengan USER ID, PASSWORD, dan LINK LOGIN lengkap.'); e.code='REGISTER_REPLY_INCOMPLETE'; throw e;
      }
      const finalText=resetCredentialMemberReply(credentials);
      await sendAndStore(livechat,request.chat_id,finalText,intent,'human_bridge');
      await db.clearConversationWorkflow(request.chat_id);
      const answered=await db.answerHumanRequest(request.id,{answer:humanAnswer,finalReply:finalText,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent,action:'HUMAN_REGISTER_CREDENTIALS',confidence:1,reply:finalText,reason:`Human Request #${request.id}: exact Telegram reply-to-ticket registration credentials`});
      return answered;
    }
    if(intent==='FORGOT_PASSWORD'){
      const credentials=parseResetCredentialReply(humanAnswer);
      if(!credentials){
        const e=new Error('RESET_REPLY_INCOMPLETE: reply ticket dengan USER ID, PASSWORD, dan LINK LOGIN lengkap.'); e.code='RESET_REPLY_INCOMPLETE'; throw e;
      }
      const finalText=resetCredentialMemberReply(credentials);
      await sendAndStore(livechat,request.chat_id,finalText,intent,'human_bridge');
      await db.clearConversationWorkflow(request.chat_id);
      const answered=await db.answerHumanRequest(request.id,{answer:humanAnswer,finalReply:finalText,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent,action:'HUMAN_RESET_CREDENTIALS',confidence:1,reply:finalText,reason:`Human Request #${request.id}: exact Telegram reply-to-ticket credentials`});
      return answered;
    }
    if(intent==='WITHDRAW_PROBLEM' && /\b(?:wd\s*)?pending\b|\bmasih\s+(?:dalam\s+)?proses\b/i.test(String(humanAnswer||''))){
      await db.setConversationWorkflow(request.chat_id,{type:'WD_STATUS',state:'PENDING',data:{humanAnswer:String(humanAnswer||'').trim()}});
      const answered=await db.answerHumanRequest(request.id,{answer:humanAnswer,finalReply:'',saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent,action:'HUMAN_STATUS_PENDING',confidence:1,reply:'',reason:`Human Request #${request.id}: pending, silent until member replies`});
      return {...answered,silent:true,silentReason:'WD_PENDING'};
    }
    if(intent==='WITHDRAW_PROBLEM' && /\bdana\b.*\blimi(?:t|d)\b|\blimi(?:t|d)\b.*\bdana\b/i.test(String(humanAnswer||''))){
      const reply=await responseText('#DANA_LIMIT',WD_DANA_LIMIT_REPLY);
      await sendAndStore(livechat,request.chat_id,reply,intent,'human_bridge');
      await db.setConversationWorkflow(request.chat_id,{type:'WD_REPLACEMENT',state:'WAITING_MEMBER_ACCOUNT',data:{sourceAction:'WD_DANA_LIMIT',humanRequestId:request.id}});
      const answered=await db.answerHumanRequest(request.id,{answer:humanAnswer,finalReply:reply,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent,action:'HUMAN_STATUS_DANA_LIMIT',confidence:1,reply,reason:`Human Request #${request.id}: DANA limit, collect replacement account`});
      return {...answered,action:'WD_DANA_LIMIT'};
    }
    const src=await buildSources(request.chat_id,intent,normalizeText(request.member_message));
    const style=await getReplyStyle();
    let composed={text:'',usage:null}; let composeError=null;
    try{
      composed=await ai.composeFromHuman({memberMessage:request.member_message,intent,humanAnswer,context:src.context,rules:src.rules,knowledge:src.knowledge,style});
    }catch(e){ composeError=e; await db.logError('engine','HUMAN_COMPOSE_FAILED',e.message,{requestId:request.id,chatId:request.chat_id}); }
    const facts=criticalHumanFacts(humanAnswer); let finalText=String(composed.text||'').trim();
    if(!finalText || facts.some(f=>!finalText.includes(f))) finalText=exactHumanFallback(humanAnswer,intent);
    await sendAndStore(livechat,request.chat_id,finalText,intent,'human_bridge');
    const answered=await db.answerHumanRequest(request.id,{answer:humanAnswer,finalReply:finalText,saveAsKnowledge});
    await db.clearConversationWorkflow(request.chat_id);
    if(saveAsKnowledge){
      await db.brainPool.query(`INSERT INTO knowledge_base(category,title,content) VALUES($1,$2,$3)`,[intent,`Belajar dari Human Request #${request.id}`,humanAnswer]);
    }
    await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent,action:'HUMAN_ASSISTED',confidence:1,reply:finalText,reason:`Human Request #${request.id}${composeError?' | fallback_exact':''}`,usage:composed.usage});
    return answered;
  });
}

export async function applyHumanAction({request,action,livechat}){
  const code=String(action||'').toUpperCase();
  return db.withChatLock(request.chat_id, async()=>{
    await db.appendCaseAudit({chatId:request.chat_id,caseKey:request.case_key||null,eventType:'HUMAN_ACTION_CLICKED',intent:request.intent,payload:{action:code,requestId:request.id}}).catch(()=>{});
    if(!(await db.isHumanRequestInCurrentSession(request))){
      const err=new Error('STALE_SESSION_REQUEST: tombol berasal dari sesi LiveChat lama dan tidak boleh dikirim ke sesi baru.'); err.code='STALE_SESSION_REQUEST'; throw err;
    }
    if(await db.isHumanTakeover(request.chat_id)){
      await db.appendCaseAudit({chatId:request.chat_id,caseKey:request.case_key||null,eventType:'HUMAN_BRIDGE_ACTION_DURING_TAKEOVER',intent:request.intent,payload:{requestId:request.id,action:code}}).catch(()=>{});
    }
    // Reset-specific staff actions have stateful behavior, so handle them before the generic response map.
    if(code==='RESET_NOT_REGISTERED'){
      const reply=await responseText('#RESET_TIDAK_TERDAFTAR','Mohon maaf ya, bosku. Setelah kami cek, data yang diberikan belum terdaftar di situs kami 🙏😊\n\nJika bosku berminat, kami bisa bantu proses pendaftaran akun baru. Atau bosku juga bisa daftar langsung melalui link berikut:\n\n🔗 LINK PENDAFTARAN:\nhttps://omtogelpos.com/register\n\nSilakan dicoba ya, bosku. Kami siap membantu jika ada kendala saat pendaftaran ☺️🙏');
      await sendAndStore(livechat,request.chat_id,reply,request.intent||'FORGOT_PASSWORD','human_bridge');
      await db.clearConversationWorkflow(request.chat_id);
      const answered=await db.answerHumanRequest(request.id,{answer:'ACTION:RESET_NOT_REGISTERED',finalReply:reply,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent:request.intent,action:'HUMAN_ACTION_RESET_NOT_REGISTERED',confidence:1,reply,reason:`Human Request #${request.id}`});
      return answered;
    }
    if(code==='RESET_DEPOSIT_FIRST'){
      const ctx=await db.getContext(request.chat_id,40);
      const prior=(await db.getConversationWorkflow(request.chat_id))?.workflow_data||{};
      const data=inferResetAccountData(ctx,prior);
      const previousProofUrl=latestProof(ctx)?.url||prior.previousProofUrl||'';
      const deposit=await db.findDepositResponseForBank(data.type||'');
      const intro=await responseText('#RESET_DEPOSIT_DULU','Untuk verifikasi kepemilikan akun, silakan melakukan deposit melalui rekening tujuan di bawah ini ya bosku 🙏 Setelah deposit selesai, kirim bukti transfernya kembali kepada kami agar proses reset password dapat dilanjutkan.');
      const reply=[intro,deposit?.content||''].filter(Boolean).join('\n\n').slice(0,1800);
      await sendAndStore(livechat,request.chat_id,reply,request.intent||'FORGOT_PASSWORD','human_bridge');
      await db.setConversationWorkflow(request.chat_id,{type:'RESET_PASSWORD',state:'WAITING_DEPOSIT',data:{...data,proofUrl:'',previousProofUrl}});
      const answered=await db.answerHumanRequest(request.id,{answer:'ACTION:RESET_DEPOSIT_FIRST',finalReply:reply,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent:request.intent,action:'HUMAN_ACTION_RESET_DEPOSIT_FIRST',confidence:1,reply,reason:`Human Request #${request.id} | deposit_response:${deposit?.shortcut||deposit?.title||'fallback'}`});
      return answered;
    }
    if(code==='RESET_DEPOSIT_NOT_IN'){
      const reply=await responseText('#RESET_DP_BELUM_MASUK','Deposit verifikasinya belum terlihat masuk ya bosku 🙏 Mohon cek kembali transfernya. Jika sudah, kirim kembali bukti verifikasi yang terbaru kepada kami.');
      await sendAndStore(livechat,request.chat_id,reply,request.intent||'FORGOT_PASSWORD','human_bridge');
      const ctx=await db.getContext(request.chat_id,40); const data=inferResetAccountData(ctx,{}); const previousProofUrl=latestProof(ctx)?.url||'';
      await db.setConversationWorkflow(request.chat_id,{type:'RESET_PASSWORD',state:'WAITING_DEPOSIT',data:{...data,proofUrl:'',previousProofUrl}});
      const answered=await db.answerHumanRequest(request.id,{answer:'ACTION:RESET_DEPOSIT_NOT_IN',finalReply:reply,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent:request.intent,action:'HUMAN_ACTION_RESET_DEPOSIT_NOT_IN',confidence:1,reply,reason:`Human Request #${request.id}`});
      return answered;
    }


    if(code==='DP_DETAIL_PROOF'){
      const reply=await responseText('#DP_DETAIL_PROOF','Silakan dibantu dengan Detail Bukti transfernya ya bosku 😊 Pastikan terlihat jelas waktu transaksi, tanggal transaksi, nominal, dan RRN / nomor referensi. Setelah itu kirim kembali kepada kami ya bosku.');
      await sendAndStore(livechat,request.chat_id,reply,request.intent||'DEPOSIT_PROBLEM','human_bridge');
      const ctx=await db.getContext(request.chat_id,80); const userId=extractUserId(ctx); const previousProofUrl=latestProof(ctx)?.url||'';
      await db.setConversationWorkflow(request.chat_id,{type:'DEPOSIT_VERIFY',state:'WAITING_DETAIL_PROOF',data:{userId,proofUrl:'',previousProofUrl,sourceHumanRequestId:request.id}});
      const answered=await db.answerHumanRequest(request.id,{answer:'ACTION:DP_DETAIL_PROOF',finalReply:reply,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent:request.intent,action:'HUMAN_ACTION_DP_DETAIL_PROOF',confidence:1,reply,reason:`Human Request #${request.id}`});
      return answered;
    }
    if(code==='DP_UNCLEAR_PROOF'){
      const reply=await responseText('#DP_UNCLEAR_PROOF','Bukti yang dikirim belum terlihat jelas ya bosku 🙏 Mohon difoto ulang atau screenshot kembali dengan jelas supaya detail transaksinya dapat kami bantu cek.');
      await sendAndStore(livechat,request.chat_id,reply,request.intent||'DEPOSIT_PROBLEM','human_bridge');
      const ctx=await db.getContext(request.chat_id,80); const userId=extractUserId(ctx); const previousProofUrl=latestProof(ctx)?.url||'';
      await db.setConversationWorkflow(request.chat_id,{type:'DEPOSIT_VERIFY',state:'WAITING_CLEAR_PROOF',data:{userId,proofUrl:'',previousProofUrl,sourceHumanRequestId:request.id}});
      const answered=await db.answerHumanRequest(request.id,{answer:'ACTION:DP_UNCLEAR_PROOF',finalReply:reply,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent:request.intent,action:'HUMAN_ACTION_DP_UNCLEAR_PROOF',confidence:1,reply,reason:`Human Request #${request.id}`});
      return answered;
    }

    if(code==='DP_CANCEL_DONE' || code==='DP_CANCEL_REJECTED'){
      const reply=code==='DP_CANCEL_DONE'
        ? DEPOSIT_CANCEL_DONE_REPLY
        : 'Mohon maaf bosku 🙏 Permintaan depositnya tidak dapat dibatalkan karena sudah masuk proses. Silakan cek kembali status transaksi pada akun bosku ya.';
      await sendAndStore(livechat,request.chat_id,reply,request.intent||'DEPOSIT_CANCEL','human_bridge');
      await db.clearConversationWorkflow(request.chat_id);
      const answered=await db.answerHumanRequest(request.id,{answer:`ACTION:${code}`,finalReply:reply,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent:request.intent,action:`HUMAN_ACTION_${code}`,confidence:1,reply,reason:`Human Request #${request.id}`});
      return answered;
    }
    if(['BONUS_NEW_MEMBER_DONE','BONUS_NEW_MEMBER_PLAYED','BONUS_RONDA_DONE','BONUS_RONDA_PLAYED','BONUS_RONDA_SAME_IP'].includes(code)){
      const reply={
        BONUS_NEW_MEMBER_DONE:SPECIAL_BONUS_DONE_REPLY,
        BONUS_NEW_MEMBER_PLAYED:NEW_MEMBER_PLAYED_REPLY,
        BONUS_RONDA_DONE:SPECIAL_BONUS_DONE_REPLY,
        BONUS_RONDA_PLAYED:RONDA_PLAYED_REPLY,
        BONUS_RONDA_SAME_IP:RONDA_SAME_IP_REPLY
      }[code];
      await sendAndStore(livechat,request.chat_id,reply,request.intent||'BONUS_REQUEST','human_bridge');
      await db.clearConversationWorkflow(request.chat_id);
      const answered=await db.answerHumanRequest(request.id,{answer:`ACTION:${code}`,finalReply:reply,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent:request.intent,action:`HUMAN_ACTION_${code}`,confidence:1,reply,reason:`Human Request #${request.id}`});
      return answered;
    }

    if(code==='BONUS_FREEBET_DONE' || code==='BONUS_FREEBET_NOT_ELIGIBLE'){
      const reply=code==='BONUS_FREEBET_DONE'
        ? await responseText('#BONUS_FREEBET_DONE',FREEBET_DONE_REPLY)
        : await responseText('#BONUS_FREEBET_TIDAK_BISA',FREEBET_NOT_ELIGIBLE_REPLY);
      await sendAndStore(livechat,request.chat_id,reply,request.intent||'BONUS_REQUEST','human_bridge');
      await db.clearConversationWorkflow(request.chat_id);
      const answered=await db.answerHumanRequest(request.id,{answer:`ACTION:${code}`,finalReply:reply,saveAsKnowledge:false});
      await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent:request.intent,action:`HUMAN_ACTION_${code}`,confidence:1,reply,reason:`Human Request #${request.id}`});
      return answered;
    }

    const map={
      WD_QUEUE:['#WD_ANTRIAN',WD_PROCESSING_REPLY],
      WD_REQUEST_VALID_ACCOUNT:['#MINTA_REK_VALID','Boleh kirim rekening yang valid ya bosku 🙏 Sertakan jenis rekening, nama pemilik, dan nomor rekening/nomor akun.'],
      WD_DANA_LIMIT:['#DANA_LIMIT',WD_DANA_LIMIT_REPLY],
      BONUS_DONE:['#BONUS_DONE','Bonusnya sudah selesai diproses ya bosku 😊 Silakan cek kembali akun bosku.'],
      BONUS_DEPOSIT_FIRST:['#BONUS_DEPOSIT_DULU','Silakan melakukan deposit terlebih dahulu ya bosku 🙏 Setelah itu kabari kami lagi supaya bisa dibantu cek bonusnya.'],
      DP_PROCESSED:['#DP_PROCESSED',"Deposit bosku sudah berhasil kami proses ya 😊🙏 Silakan dicek kembali pada saldo akun bosku. Terima kasih dan selamat bermain, semoga beruntung bosku ^^ ❤️"],
      DP_DANA_NOT_IN:['#DP_DANA_NOT_IN',DP_DANA_NOT_IN_REPLY],
      DP_DPPGA:['#DP_DPPGA',DP_DPPGA_REPLY],
      DP_BARCODE:['#DP_BARCODE',DP_BARCODE_REPLY],
      CLEAR_CACHE:['#CLEAR_CACHE','SIlahkan dicoba clear history browser anda kemudian dicoba login kembali ya bosku ☺️\n\nCARA CLEAR CACHE DI HP:\n1️⃣ Buka browser kamu (Chrome, dll)\n2️⃣ Klik titik 3 di pojok kanan atas\n3️⃣ Pilih “Riwayat” atau “History”\n4️⃣ Klik “Hapus data penjelajahan”\n5️⃣ Centang semua (cache, cookies, histori)\n6️⃣ Klik “Hapus Data” atau “Clear”\n\nLOGIN MENGGUNAKAN LINK : https://omtogelxml.com/\n\nContoh Gambar : https://layanancsomtogel.live/CLEARCACHE_OMTOGEL.jpg'],
      DP_NOT_FOUND:['#DP_NOT_FOUND','Depositnya belum terlihat masuk ya bosku 🙏 Boleh tunggu sebentar, nanti kami bantu cek lagi.']
    };
    if(!map[code]) throw new Error('UNKNOWN_HUMAN_ACTION');
    const [shortcut,fallback]=map[code]; const reply=await responseText(shortcut,fallback);
    await sendAndStore(livechat,request.chat_id,reply,request.intent||'GENERAL','human_bridge');
    if(['WD_REQUEST_VALID_ACCOUNT','WD_DANA_LIMIT'].includes(code)){
      await db.setConversationWorkflow(request.chat_id,{type:'WD_REPLACEMENT',state:'WAITING_MEMBER_ACCOUNT',data:{sourceAction:code,humanRequestId:request.id}});
    }else if(code==='WD_QUEUE'){
      await db.setConversationWorkflow(request.chat_id,{type:'WD_STATUS',state:'PENDING',data:{humanRequestId:request.id}});
    }else if(code==='DP_DANA_NOT_IN'){
      await db.setConversationWorkflow(request.chat_id,{type:'DEPOSIT_FUNDS_NOT_RECEIVED',state:'WAITING_MEMBER_MUTATION_PROOF',data:{humanRequestId:request.id,lastAction:'DP_DANA_NOT_IN'}});
    }else if(code==='DP_DPPGA'){
      await db.setConversationWorkflow(request.chat_id,{type:'DEPOSIT_QRIS_REVIEW',state:'WAITING_QRIS_CENTER',data:{humanRequestId:request.id,maxEtaHours:168,lastAction:'DP_DPPGA'}});
    }else if(code==='DP_BARCODE'){
      await db.setConversationWorkflow(request.chat_id,{type:'DEPOSIT_BARCODE',state:'BARCODE_NOT_FOUND',data:{humanRequestId:request.id,lastAction:'DP_BARCODE'}});
    }else{
      await db.clearConversationWorkflow(request.chat_id);
    }
    const answered=await db.answerHumanRequest(request.id,{answer:`ACTION:${code}`,finalReply:reply,saveAsKnowledge:false});
    await db.logAI({chatId:request.chat_id,sourceEventId:request.source_event_id,intent:request.intent,action:`HUMAN_ACTION_${code}`,confidence:1,reply,reason:`Human Request #${request.id}`});
    return answered;
  });
}

