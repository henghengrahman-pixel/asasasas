import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, validateConfig, assertBootConfig } from './config.js';
import { migrate, healthDb, healthBrain, pool, brainPool, getSetting, setSetting, getContext, setHumanTakeover, clearHumanTakeover, withChatLock, isHumanTakeover, logError, insertMessage, addAiCorrection, backfillHumanLearning, backfillHumanLearningAll, withLearningAdvisoryLock, getConversationBrain, listLearningExamples, setLearningStatus, promoteLearningToKnowledge, promoteLearningToResponse, captureHumanReplyLearning, markConversationEnded, learningStats, getConversationState, getFullContext, markAiMessageFeedback, aiFeedbackStats, getIntegrationHealth, listCaseAudit, setIntegrationHealth, listConversationArchives, getConversationArchive, listConversationArchiveMessages, processArchiveRetryQueue, backfillLegacyArchiveSessions } from './db.js';
import { LiveChatClient } from './livechat.js';
import { OpenAIClient } from './ai.js';
import { normalizeText, detectIntent } from './normalizer.js';
import { createSession, refreshSession, createPending2fa, verifyPending2fa, generateTotpSecret, verifyTotp, makeOtpAuthUrl, safeEqualText, verifyPassword, generateRecoveryCodes, hashRecoveryCode, sessionCookie, clearSessionCookie, parseCookies, verifySession, requireAdmin } from './auth.js';
import { startPoller, stopPoller, pollerStatus, syncOnce } from './poller.js';
import { processCustomerMessage, resumeConversationAfterHumanTakeover, answerHumanRequest, applyHumanAction } from './engine.js';
import { cannedClient, startCannedSync, stopCannedSync, syncCannedNow, cannedSyncStatus } from './canned-sync.js';
import { cannedStats, listCannedResponses, createManualResponse, updateManualResponse, deleteManualResponse, importManualResponses, listHumanRequests, getHumanRequest, cancelHumanRequest, getTelegramSettingsInternal, saveTelegramSettings, setTelegramEnabled, listBridgeTickets, closeBridgeTicketByRequest, listPromoRules, createPromoRule, updatePromoRule, deletePromoRule, listImportantInfo, createImportantInfo, updateImportantInfo, deleteImportantInfo, getCannedByShortcut, searchCannedResponses, listTelegramCtaConfigs, createTelegramCtaConfig, updateTelegramCtaConfig, deleteTelegramCtaConfig, getLoginThrottle, recordLoginFailure, clearLoginFailures } from './db.js';
import { TelegramClient } from './telegram.js';
import { encryptSecret, decryptSecret, maskSecret } from './secure-store.js';
import { startHumanBridge, stopHumanBridge, bridgeStatus, dispatchHumanRequest, CATEGORIES } from './human-bridge.js';
import { sanitizeCorrection } from './learning.js';
import { hashPassword } from './auth.js';
import { migrateModularFeatures } from './services/modular-migrations.js';
import { createModularApiRouter } from './routes/modular-api.js';
import { requestContext, apiErrorHandler } from './middleware/api-error.js';
import { isTransientPostgresError, withPostgresStartupRetry } from './postgres-resilience.js';
import { createLearningWorker } from './learning-worker.js';


async function syncTelegramFromEnv(){
  const token=String(config.telegramBotToken||'').trim();
  const defaultChatId=String(config.telegramDefaultChatId||'').trim();
  const hasRoute=Object.values(config.telegramRoutes||{}).some(r=>String(r?.chatId||'').trim()||String(r?.topicId||'').trim());
  if(!token && !defaultChatId && !hasRoute && !config.telegramEnabled) return {changed:false};
  const current=await getTelegramSettingsInternal();
  let enc=null, username=current.botUsername||null;
  if(token){
    const tg=new TelegramClient(token);
    const me=await tg.getMe();
    enc=encryptSecret(token); username=me.username||null;
    await tg.deleteWebhook().catch(()=>{});
  }
  const routes={...(current.routes||{})};
  for(const c of CATEGORIES){
    const env=config.telegramRoutes?.[c]||{};
    const prev=routes[c]||{};
    routes[c]={
      chatId:String(env.chatId||prev.chatId||'').trim(),
      topicId:String(env.topicId||prev.topicId||'').trim()
    };
  }
  const saved=await saveTelegramSettings({
    botTokenEnc:token?enc:null,
    botUsername:username,
    defaultChatId:defaultChatId||current.defaultChatId||'',
    routes,
    enabled:config.telegramEnabled ? true : null
  });
  return {changed:true,enabled:Boolean(saved.enabled),configured:Boolean(saved.botToken),botUsername:saved.botUsername||null};
}

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(); const lc=new LiveChatClient(); const ai=new OpenAIClient();
const learningWorker=createLearningWorker({
  enabled:config.learningEnabled,batchSize:config.learningBatchSize,maxRuntimeMs:config.learningMaxRuntimeMs,heartbeatMs:config.learningLogHeartbeatMs,
  initialDelayMs:15000,catchupDelayMs:config.learningCatchupDelayMs,activeDelayMs:config.learningActiveDelayMs,idleDelayMs:config.learningIdleDelayMs,errorDelayMs:config.learningErrorDelayMs,
  runBatch:({batchSize,maxRuntimeMs})=>backfillHumanLearning(batchSize,{maxRuntimeMs}),
  withLock:withLearningAdvisoryLock,isBusy:()=>Boolean(pollerStatus().running)
});
app.disable('x-powered-by');
app.use(requestContext);
// Image upload endpoint uses raw bytes; JSON middleware intentionally does not consume image/*.
app.use('/api/conversations/:id/image',express.raw({type:['image/jpeg','image/png','image/webp','image/gif'],limit:'8mb'}));
app.use(express.json({limit:'1mb',verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf)}}));
app.use(express.urlencoded({extended:false}));
app.use('/assets',express.static(path.join(__dirname,'../public'),{maxAge:'1h'}));
app.use('/static',express.static(path.join(__dirname,'../public/assets'),{maxAge:'1h'}));
app.use((req,res,next)=>{
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method)||!req.path.startsWith('/api/')) return next();
  const origin=String(req.headers.origin||''); if(!origin) return next();
  try{ const u=new URL(origin); const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim(); if(u.host!==host) return res.status(403).json({ok:false,error:'CROSS_ORIGIN_BLOCKED'}); }catch{return res.status(403).json({ok:false,error:'CROSS_ORIGIN_BLOCKED'});}
  next();
});

app.get('/health',(req,res)=>{
  // Liveness only: keep Railway healthcheck independent from PostgreSQL/provider outages.
  res.json({ok:true,service:'livechat-ai'});
});
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
app.get('/login',(req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));

const dashboardPages=new Set(['ai-settings','conversations','archives','website-profile','knowledge','responses','ai-rules','canned-responses','telegram-cta','telegram-settings','case-management','learning','menu-penting','bekal-bot','logs','security']);
for(const page of dashboardPages){
  app.get(`/${page}`,(req,res)=>res.sendFile(path.join(__dirname,`../public/pages/${page}.html`)));
}
// Keep /health exclusively for Railway JSON health checks. The operator UI lives on its own route.
app.get('/system-health',(req,res)=>res.sendFile(path.join(__dirname,'../public/pages/health.html')));

const TWOFA_SECRET_KEY='admin_2fa_secret_enc';
const TWOFA_ENABLED_KEY='admin_2fa_enabled';
const TWOFA_CONFIRMED_AT_KEY='admin_2fa_confirmed_at';
const TWOFA_RECOVERY_KEY='admin_2fa_recovery_hashes';

async function getAdmin2faState(){
  const enc=String(await getSetting(TWOFA_SECRET_KEY,'')||'').trim();
  let secret='';
  if(enc){ try{ secret=decryptSecret(enc); }catch(e){ await logError('auth','2FA_SECRET_DECRYPT_FAILED',e.message); } }
  return {secret,enabled:Boolean(await getSetting(TWOFA_ENABLED_KEY,false))};
}
async function ensureAdmin2faSecret(){
  const current=await getAdmin2faState();
  if(current.secret) return current;
  const secret=generateTotpSecret();
  await setSetting(TWOFA_SECRET_KEY,encryptSecret(secret));
  await setSetting(TWOFA_ENABLED_KEY,false);
  return {secret,enabled:false};
}
async function makeQrDataUrl(text){
  const mod=await import('qrcode');
  const QRCode=mod.default||mod;
  return QRCode.toDataURL(text,{errorCorrectionLevel:'M',margin:2,width:280});
}
function completeAdminLogin(res,username){
  const token=createSession(username);
  res.setHeader('Set-Cookie',sessionCookie(token));
  return res.json({ok:true,next:'done',user:username,idleTimeoutSeconds:3600});
}

app.post('/api/login',async(req,res)=>{
  try{
    const {username,password}=req.body||{};
    const clientKey=crypto.createHash('sha256').update(`${req.ip||''}|${String(username||'').toLowerCase()}`).digest('hex');
    const throttle=await getLoginThrottle(clientKey);
    if(throttle?.blocked_until && new Date(throttle.blocked_until)>new Date()) return res.status(429).json({ok:false,error:'LOGIN_TEMPORARILY_BLOCKED'});
    const passwordOk=config.adminPasswordHash?verifyPassword(String(password||''),config.adminPasswordHash):safeEqualText(String(password||''),String(config.adminPassword||''));
    const ok=safeEqualText(String(username||''),String(config.adminUsername||'')) && passwordOk;
    if(!ok){await recordLoginFailure(clientKey); return res.status(401).json({ok:false,error:'LOGIN_FAILED'});}
    await clearLoginFailures(clientKey);
    const state=await ensureAdmin2faSecret();
    const pendingToken=createPending2fa(username);
    if(state.enabled) return res.json({ok:true,next:'2fa_verify',pendingToken});
    const otpauthUrl=makeOtpAuthUrl({secret:state.secret,username:String(username||config.adminUsername)});
    const qrDataUrl=await makeQrDataUrl(otpauthUrl);
    return res.json({ok:true,next:'2fa_setup',pendingToken,manualKey:state.secret,otpauthUrl,qrDataUrl});
  }catch(e){ await logError('auth','LOGIN_2FA_PREP_FAILED',e.message); return res.status(500).json({ok:false,error:'LOGIN_2FA_PREP_FAILED'}); }
});
app.post('/api/login/2fa/setup/verify',async(req,res)=>{
  try{
    const pending=verifyPending2fa(req.body?.pendingToken||'');
    if(!pending || !safeEqualText(pending.u,config.adminUsername)) return res.status(401).json({ok:false,error:'TWOFA_SESSION_EXPIRED'});
    const throttleKey=crypto.createHash('sha256').update(`2fa-setup|${req.ip||''}|${pending.u}`).digest('hex');
    const throttle=await getLoginThrottle(throttleKey);
    if(throttle?.blocked_until && new Date(throttle.blocked_until)>new Date()) return res.status(429).json({ok:false,error:'TWOFA_TEMPORARILY_BLOCKED'});
    const state=await getAdmin2faState();
    if(!state.secret) return res.status(409).json({ok:false,error:'TWOFA_SETUP_MISSING'});
    if(!verifyTotp(state.secret,req.body?.code||'')){await recordLoginFailure(throttleKey);return res.status(401).json({ok:false,error:'TWOFA_INVALID'});}
    await clearLoginFailures(throttleKey);
    await setSetting(TWOFA_ENABLED_KEY,true);
    await setSetting(TWOFA_CONFIRMED_AT_KEY,new Date().toISOString());
    const recoveryCodes=generateRecoveryCodes(8);
    await setSetting(TWOFA_RECOVERY_KEY,recoveryCodes.map(hashRecoveryCode));
    const token=createSession(pending.u);res.setHeader('Set-Cookie',sessionCookie(token));
    return res.json({ok:true,next:'done',user:pending.u,idleTimeoutSeconds:3600,recoveryCodes});
  }catch(e){ await logError('auth','TWOFA_SETUP_VERIFY_FAILED',e.message); return res.status(500).json({ok:false,error:'TWOFA_SETUP_VERIFY_FAILED'}); }
});
app.post('/api/login/2fa/verify',async(req,res)=>{
  try{
    const pending=verifyPending2fa(req.body?.pendingToken||'');
    if(!pending || !safeEqualText(pending.u,config.adminUsername)) return res.status(401).json({ok:false,error:'TWOFA_SESSION_EXPIRED'});
    const throttleKey=crypto.createHash('sha256').update(`2fa-verify|${req.ip||''}|${pending.u}`).digest('hex');
    const throttle=await getLoginThrottle(throttleKey);
    if(throttle?.blocked_until && new Date(throttle.blocked_until)>new Date()) return res.status(429).json({ok:false,error:'TWOFA_TEMPORARILY_BLOCKED'});
    const state=await getAdmin2faState();
    if(!state.enabled || !state.secret) return res.status(409).json({ok:false,error:'TWOFA_NOT_CONFIGURED'});
    const code=String(req.body?.code||'').trim();
    let verified=verifyTotp(state.secret,code);
    if(!verified && code){
      const hashes=await getSetting(TWOFA_RECOVERY_KEY,[]); const h=hashRecoveryCode(code); const idx=Array.isArray(hashes)?hashes.findIndex(x=>safeEqualText(String(x),h)):-1;
      if(idx>=0){const next=[...hashes];next.splice(idx,1);await setSetting(TWOFA_RECOVERY_KEY,next);verified=true;}
    }
    if(!verified){await recordLoginFailure(throttleKey);return res.status(401).json({ok:false,error:'TWOFA_INVALID'});}
    await clearLoginFailures(throttleKey);
    return completeAdminLogin(res,pending.u);
  }catch(e){ await logError('auth','TWOFA_VERIFY_FAILED',e.message); return res.status(500).json({ok:false,error:'TWOFA_VERIFY_FAILED'}); }
});
app.post('/api/session/touch',requireAdmin,(req,res)=>{
  const token=refreshSession(req.admin);
  res.setHeader('Set-Cookie',sessionCookie(token));
  res.json({ok:true,idleTimeoutSeconds:3600});
});
app.post('/api/logout',requireAdmin,(req,res)=>{res.setHeader('Set-Cookie',clearSessionCookie());res.json({ok:true});});
app.get('/api/me',(req,res)=>{
  const token=parseCookies(req).lcai_session||'';
  const session=verifySession(token);
  if(!session){ if(token) res.setHeader('Set-Cookie',clearSessionCookie()); return res.json({ok:false,user:null,error:'SESSION_EXPIRED'}); }
  res.json({ok:true,user:session.u,idleTimeoutSeconds:3600});
});

app.get('/api/status',requireAdmin,async(req,res)=>{
  let dbOk=false,brainDbOk=false;try{dbOk=await healthDb();}catch{}try{brainDbOk=await healthBrain();}catch{}
  const tg=await getTelegramSettingsInternal();
  res.json({ok:true,db:dbOk,brainDb:brainDbOk,sharedBrain:Boolean(config.brainDatabaseUrl&&config.brainDatabaseUrl!==config.databaseUrl),livechatConfigured:lc.ready(),openaiConfigured:ai.ready(),systemEnabled:Boolean(await getSetting('system_enabled',true)),autoReply:Boolean(await getSetting('auto_reply',false)),greetingEnabled:Boolean(await getSetting('greeting_enabled',config.greetingEnabled)),humanAskEnabled:Boolean(await getSetting('human_ask_enabled',config.humanAskEnabled)),replyStyle:{replyStyle:String(await getSetting('reply_style','NATURAL_CS')||'NATURAL_CS'),replyLength:String(await getSetting('reply_length','SHORT')||'SHORT'),boskuUsage:String(await getSetting('bosku_usage','MODERATE')||'MODERATE'),emojiUsage:String(await getSetting('emoji_usage','LIGHT')||'LIGHT'),formalLanguage:Boolean(await getSetting('formal_language',false)),replyStyleNote:String(await getSetting('reply_style_note','')||'')},poller:pollerStatus(),learningWorker:learningWorker.status(),cannedSync:cannedSyncStatus(),canned:await cannedStats(),humanBridge:{configured:Boolean(tg.botToken),enabled:Boolean(tg.enabled),...bridgeStatus()},integrationHealth:await getIntegrationHealth().catch(()=>[]),model:config.openaiModel,timezone:config.timezone,warnings:validateConfig()});
});
app.post('/api/test/livechat',requireAdmin,async(req,res)=>{try{res.json(await lc.test());}catch(e){await logError('livechat','TEST_FAILED',e.message);res.status(502).json({ok:false,error:e.message});}});
app.post('/api/test/chat-detail',requireAdmin,async(req,res)=>{try{const list=await lc.listChats();const raw=list?._normalizedChats||[];const chats=lc.filterInbox(raw);if(!chats.length)return res.json({ok:true,chatCount:0,detail:null});const summary=chats[0];const chat=await lc.getChat(String(summary.id),summary);res.json({ok:true,chatId:String(summary.id),diagnostics:lc.chatDiagnostics(chat)});}catch(e){await logError('livechat','CHAT_DETAIL_TEST_FAILED',e.message);res.status(502).json({ok:false,error:e.message});}});
app.post('/api/test/openai',requireAdmin,async(req,res)=>{try{res.json(await ai.test());}catch(e){await logError('openai','TEST_FAILED',e.message);res.status(502).json({ok:false,error:e.message});}});
app.post('/api/test/sync',requireAdmin,async(req,res)=>{try{res.json(await syncOnce(lc,{manual:true}));}catch(e){res.status(502).json({ok:false,error:e.message});}});
app.post('/api/test/canned',requireAdmin,async(req,res)=>{try{res.json(await cannedClient.test());}catch(e){await logError('canned','TEST_FAILED',e.message);res.status(502).json({ok:false,error:e.message,hint:e.status===403?'PAT belum memiliki izin membaca canned responses/Responses List. Tambahkan read scope untuk canned responses di Text Developer Console.':null});}});
app.post('/api/canned/sync',requireAdmin,async(req,res)=>{try{res.json(await syncCannedNow({manual:true}));}catch(e){res.status(502).json({ok:false,error:e.message,hint:e.status===403?'Tambahkan read scope canned responses ke PAT, lalu buat PAT baru dan update LIVECHAT_PAT.':null});}});
app.get('/api/canned',requireAdmin,async(req,res)=>{res.json({ok:true,stats:await cannedStats(),items:await listCannedResponses(1000)});});
app.get('/api/canned/shortcut',requireAdmin,async(req,res)=>{
  const shortcut=String(req.query?.shortcut||'').trim();
  const q=String(req.query?.q||'').trim();
  const limit=Math.min(50,Math.max(1,Number.parseInt(req.query?.limit,10)||20));

  // Exact lookup is kept for legacy callers.
  if(shortcut){
    const item=await getCannedByShortcut(shortcut);
    if(!item)return res.status(404).json({ok:false,error:'SHORTCUT_NOT_FOUND'});
    return res.json({ok:true,item,items:[item]});
  }

  // Query the database on demand. Do not load ~1000 rows into Node for every '#' keypress.
  const ranked=await searchCannedResponses(q,limit);
  return res.json({ok:true,items:ranked,count:ranked.length,q});
});

app.post('/api/canned/manual',requireAdmin,async(req,res)=>{try{const {shortcut='',title='',category='GENERAL',content='',tags=[],mode='FLEXIBLE'}=req.body||{};if(!String(content).trim())return res.status(400).json({ok:false,error:'CONTENT_REQUIRED'});const item=await createManualResponse({shortcut:String(shortcut).trim(),title:String(title).trim(),category,content:String(content).trim(),tags:Array.isArray(tags)?tags:String(tags||'').split(',').map(x=>x.trim()).filter(Boolean),mode});res.json({ok:true,item});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.put('/api/canned/manual/:id',requireAdmin,async(req,res)=>{try{const item=await updateManualResponse(req.params.id,req.body||{});if(!item)return res.status(404).json({ok:false,error:'RESPONSE_NOT_FOUND'});res.json({ok:true,item});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.delete('/api/canned/manual/:id',requireAdmin,async(req,res)=>{res.json({ok:await deleteManualResponse(req.params.id)});});
app.post('/api/canned/import',requireAdmin,async(req,res)=>{try{const items=Array.isArray(req.body?.items)?req.body.items:[];if(!items.length)return res.status(400).json({ok:false,error:'ITEMS_REQUIRED'});const created=await importManualResponses(items.slice(0,1000));res.json({ok:true,created:created.length});}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.get('/api/promos',requireAdmin,async(req,res)=>{res.json({ok:true,items:await listPromoRules({activeOnly:false,limit:500})});});
app.post('/api/promos',requireAdmin,async(req,res)=>{try{res.json({ok:true,item:await createPromoRule(req.body||{})});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.put('/api/promos/:id',requireAdmin,async(req,res)=>{try{const item=await updatePromoRule(req.params.id,req.body||{});if(!item)return res.status(404).json({ok:false,error:'PROMO_NOT_FOUND'});res.json({ok:true,item});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.delete('/api/promos/:id',requireAdmin,async(req,res)=>{res.json({ok:await deletePromoRule(req.params.id)});});


app.get('/api/important-info',requireAdmin,async(req,res)=>{try{res.json({ok:true,items:await listImportantInfo({activeOnly:false,type:String(req.query.type||''),limit:1500})});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post('/api/important-info',requireAdmin,async(req,res)=>{try{res.json({ok:true,item:await createImportantInfo(req.body||{})});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.put('/api/important-info/:id',requireAdmin,async(req,res)=>{try{const item=await updateImportantInfo(req.params.id,req.body||{});if(!item)return res.status(404).json({ok:false,error:'IMPORTANT_INFO_NOT_FOUND'});res.json({ok:true,item});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.delete('/api/important-info/:id',requireAdmin,async(req,res)=>{res.json({ok:await deleteImportantInfo(req.params.id)});});

app.get('/api/ops/audit/:chatId',requireAdmin,async(req,res)=>{
  try{res.json({ok:true,items:await listCaseAudit(String(req.params.chatId),Number(req.query.limit||300))});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.get('/api/ops/health',requireAdmin,async(req,res)=>{
  res.json({ok:true,items:await getIntegrationHealth().catch(()=>[])});
});
app.get('/api/ops/dead-letters',requireAdmin,async(req,res)=>{
  const status=String(req.query.status||'OPEN').toUpperCase();
  const r=await pool.query(`SELECT * FROM dead_letter_events WHERE ($1='ALL' OR status=$1) ORDER BY created_at DESC LIMIT 300`,[status]);
  res.json({ok:true,items:r.rows});
});
app.post('/api/ops/dead-letters/:id/retry',requireAdmin,async(req,res)=>{
  try{
    const r=await pool.query(`SELECT * FROM dead_letter_events WHERE id=$1 FOR UPDATE`,[req.params.id]);
    const item=r.rows[0]; if(!item)return res.status(404).json({ok:false,error:'DLQ_NOT_FOUND'});
    if(String(item.source)==='TELEGRAM_DISPATCH' && item.payload?.humanRequestId){
      const request=await getHumanRequest(item.payload.humanRequestId);
      if(!request)return res.status(404).json({ok:false,error:'HUMAN_REQUEST_NOT_FOUND'});
      const result=await dispatchHumanRequest(request);
      if(result?.ok) await pool.query(`UPDATE dead_letter_events SET status='RESOLVED',updated_at=now() WHERE id=$1`,[item.id]);
      else await pool.query(`UPDATE dead_letter_events SET attempts=attempts+1,error=$2,updated_at=now() WHERE id=$1`,[item.id,String(result?.error||result?.skipped||'retry_failed').slice(0,1500)]);
      return res.json({ok:Boolean(result?.ok),result});
    }
    res.status(400).json({ok:false,error:'DLQ_RETRY_UNSUPPORTED_SOURCE'});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.get('/api/human-requests',requireAdmin,async(req,res)=>{const status=String(req.query.status||'OPEN').toUpperCase();res.json({ok:true,items:await listHumanRequests(status,300)});});
app.post('/api/human-requests/:id/answer',requireAdmin,async(req,res)=>{try{const request=await getHumanRequest(req.params.id);if(!request)return res.status(404).json({ok:false,error:'REQUEST_NOT_FOUND'});if(request.status!=='OPEN')return res.status(409).json({ok:false,error:'REQUEST_ALREADY_CLOSED'});const answer=String(req.body?.answer||'').trim();if(!answer)return res.status(400).json({ok:false,error:'ANSWER_REQUIRED'});const item=await answerHumanRequest({request,humanAnswer:answer,saveAsKnowledge:Boolean(req.body?.saveAsKnowledge),livechat:lc,deliveryMode:'learn_only_if_takeover'});await closeBridgeTicketByRequest(request.id,'ANSWERED');res.json({ok:true,item});}catch(e){await logError('human_request','ANSWER_FAILED',e.message,{id:req.params.id});res.status(502).json({ok:false,error:e.message});}});
app.post('/api/human-requests/:id/action',requireAdmin,async(req,res)=>{try{const request=await getHumanRequest(req.params.id);if(!request)return res.status(404).json({ok:false,error:'REQUEST_NOT_FOUND'});if(request.status!=='OPEN')return res.status(409).json({ok:false,error:'REQUEST_ALREADY_CLOSED'});const action=String(req.body?.action||'').trim();if(!action)return res.status(400).json({ok:false,error:'ACTION_REQUIRED'});const item=await applyHumanAction({request,action,livechat:lc});await closeBridgeTicketByRequest(request.id,'ANSWERED');res.json({ok:true,item,action});}catch(e){await logError('human_request','ACTION_FAILED',e.message,{id:req.params.id,action:req.body?.action});res.status(502).json({ok:false,error:e.message});}});
app.post('/api/human-requests/:id/cancel',requireAdmin,async(req,res)=>{const ok=await cancelHumanRequest(req.params.id);if(ok)await closeBridgeTicketByRequest(req.params.id,'CANCELLED');res.json({ok});});


app.get('/api/human-bridge/settings',requireAdmin,async(req,res)=>{
  const x=await getTelegramSettingsInternal(); let token=''; try{token=x.botToken?decryptSecret(x.botToken):'';}catch{}
  res.json({ok:true,configured:Boolean(token),botTokenMasked:maskSecret(token),botUsername:x.botUsername||bridgeStatus().botUsername||null,defaultChatId:x.defaultChatId||'',routes:x.routes||{},enabled:Boolean(x.enabled),categories:CATEGORIES,status:bridgeStatus()});
});
app.put('/api/human-bridge/settings',requireAdmin,async(req,res)=>{
  try{
    const body=req.body||{}; const token=String(body.botToken||'').trim(); const defaultChatId=String(body.defaultChatId||'').trim();
    const routes={}; for(const c of CATEGORIES){const r=body.routes?.[c]||{};routes[c]={chatId:String(r.chatId||'').trim(),topicId:String(r.topicId||'').trim()};}
    let enc=null, username=null;
    if(token){ const tg=new TelegramClient(token); const me=await tg.getMe(); enc=encryptSecret(token); username=me.username||null; }
    const saved=await saveTelegramSettings({botTokenEnc:enc,botUsername:username,defaultChatId,routes,enabled:null});
    res.json({ok:true,configured:Boolean(saved.botToken),botUsername:saved.botUsername,defaultChatId:saved.defaultChatId,routes:saved.routes,enabled:saved.enabled});
  }catch(e){await logError('human_bridge','SETTINGS_SAVE_FAILED',e.message);res.status(400).json({ok:false,error:e.message});}
});
app.post('/api/human-bridge/test',requireAdmin,async(req,res)=>{
  try{const x=await getTelegramSettingsInternal();if(!x.botToken)return res.status(400).json({ok:false,error:'TELEGRAM_BOT_TOKEN_NOT_SET'});const tg=new TelegramClient(decryptSecret(x.botToken));const me=await tg.getMe();res.json({ok:true,bot:{id:me.id,username:me.username,firstName:me.first_name}});}catch(e){res.status(502).json({ok:false,error:e.message});}
});
app.post('/api/human-bridge/test-message',requireAdmin,async(req,res)=>{
  try{const x=await getTelegramSettingsInternal();if(!x.botToken)return res.status(400).json({ok:false,error:'TELEGRAM_BOT_TOKEN_NOT_SET'});const chatId=String(req.body?.chatId||x.defaultChatId||'').trim();if(!chatId)return res.status(400).json({ok:false,error:'TELEGRAM_CHAT_ID_REQUIRED'});const topicId=String(req.body?.topicId||'').trim()||null;const tg=new TelegramClient(decryptSecret(x.botToken));const m=await tg.sendMessage(chatId,'✅ LIVECHAT AI Human Bridge terhubung. Pesan test berhasil.',{topicId});res.json({ok:true,messageId:m.message_id,chatId:String(m.chat.id)});}catch(e){res.status(502).json({ok:false,error:e.message});}
});
app.post('/api/human-bridge/enabled',requireAdmin,async(req,res)=>{
  try{const enabled=Boolean(req.body?.enabled);const x=await getTelegramSettingsInternal();if(enabled&&!x.botToken)return res.status(400).json({ok:false,error:'TELEGRAM_BOT_TOKEN_NOT_SET'});if(enabled){const tg=new TelegramClient(decryptSecret(x.botToken));await tg.getMe();await tg.deleteWebhook();}await setTelegramEnabled(enabled);let dispatched=0;if(enabled){const opens=await listHumanRequests('OPEN',300);for(const r of opens){const d=await dispatchHumanRequest(r);if(d?.ok)dispatched++;}}res.json({ok:true,enabled,dispatched});}catch(e){res.status(502).json({ok:false,error:e.message});}
});
app.get('/api/human-bridge/tickets',requireAdmin,async(req,res)=>{res.json({ok:true,items:await listBridgeTickets(300),status:bridgeStatus()});});
app.post('/api/human-bridge/requests/:id/send',requireAdmin,async(req,res)=>{try{const request=await getHumanRequest(req.params.id);if(!request)return res.status(404).json({ok:false,error:'REQUEST_NOT_FOUND'});res.json(await dispatchHumanRequest(request));}catch(e){res.status(502).json({ok:false,error:e.message});}});
app.post('/api/test/typo',requireAdmin,(req,res)=>{const text=String(req.body?.text||'');res.json({ok:true,input:text,normalized:normalizeText(text),intent:detectIntent(text)});});

app.post('/api/settings/system-enabled',requireAdmin,async(req,res)=>{
  const enabled=Boolean(req.body?.enabled);
  if(enabled&&(!lc.ready()||!ai.ready())) return res.status(400).json({ok:false,error:'LIVECHAT_OR_OPENAI_NOT_READY'});
  await setSetting('system_enabled',enabled);
  // Keep automatic handling enabled whenever the master is ON; per-chat Human Takeover is preserved.
  if(enabled) await setSetting('auto_reply',true);
  res.json({ok:true,enabled,note:enabled?'LiveChat sync + AI aktif.':'Background LiveChat sync dan OpenAI dihentikan; tidak ada polling LiveChat selama OFF.'});
});

app.post('/api/settings/auto-reply',requireAdmin,async(req,res)=>{const enabled=Boolean(req.body?.enabled);if(enabled&&(!lc.ready()||!ai.ready()))return res.status(400).json({ok:false,error:'LIVECHAT_OR_OPENAI_NOT_READY'});await setSetting('auto_reply',enabled);res.json({ok:true,enabled,note:'Per-chat HUMAN TAKEOVER tidak diubah oleh global switch.'});});
app.post('/api/settings/greeting',requireAdmin,async(req,res)=>{const enabled=Boolean(req.body?.enabled);await setSetting('greeting_enabled',enabled);res.json({ok:true,enabled});});
app.post('/api/settings/human-ask',requireAdmin,async(req,res)=>{const enabled=Boolean(req.body?.enabled);await setSetting('human_ask_enabled',enabled);res.json({ok:true,enabled});});

app.get('/api/settings/reply-style',requireAdmin,async(req,res)=>{
  res.json({ok:true,replyStyle:String(await getSetting('reply_style','NATURAL_CS')||'NATURAL_CS'),replyLength:String(await getSetting('reply_length','SHORT')||'SHORT'),boskuUsage:String(await getSetting('bosku_usage','MODERATE')||'MODERATE'),emojiUsage:String(await getSetting('emoji_usage','LIGHT')||'LIGHT'),formalLanguage:Boolean(await getSetting('formal_language',false)),replyStyleNote:String(await getSetting('reply_style_note','')||'')});
});
app.put('/api/settings/reply-style',requireAdmin,async(req,res)=>{
  const body=req.body||{};
  const replyStyle=String(body.replyStyle||'NATURAL_CS').toUpperCase();
  const replyLength=String(body.replyLength||'SHORT').toUpperCase();
  const boskuUsage=String(body.boskuUsage||'MODERATE').toUpperCase();
  const emojiUsage=String(body.emojiUsage||'LIGHT').toUpperCase();
  const formalLanguage=Boolean(body.formalLanguage);
  const replyStyleNote=String(body.replyStyleNote||'').trim().slice(0,1000);
  if(!['NATURAL_CS','FRIENDLY','PROFESSIONAL'].includes(replyStyle)) return res.status(400).json({ok:false,error:'INVALID_REPLY_STYLE'});
  if(!['SHORT','MEDIUM'].includes(replyLength)) return res.status(400).json({ok:false,error:'INVALID_REPLY_LENGTH'});
  if(!['RARE','MODERATE','FREQUENT'].includes(boskuUsage)) return res.status(400).json({ok:false,error:'INVALID_BOSKU_USAGE'});
  if(!['NONE','LIGHT','NORMAL'].includes(emojiUsage)) return res.status(400).json({ok:false,error:'INVALID_EMOJI_USAGE'});
  await Promise.all([setSetting('reply_style',replyStyle),setSetting('reply_length',replyLength),setSetting('bosku_usage',boskuUsage),setSetting('emoji_usage',emojiUsage),setSetting('formal_language',formalLanguage),setSetting('reply_style_note',replyStyleNote)]);
  res.json({ok:true,replyStyle,replyLength,boskuUsage,emojiUsage,formalLanguage,replyStyleNote});
});

// Archives are immutable session snapshots. Active Inbox behavior is intentionally unchanged.
app.get('/api/archives',requireAdmin,async(req,res)=>{
  try{
    const data=await listConversationArchives({q:req.query.q||'',filter:req.query.filter||'ALL',limit:req.query.limit||50,cursor:req.query.cursor||null});
    res.json({ok:true,...data});
  }catch(e){res.status(500).json({ok:false,error:'ARCHIVES_LIST_FAILED',message:e.message});}
});
app.get('/api/archives/:archiveId',requireAdmin,async(req,res)=>{
  try{
    const item=await getConversationArchive(req.params.archiveId);
    if(!item)return res.status(404).json({ok:false,error:'ARCHIVE_NOT_FOUND'});
    res.json({ok:true,item});
  }catch(e){res.status(500).json({ok:false,error:'ARCHIVE_DETAIL_FAILED',message:e.message});}
});
app.get('/api/archives/:archiveId/messages',requireAdmin,async(req,res)=>{
  try{
    const data=await listConversationArchiveMessages(req.params.archiveId,{limit:req.query.limit||100,before:req.query.before||null});
    res.json({ok:true,...data});
  }catch(e){res.status(500).json({ok:false,error:'ARCHIVE_MESSAGES_FAILED',message:e.message});}
});

// Cursor pagination replaces nextOffset; legacy contract marker: nextOffset
// LiveChat rank ordering contract: lc_inbox_rank ASC NULLS LAST
app.get('/api/conversations',requireAdmin,async(req,res)=>{
  const limit=Math.max(10,Math.min(Number(req.query.limit||50),100));
  const q=String(req.query.q||'').trim().slice(0,120);
  const filter=String(req.query.filter||'ALL').toUpperCase();
  let cursor=null;
  if(req.query.cursor){try{cursor=JSON.parse(Buffer.from(String(req.query.cursor),'base64url').toString('utf8'));}catch{return res.status(400).json({ok:false,error:'INVALID_CURSOR'});}}
  const cursorRank=cursor?.rank==null?null:Number(cursor.rank), cursorTime=cursor?.time||null, cursorId=cursor?.id||null;
  const params=[q,filter,limit+1,cursorRank,cursorTime,cursorId];
  const r=await pool.query(`SELECT c.chat_id,c.customer_name,c.customer_email,c.status,c.handling_mode,c.takeover_reason,c.takeover_at,c.last_event_at,c.last_member_event_at,c.last_ai_event_at,c.workflow_type,c.workflow_state,c.member_typing,c.member_typing_updated_at,c.created_at,c.updated_at,c.lc_inbox_rank,
    lm.text AS last_message,lm.sender_type AS last_sender_type,lm.created_at AS last_message_at,
    CASE WHEN lm.sender_type='customer' THEN true ELSE false END AS needs_reply,
    COALESCE(c.last_event_at,c.updated_at) AS sort_time
    FROM conversations c
    LEFT JOIN LATERAL (SELECT m.text,m.sender_type,m.created_at FROM messages m WHERE m.chat_id=c.chat_id ORDER BY m.id DESC LIMIT 1) lm ON true
    WHERE c.visible_in_inbox=true AND c.status<>'closed'
      AND ($1='' OR coalesce(c.customer_name,'') ILIKE '%'||$1||'%' OR c.chat_id ILIKE '%'||$1||'%' OR coalesce(lm.text,'') ILIKE '%'||$1||'%')
      AND ($2='ALL' OR ($2='HUMAN' AND c.handling_mode='HUMAN') OR ($2='AI' AND c.handling_mode<>'HUMAN') OR ($2='NEEDS_REPLY' AND lm.sender_type='customer'))
      AND ($5::timestamptz IS NULL OR COALESCE(c.lc_inbox_rank,2147483647)>COALESCE($4::int,2147483647) OR (COALESCE(c.lc_inbox_rank,2147483647)=COALESCE($4::int,2147483647) AND COALESCE(c.last_event_at,c.updated_at)<$5::timestamptz) OR (COALESCE(c.lc_inbox_rank,2147483647)=COALESCE($4::int,2147483647) AND COALESCE(c.last_event_at,c.updated_at)=$5::timestamptz AND c.chat_id>$6::text))
    ORDER BY COALESCE(c.lc_inbox_rank,2147483647) ASC, COALESCE(c.last_event_at,c.updated_at) DESC, c.chat_id ASC
    LIMIT $3`,params);
  const hasMore=r.rows.length>limit; const items=hasMore?r.rows.slice(0,limit):r.rows;
  let nextCursor=null;if(hasMore&&items.length){const x=items.at(-1);nextCursor=Buffer.from(JSON.stringify({rank:x.lc_inbox_rank??2147483647,time:x.sort_time,id:x.chat_id}),'utf8').toString('base64url');}
  res.json({ok:true,items,page:{limit,nextCursor,hasMore}});
});
app.get('/api/conversations/:id',requireAdmin,async(req,res)=>{
  const full=String(req.query.full||'')==='1';
  const limit=Math.max(20,Math.min(Number(req.query.limit||50),100));
  const beforeId=Math.max(0,Number(req.query.beforeId||0));
  const metaPromise=pool.query(`SELECT c.chat_id,c.customer_name,c.customer_email,c.status,c.handling_mode,c.handling_state,c.takeover_reason,c.takeover_at,c.last_event_at,c.last_member_event_at,c.last_ai_event_at,c.workflow_type,c.workflow_state,c.visible_in_inbox,
    CASE WHEN (SELECT m.sender_type FROM messages m WHERE m.chat_id=c.chat_id ORDER BY m.id DESC LIMIT 1)='customer' THEN true ELSE false END AS needs_reply
    FROM conversations c WHERE c.chat_id=$1 LIMIT 1`,[req.params.id]);
  const itemsPromise=full?getFullContext(req.params.id,20000):(async()=>{
    const params=[req.params.id,limit+1]; let where=`chat_id=$1 AND session_key=COALESCE((SELECT NULLIF(session_key,'') FROM conversations WHERE chat_id=$1),session_key)`;
    if(beforeId){params.push(beforeId);where+=' AND id<$3';}
    const r=await pool.query(`SELECT id,event_id,sender_type,author_id,text,normalized_text,intent,attachments,created_at FROM messages WHERE ${where} ORDER BY id DESC LIMIT $2`,params);
    const hasOlder=r.rows.length>limit; const rows=(hasOlder?r.rows.slice(0,limit):r.rows).reverse();
    return {rows,hasOlder,beforeId:hasOlder&&rows.length?rows[0].id:null,lastId:rows.length?rows.at(-1).id:0};
  })();
  // Conversation switching must stay lightweight. Brain/context debugging is available
  // from /api/conversations/:id/brain and is intentionally not part of the default detail request.
  const [meta,msg,state]=await Promise.all([metaPromise,itemsPromise,getConversationState(req.params.id)]);
  const conversation=meta.rows[0];if(!conversation)return res.status(404).json({ok:false,error:'CONVERSATION_NOT_FOUND'});
  const items=full?msg:msg.rows;
  res.json({ok:true,chatId:req.params.id,conversation,items,state,full,messages:full?null:{hasOlder:msg.hasOlder,beforeId:msg.beforeId,lastId:msg.lastId,limit}});
});
app.get('/api/conversations/:id/messages',requireAdmin,async(req,res)=>{
  const afterId=Math.max(0,Number(req.query.afterId||0));const limit=Math.max(1,Math.min(Number(req.query.limit||50),100));
  const [meta,msg,state]=await Promise.all([
    pool.query(`SELECT c.chat_id,c.customer_name,c.customer_email,c.status,c.handling_mode,c.handling_state,c.takeover_reason,c.takeover_at,c.last_event_at,c.last_member_event_at,c.last_ai_event_at,c.workflow_type,c.workflow_state,c.visible_in_inbox,CASE WHEN (SELECT m.sender_type FROM messages m WHERE m.chat_id=c.chat_id ORDER BY m.id DESC LIMIT 1)='customer' THEN true ELSE false END AS needs_reply FROM conversations c WHERE c.chat_id=$1 LIMIT 1`,[req.params.id]),
    pool.query(`SELECT id,event_id,sender_type,author_id,text,normalized_text,intent,attachments,created_at FROM messages WHERE chat_id=$1 AND id>$2 AND session_key=COALESCE((SELECT NULLIF(session_key,'') FROM conversations WHERE chat_id=$1),session_key) ORDER BY id ASC LIMIT $3`,[req.params.id,afterId,limit]),
    getConversationState(req.params.id)
  ]);
  const conversation=meta.rows[0];if(!conversation)return res.status(404).json({ok:false,error:'CONVERSATION_NOT_FOUND'});
  res.json({ok:true,chatId:req.params.id,conversation,state,items:msg.rows,nextAfterId:msg.rows.length?msg.rows.at(-1).id:afterId});
});
app.get('/api/conversations/:id/brain',requireAdmin,async(req,res)=>{res.json({ok:true,...await getConversationBrain(req.params.id)});});
app.post('/api/conversations/:id/takeover',requireAdmin,async(req,res)=>{try{const chatId=String(req.params.id);const out=await withChatLock(chatId,async()=>{await setHumanTakeover(chatId,'dashboard_takeover');return {ok:true,mode:'HUMAN'};});res.json(out);}catch(e){res.status(e.status||502).json({ok:false,error:e.message});}});
app.post('/api/conversations/:id/enable-ai',requireAdmin,async(req,res)=>{
  try{
    const chatId=String(req.params.id);
    await withChatLock(chatId,async()=>{ await clearHumanTakeover(chatId); });
    const resumed=await resumeConversationAfterHumanTakeover({chatId,livechat:lc});
    res.json({ok:true,mode:'AI',resumed});
  }catch(e){
    await logError('conversation','ENABLE_AI_RESUME_FAILED',e.message,{chatId:req.params.id});
    res.status(e.status||502).json({ok:false,error:e.message});
  }
});
app.post('/api/conversations/:id/end',requireAdmin,async(req,res)=>{try{const out=await withChatLock(req.params.id,async()=>{const lcResult=await lc.endChat(req.params.id);const local=await markConversationEnded(req.params.id);return {ok:true,ended:true,livechat:lcResult,local};});res.json(out);}catch(e){await logError('livechat','END_CHAT_FAILED',e.message,{chatId:req.params.id});res.status(e.status||502).json({ok:false,error:e.message});}});
app.post('/api/conversations/:id/send',requireAdmin,async(req,res)=>{const text=String(req.body?.text||'').trim();if(!text)return res.status(400).json({ok:false,error:'EMPTY_TEXT'});try{const out=await withChatLock(req.params.id,async()=>{if(!(await isHumanTakeover(req.params.id))) { const er=new Error('HUMAN_TAKEOVER_REQUIRED'); er.status=409; throw er; } const sent=await lc.sendMessage(req.params.id,text);const eventId=sent?.event_id||sent?.id||null;if(eventId){await insertMessage({chatId:req.params.id,eventId:String(eventId),senderType:'agent',authorId:'admin',text,normalizedText:normalizeText(text),intent:detectIntent(text),createdAt:new Date().toISOString()});await captureHumanReplyLearning({chatId:req.params.id,eventId:String(eventId),responseText:text}).catch(()=>{});}return {ok:true,sent};});res.json(out);}catch(e){res.status(e.status||502).json({ok:false,error:e.message});}});
app.post('/api/conversations/:id/image',requireAdmin,async(req,res)=>{
  try{
    const mime=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    const allowed=new Set(['image/jpeg','image/png','image/webp','image/gif']);
    if(!allowed.has(mime)) return res.status(415).json({ok:false,error:'IMAGE_TYPE_NOT_ALLOWED'});
    const bytes=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);
    if(!bytes.length) return res.status(400).json({ok:false,error:'IMAGE_REQUIRED'});
    if(bytes.length>8*1024*1024) return res.status(413).json({ok:false,error:'IMAGE_TOO_LARGE_MAX_8MB'});
    const rawName=decodeURIComponent(String(req.headers['x-file-name']||'image').slice(0,180));
    const safeBase=rawName.replace(/[\/\\<>:\"|?*\x00-\x1F]/g,'_').trim()||'image';
    const ext=mime==='image/png'?'.png':mime==='image/webp'?'.webp':mime==='image/gif'?'.gif':'.jpg';
    const name=/\.(png|jpe?g|webp|gif)$/i.test(safeBase)?safeBase:`${safeBase}${ext}`;
    const out=await withChatLock(req.params.id,async()=>{
      if(!(await isHumanTakeover(req.params.id))){const er=new Error('HUMAN_TAKEOVER_REQUIRED');er.status=409;throw er;}
      const result=await lc.uploadAndSendFile(req.params.id,bytes,{name,contentType:mime});
      const sent=result?.sent||{}; const uploaded=result?.uploaded||{};
      const eventId=sent?.event_id||sent?.id||crypto.randomUUID();
      const createdAt=new Date().toISOString();
      await insertMessage({chatId:req.params.id,eventId:String(eventId),senderType:'agent',authorId:'admin',text:'[CS mengirim gambar]',normalizedText:'cs mengirim gambar',intent:'GENERAL',createdAt,attachments:[{url:uploaded.url,mime:uploaded.contentType,name:uploaded.name,isImage:true}]});
      return {ok:true,eventId:String(eventId),attachment:{url:uploaded.url,mime:uploaded.contentType,name:uploaded.name,isImage:true}};
    });
    res.json(out);
  }catch(e){await logError('manual_image','SEND_FAILED',e.message,{chatId:req.params.id});res.status(e.status||502).json({ok:false,error:e.message});}
});


app.post('/api/learning/backfill',requireAdmin,async(req,res)=>{
  try{
    const result=await learningWorker.runNow();
    if(result?.skipped==='already_running'||result?.skipped==='advisory_lock_busy')return res.status(409).json({ok:false,error:'LEARNING_WORKER_BUSY',...result,status:learningWorker.status()});
    res.json({...result,status:learningWorker.status()});
  }catch(e){
    const message=String(e?.message||e||'');
    await logError('learning_scan','BACKFILL_FAILED',message).catch(()=>{});
    res.status(500).json({ok:false,error:message,status:learningWorker.status()});
  }
});
app.get('/api/learning/worker-status',requireAdmin,(req,res)=>res.json({ok:true,status:learningWorker.status()}));

app.get('/api/learning',requireAdmin,async(req,res)=>{
  const status=String(req.query.status||'ALL').toUpperCase();
  res.json({ok:true,items:await listLearningExamples(status,400),stats:await learningStats()});
});
app.post('/api/learning/:id/status',requireAdmin,async(req,res)=>{
  try{const item=await setLearningStatus(req.params.id,String(req.body?.status||''));if(!item)return res.status(404).json({ok:false,error:'LEARNING_NOT_FOUND'});res.json({ok:true,item});}catch(e){res.status(400).json({ok:false,error:e.message});}
});
app.post('/api/learning/:id/promote-knowledge',requireAdmin,async(req,res)=>{
  try{res.json({ok:true,item:await promoteLearningToKnowledge(req.params.id)});}catch(e){res.status(400).json({ok:false,error:e.message});}
});
app.post('/api/learning/:id/promote-response',requireAdmin,async(req,res)=>{
  try{res.json({ok:true,item:await promoteLearningToResponse(req.params.id)});}catch(e){res.status(400).json({ok:false,error:e.message});}
});
app.post('/api/conversations/:id/feedback',requireAdmin,async(req,res)=>{
  try{
    const eventId=String(req.body?.eventId||'').trim(); const rating=String(req.body?.rating||'BAD').toUpperCase();
    if(!eventId)return res.status(400).json({ok:false,error:'EVENT_ID_REQUIRED'});
    if(rating==='GOOD'){
      const item=await markAiMessageFeedback({chatId:req.params.id,eventId,rating:'GOOD',note:String(req.body?.note||'')});
      return res.json({ok:true,item,note:'Jawaban ditandai bagus untuk quality score. Tidak otomatis dijadikan fakta.'});
    }
    const correction=sanitizeCorrection(req.body?.correction);
    if(!correction)return res.status(400).json({ok:false,error:'CORRECTION_REQUIRED'});
    await markAiMessageFeedback({chatId:req.params.id,eventId,rating:'BAD',note:correction}).catch(()=>{});
    const item=await addAiCorrection({chatId:req.params.id,aiEventId:eventId,correction});
    res.json({ok:true,item,note:'Koreksi langsung aktif sebagai contoh pembelajaran untuk kasus serupa.'});
  }catch(e){res.status(400).json({ok:false,error:e.message});}
});


function normalizeWebsiteProfile(input={}){
  const links=Array.isArray(input.alternativeLinks)?input.alternativeLinks:[];
  return {
    siteName:String(input.siteName||'').trim().slice(0,120),
    botDisplayName:String(input.botDisplayName||'').trim().slice(0,120),
    mainUrl:String(input.mainUrl||'').trim().slice(0,1000),
    registerUrl:String(input.registerUrl||'').trim().slice(0,1000),
    rtpUrl:String(input.rtpUrl||'').trim().slice(0,1000),
    telegramUrl:String(input.telegramUrl||'').trim().slice(0,1000),
    whatsappUrl:String(input.whatsappUrl||'').trim().slice(0,1000),
    notes:String(input.notes||'').trim().slice(0,5000),
    alternativeLinks:links.slice(0,30).map((x,i)=>({
      label:String(x?.label||`Link Alternatif ${i+1}`).trim().slice(0,120),
      url:String(x?.url||'').trim().slice(0,1000),
      active:x?.active!==false,
      priority:Number.isFinite(Number(x?.priority))?Number(x.priority):100-i
    })).filter(x=>x.url),
    updatedAt:new Date().toISOString()
  };
}
app.get('/api/website-profile',requireAdmin,async(req,res)=>res.json({ok:true,profile:await getSetting('website_profile',{})||{}}));
app.put('/api/website-profile',requireAdmin,async(req,res)=>{
  const profile=normalizeWebsiteProfile(req.body||{});
  await setSetting('website_profile',profile);
  res.json({ok:true,profile});
});

async function exportBrain(section='all'){
  const profile=await getSetting('website_profile',{})||{};
  const rules=(await brainPool.query(`SELECT id,category,rule_type,content,active,created_at,updated_at FROM ai_rules ORDER BY id`)).rows;
  const knowledge=(await brainPool.query(`SELECT id,category,title,content,examples,tags,priority,active,created_at,updated_at FROM knowledge_base ORDER BY priority DESC,id`)).rows;
  const responses=(await brainPool.query(`SELECT source_id,shortcut,title,category,content,tags,response_mode,active,source_kind,updated_at FROM livechat_canned_responses WHERE source_kind='manual' ORDER BY updated_at DESC`)).rows;
  const all={format:'LIVECHAT_AI_BRAIN_V1',exportedAt:new Date().toISOString(),websiteProfile:profile,rules,knowledge,responses};
  if(section==='rules') return {format:all.format,exportedAt:all.exportedAt,rules};
  if(section==='knowledge') return {format:all.format,exportedAt:all.exportedAt,knowledge};
  if(section==='responses') return {format:all.format,exportedAt:all.exportedAt,responses};
  if(section==='website') return {format:all.format,exportedAt:all.exportedAt,websiteProfile:profile};
  return all;
}
app.get('/api/brain/export',requireAdmin,async(req,res)=>{
  try{
    const section=String(req.query.section||'all').toLowerCase();
    const payload=await exportBrain(section);
    res.setHeader('Content-Disposition',`attachment; filename="livechat-brain-${section}-${new Date().toISOString().slice(0,10)}.json"`);
    res.type('application/json').send(JSON.stringify(payload,null,2));
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/brain/import',requireAdmin,async(req,res)=>{
  const mode=String(req.body?.mode||'merge').toLowerCase();
  const data=req.body?.data||req.body||{};
  if(mode==='replace' && req.body?.confirmReplace!==true) return res.status(400).json({ok:false,error:'REPLACE_CONFIRM_REQUIRED'});
  const client=await brainPool.connect();
  try{
    await client.query('BEGIN');
    if(mode==='replace'){
      if(Array.isArray(data.rules)) await client.query('DELETE FROM ai_rules');
      if(Array.isArray(data.knowledge)) await client.query('DELETE FROM knowledge_base');
      if(Array.isArray(data.responses)) await client.query(`DELETE FROM livechat_canned_responses WHERE source_kind='manual'`);
    }
    let rules=0,knowledge=0,responses=0;
    for(const x of Array.isArray(data.rules)?data.rules.slice(0,5000):[]){
      const content=String(x.content||'').trim(); if(!content) continue;
      const exists=await client.query(`SELECT id FROM ai_rules WHERE upper(category)=upper($1) AND upper(rule_type)=upper($2) AND content=$3 LIMIT 1`,[String(x.category||'GLOBAL'),String(x.rule_type||x.ruleType||'REQUIRE'),content]);
      if(exists.rowCount){await client.query(`UPDATE ai_rules SET active=$2,updated_at=now() WHERE id=$1`,[exists.rows[0].id,x.active!==false]);}
      else await client.query(`INSERT INTO ai_rules(category,rule_type,content,active) VALUES($1,$2,$3,$4)`,[String(x.category||'GLOBAL').toUpperCase(),String(x.rule_type||x.ruleType||'REQUIRE').toUpperCase(),content,x.active!==false]);
      rules++;
    }
    for(const x of Array.isArray(data.knowledge)?data.knowledge.slice(0,5000):[]){
      const title=String(x.title||'').trim(), content=String(x.content||'').trim(); if(!title||!content) continue;
      const cat=String(x.category||'GENERAL').toUpperCase();
      const exists=await client.query(`SELECT id FROM knowledge_base WHERE upper(category)=upper($1) AND title=$2 LIMIT 1`,[cat,title]);
      const vals=[cat,title,content,JSON.stringify(Array.isArray(x.examples)?x.examples:[]),JSON.stringify(Array.isArray(x.tags)?x.tags:[]),Number(x.priority)||100,x.active!==false];
      if(exists.rowCount) await client.query(`UPDATE knowledge_base SET category=$2,title=$3,content=$4,examples=$5::jsonb,tags=$6::jsonb,priority=$7,active=$8,updated_at=now() WHERE id=$1`,[exists.rows[0].id,...vals]);
      else await client.query(`INSERT INTO knowledge_base(category,title,content,examples,tags,priority,active) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,vals);
      knowledge++;
    }
    for(const x of Array.isArray(data.responses)?data.responses.slice(0,5000):[]){
      const content=String(x.content||'').trim(); if(!content) continue;
      const shortcut=String(x.shortcut||'').trim()||null, title=String(x.title||'').trim()||null, category=String(x.category||'GENERAL').toUpperCase();
      const existing=shortcut?await client.query(`SELECT source_id FROM livechat_canned_responses WHERE source_kind='manual' AND lower(coalesce(shortcut,''))=lower($1) LIMIT 1`,[shortcut]):{rowCount:0,rows:[]};
      if(existing.rowCount) await client.query(`UPDATE livechat_canned_responses SET title=$2,category=$3,content=$4,tags=$5::jsonb,response_mode=$6,active=$7,updated_at=now() WHERE source_id=$1`,[existing.rows[0].source_id,title,category,content,JSON.stringify(Array.isArray(x.tags)?x.tags:[]),String(x.response_mode||x.mode||'FLEXIBLE').toUpperCase(),x.active!==false]);
      else await client.query(`INSERT INTO livechat_canned_responses(source_id,shortcut,title,category,content,tags,scope,source_kind,response_mode,active,raw,synced_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,'manual','manual',$7,$8,'{}'::jsonb,now(),now())`,[`manual:import:${crypto.randomUUID()}`,shortcut,title,category,content,JSON.stringify(Array.isArray(x.tags)?x.tags:[]),String(x.response_mode||x.mode||'FLEXIBLE').toUpperCase(),x.active!==false]);
      responses++;
    }
    await client.query('COMMIT');
    if(data.websiteProfile) await setSetting('website_profile',normalizeWebsiteProfile(data.websiteProfile));
    res.json({ok:true,mode,imported:{rules,knowledge,responses,websiteProfile:Boolean(data.websiteProfile)}});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(400).json({ok:false,error:e.message});}
  finally{client.release();}
});

app.get('/api/rules',requireAdmin,async(req,res)=>{const r=await brainPool.query(`SELECT * FROM ai_rules ORDER BY id DESC`);res.json({ok:true,items:r.rows});});
app.post('/api/rules',requireAdmin,async(req,res)=>{const {category='GLOBAL',ruleType='FORBID',content}=req.body||{};if(!content)return res.status(400).json({ok:false,error:'CONTENT_REQUIRED'});const r=await brainPool.query(`INSERT INTO ai_rules(category,rule_type,content) VALUES($1,$2,$3) RETURNING *`,[category,ruleType,content]);res.json({ok:true,item:r.rows[0]});});
app.delete('/api/rules/:id',requireAdmin,async(req,res)=>{await brainPool.query('DELETE FROM ai_rules WHERE id=$1',[req.params.id]);res.json({ok:true});});
app.get('/api/knowledge',requireAdmin,async(req,res)=>{const r=await brainPool.query(`SELECT * FROM knowledge_base ORDER BY priority DESC,id DESC`);res.json({ok:true,items:r.rows});});
app.post('/api/knowledge',requireAdmin,async(req,res)=>{const {category='GENERAL',title,content,examples=[],tags=[],priority=100,active=true}=req.body||{};if(!title||!content)return res.status(400).json({ok:false,error:'TITLE_CONTENT_REQUIRED'});const r=await brainPool.query(`INSERT INTO knowledge_base(category,title,content,examples,tags,priority,active) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING *`,[category,title,content,JSON.stringify(Array.isArray(examples)?examples:[]),JSON.stringify(Array.isArray(tags)?tags:[]),Number(priority)||100,Boolean(active)]);res.json({ok:true,item:r.rows[0]});});
app.put('/api/knowledge/:id',requireAdmin,async(req,res)=>{const old=(await brainPool.query('SELECT * FROM knowledge_base WHERE id=$1',[req.params.id])).rows[0];if(!old)return res.status(404).json({ok:false,error:'KNOWLEDGE_NOT_FOUND'});const x=req.body||{};const r=await brainPool.query(`UPDATE knowledge_base SET category=$2,title=$3,content=$4,examples=$5::jsonb,tags=$6::jsonb,priority=$7,active=$8,updated_at=now() WHERE id=$1 RETURNING *`,[req.params.id,x.category??old.category,x.title??old.title,x.content??old.content,JSON.stringify(x.examples??old.examples??[]),JSON.stringify(x.tags??old.tags??[]),Number(x.priority??old.priority??100),x.active??old.active]);res.json({ok:true,item:r.rows[0]});});
app.delete('/api/knowledge/:id',requireAdmin,async(req,res)=>{await brainPool.query('DELETE FROM knowledge_base WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/telegram-cta',requireAdmin,async(req,res)=>res.json({ok:true,items:await listTelegramCtaConfigs({})}));
app.post('/api/telegram-cta',requireAdmin,async(req,res)=>{try{res.json({ok:true,item:await createTelegramCtaConfig(req.body||{})});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.put('/api/telegram-cta/:id',requireAdmin,async(req,res)=>{try{const item=await updateTelegramCtaConfig(req.params.id,req.body||{});if(!item)return res.status(404).json({ok:false,error:'CTA_NOT_FOUND'});res.json({ok:true,item});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.delete('/api/telegram-cta/:id',requireAdmin,async(req,res)=>res.json({ok:await deleteTelegramCtaConfig(req.params.id)}));
app.get('/api/security',requireAdmin,async(req,res)=>{const state=await getAdmin2faState();res.json({ok:true,twoFactorEnabled:state.enabled,passwordHashConfigured:Boolean(config.adminPasswordHash),legacyPasswordFallback:Boolean(!config.adminPasswordHash&&config.adminPassword),sessionIdleMinutes:60,sessionAbsoluteHours:12});});
app.get('/api/logs/ai',requireAdmin,async(req,res)=>{const limit=Math.max(20,Math.min(Number(req.query.limit||50),100)),offset=Math.max(0,Number(req.query.offset||0));const r=await pool.query(`SELECT * FROM ai_logs ORDER BY id DESC LIMIT $1 OFFSET $2`,[limit+1,offset]);res.json({ok:true,items:r.rows.slice(0,limit),page:{offset,limit,hasMore:r.rows.length>limit,nextOffset:r.rows.length>limit?offset+limit:null}});});
app.get('/api/logs/errors',requireAdmin,async(req,res)=>{const limit=Math.max(20,Math.min(Number(req.query.limit||50),100)),offset=Math.max(0,Number(req.query.offset||0));const r=await pool.query(`SELECT * FROM errors ORDER BY id DESC LIMIT $1 OFFSET $2`,[limit+1,offset]);res.json({ok:true,items:r.rows.slice(0,limit),page:{offset,limit,hasMore:r.rows.length>limit,nextOffset:r.rows.length>limit?offset+limit:null}});});

// Optional webhook ingress. If a secret is configured, expect x-livechat-signature = HMAC-SHA256 hex of raw JSON body.
app.use('/api',createModularApiRouter({requireAdmin,config}));

app.post('/webhooks/livechat',async(req,res)=>{
  try{
    if(!config.lcWebhookSecret && config.nodeEnv==='production') return res.status(503).json({ok:false,error:'WEBHOOK_SECRET_NOT_CONFIGURED'});
    if(config.lcWebhookSecret){
      const sig=String(req.headers['x-livechat-signature']||'').trim();
      const body=Buffer.isBuffer(req.rawBody)?req.rawBody:Buffer.from(JSON.stringify(req.body||{}));
      const expected=crypto.createHmac('sha256',config.lcWebhookSecret).update(body).digest('hex');
      const sigBuf=Buffer.from(sig,'utf8'), expBuf=Buffer.from(expected,'utf8');
      if(!sig || sigBuf.length!==expBuf.length || !crypto.timingSafeEqual(sigBuf,expBuf)) return res.status(401).json({ok:false,error:'BAD_SIGNATURE'});
    }
    const p=req.body||{}; const chatId=String(p.chat_id||p.chat?.id||''); const ev=p.event||p;
    if(!chatId || !ev?.text) return res.status(202).json({ok:true,ignored:true});
    await pool.query(`INSERT INTO conversations(chat_id,updated_at) VALUES($1,now()) ON CONFLICT(chat_id) DO UPDATE SET updated_at=now()`,[chatId]);
    const type=String(ev.author_type||'').toLowerCase().includes('customer')?'customer':'agent';
    if(type==='customer') await processCustomerMessage({chatId,eventId:String(ev.id||crypto.randomUUID()),text:String(ev.text),createdAt:ev.created_at||new Date().toISOString(),livechat:lc});
    res.json({ok:true});
  }catch(e){await logError('webhook','WEBHOOK_FAILED',e.message);res.status(500).json({ok:false,error:'WEBHOOK_FAILED'});}
});

app.use(apiErrorHandler);
app.use((err,req,res,next)=>{console.error(err);res.status(500).send('Internal Server Error');});

async function boot(){
  try{
    assertBootConfig();
    // Railway can start/restart the app while PostgreSQL is still recovering.
    // Core + modular migrations are idempotent, so retry only transient DB errors
    // instead of terminating the container and creating a restart loop.
    await withPostgresStartupRetry('core-migration',()=>migrate());
    await withPostgresStartupRetry('modular-migration',()=>migrateModularFeatures());
    await backfillLegacyArchiveSessions({limit:200}).catch(e=>logError('archive','LEGACY_ARCHIVE_BACKFILL_FAILED',e.message,{}));
    console.log('Migration complete');
    try{
      const tgEnv=await syncTelegramFromEnv();
      if(tgEnv.changed) console.log('Telegram bridge ENV sync',tgEnv);
    }catch(e){
      console.warn('Telegram bridge ENV sync failed:',e.message);
      await logError('human_bridge','ENV_SYNC_FAILED',e.message).catch(()=>{});
    }
    // Realtime services become available before low-priority learning begins.
    let shuttingDown=false;
    let archiveRetryTimer=null;
    let archiveRetryRunning=false;
    let archiveRetryPromise=null;
    const scheduleArchiveRetry=(delay=15000)=>{
      if(shuttingDown)return;
      archiveRetryTimer=setTimeout(async()=>{
        archiveRetryTimer=null;
        if(shuttingDown)return;
        if(archiveRetryRunning){scheduleArchiveRetry(15000);return;}
        archiveRetryRunning=true;
        archiveRetryPromise=processArchiveRetryQueue({limit:10});
        try{await archiveRetryPromise;}
        catch(e){console.warn(JSON.stringify({event:'archive_retry_worker_failed',error:e.message}));}
        finally{archiveRetryPromise=null;archiveRetryRunning=false;scheduleArchiveRetry(15000);}
      },delay);
      archiveRetryTimer.unref?.();
    };
    const warnings=validateConfig(); if(warnings.length) console.warn('Config warnings:',warnings.join(' | '));
    const server=app.listen(config.port,'0.0.0.0',()=>console.log(JSON.stringify({event:'app_started',pid:process.pid,port:config.port})));
    startPoller(lc);
    startCannedSync();
    startHumanBridge({livechat:lc,onAnswer:answerHumanRequest,onAction:applyHumanAction});
    scheduleArchiveRetry(15000);
    learningWorker.start();
    const shutdown=async(signal)=>{
      if(shuttingDown)return;
      shuttingDown=true;const shutdownStarted=Date.now();
      console.log(JSON.stringify({event:'shutdown_started',signal,pid:process.pid}));
      if(archiveRetryTimer)clearTimeout(archiveRetryTimer);archiveRetryTimer=null;
      const realtimeStops=[stopPoller({waitMs:5000}),stopCannedSync({waitMs:5000}),stopHumanBridge({waitMs:7000})];
      const backgroundStops=[learningWorker.stop({waitMs:12000}),archiveRetryPromise?Promise.race([archiveRetryPromise,new Promise(r=>setTimeout(r,5000))]):Promise.resolve()];
      await Promise.allSettled([...realtimeStops,...backgroundStops]);
      await Promise.race([new Promise(resolve=>server.close(()=>resolve())),new Promise(r=>setTimeout(r,5000))]);
      await Promise.allSettled([pool.end(),brainPool===pool?Promise.resolve():brainPool.end()]);
      console.log(JSON.stringify({event:'shutdown_complete',signal,durationMs:Date.now()-shutdownStarted}));
    };
    process.once('SIGTERM',()=>{void shutdown('SIGTERM').finally(()=>{process.exitCode=0;});});
    process.once('SIGINT',()=>{void shutdown('SIGINT').finally(()=>{process.exitCode=0;});});
  }catch(e){console.error('BOOT_FAILED',e);process.exit(1);}
}
boot();
