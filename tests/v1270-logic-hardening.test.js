
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent, normalizeText } from '../src/normalizer.js';
import { pickBonusLabel } from '../src/bonus-label.js';
import {
  detectGenericAmbiguity,isClosingMessage,isReopenMessage,extractTransactionAmount,
  extractWaitingDuration,attachmentClass,priorityForIntent,shouldHardSwitch,topicFamily,
  redactSensitive,fuzzyConfidence,validateRegistrationData,caseExpired,contradictionStatus,
  bonusStageAllowed
} from '../src/ops-hardening.js';

test('generic ambiguous one-liners are clarified, not guessed',()=>{
  assert.ok(detectGenericAmbiguity('belum masuk'));
  assert.ok(detectGenericAmbiguity('ga bisa'));
  assert.equal(detectGenericAmbiguity('wd belum masuk'),null);
});

test('hard topic switch favors explicit new operational topic',()=>{
  assert.equal(shouldHardSwitch({previousIntent:'DEPOSIT_PROBLEM',freshIntent:'WITHDRAW_PROBLEM',text:'wd belum masuk'}),true);
  assert.equal(shouldHardSwitch({previousIntent:'WITHDRAW_PROBLEM',freshIntent:'WITHDRAW_PROBLEM',text:'wd belum masuk'}),false);
});

test('closing and reopen messages are separated',()=>{
  assert.equal(isClosingMessage('sudah bos'),true);
  assert.equal(isClosingMessage('sudah tapi masih belum masuk'),false);
  assert.equal(isReopenMessage('masih belum masuk bos'),true);
});

test('transaction amounts understand common Indonesian shorthand',()=>{
  assert.equal(extractTransactionAmount('wd 500 belum masuk','WITHDRAW_PROBLEM'),500000);
  assert.equal(extractTransactionAmount('depo 100 belum masuk','DEPOSIT_PROBLEM'),100000);
  assert.equal(extractTransactionAmount('deposit Rp 1.000.000 belum masuk','DEPOSIT_PROBLEM'),1000000);
});

test('waiting duration extraction supports minutes hours and relative language',()=>{
  assert.equal(extractWaitingDuration('sudah 10 menit')?.minutes,10);
  assert.equal(extractWaitingDuration('udah 2 jam')?.minutes,120);
  assert.equal(extractWaitingDuration('dari tadi bos')?.raw,'dari tadi');
});

test('attachment classifier does not force every image to deposit',()=>{
  const imgs=[{url:'https://example.test/a.jpg',isImage:true}];
  assert.equal(attachmentClass({intent:'LOGIN_PROBLEM',text:'ga bisa login',attachments:imgs}),'LOGIN_ERROR');
  assert.equal(attachmentClass({intent:'GAME_PROBLEM',text:'game macet',attachments:imgs}),'GAME_ERROR');
  assert.equal(attachmentClass({intent:'GENERAL',text:'ini bos',attachments:imgs}),'UNKNOWN_IMAGE');
});

test('operational priority puts security and transaction above generic complaints',()=>{
  assert.ok(priorityForIntent('FORGOT_PASSWORD')>priorityForIntent('BONUS_REQUEST'));
  assert.ok(priorityForIntent('DEPOSIT_PROBLEM')>priorityForIntent('LOSS_COMPLAINT'));
});

test('topic families separate DP WD access bonus',()=>{
  assert.equal(topicFamily('DEPOSIT_PROBLEM'),'DEPOSIT');
  assert.equal(topicFamily('WITHDRAW_PROBLEM'),'WITHDRAW');
  assert.equal(topicFamily('FORGOT_PASSWORD'),'ACCESS');
  assert.equal(topicFamily('BONUS_REQUEST'),'BONUS');
});

test('sensitive log values are redacted',()=>{
  const x=redactSensitive('UserID: abc Password: qq123123 bot_token: 123456:SECRET');
  assert.doesNotMatch(x,/qq123123/);
});

test('fuzzy confidence is bounded',()=>{
  assert.ok(fuzzyConfidence('normal chat bos')>=0 && fuzzyConfidence('normal chat bos')<=1);
});

test('registration validation allows missing email phone but validates required values when present',()=>{
  const ok=validateRegistrationData({username:'budi123',bank:'DANA',name:'Budi Santoso',no:'081234567890'});
  assert.equal(ok.ok,true);
  const bad=validateRegistrationData({username:'x',bank:'UNKNOWN',name:'B',no:'12'});
  assert.equal(bad.ok,false);
  assert.ok(bad.errors.length>=3);
});

test('case expiry is deterministic',()=>{
  assert.equal(caseExpired(new Date(Date.now()-3*60*60*1000).toISOString(),120),true);
  assert.equal(caseExpired(new Date().toISOString(),120),false);
});

test('contradicting staff status overrides pending state',()=>{
  assert.equal(contradictionStatus('PENDING','WD gagal karena rekening limit'),'OVERRIDE_FAILED');
  assert.equal(contradictionStatus('PENDING','sudah selesai'),'OVERRIDE_DONE');
});

test('bonus state machine blocks transitions after terminal state',()=>{
  assert.equal(bonusStageAllowed('WAITING_ID','WAITING_STAFF'),true);
  assert.equal(bonusStageAllowed('APPROVED','WAITING_ID'),false);
});

test('bonus precedence keeps named campaigns above generic deposit bonus',()=>{
  assert.equal(pickBonusLabel('claim bonus new member deposit'),'BONUS NEW MEMBER');
  assert.equal(pickBonusLabel('claim bonus ronda deposit'),'BONUS RONDA');
  assert.equal(pickBonusLabel('claim bonus bulanan deposit'),'BONUS BULANAN');
  assert.equal(pickBonusLabel('claim bonus deposit'),'BONUS HARIAN Rp5.000');
});

test('expanded typo dictionary understands common shorthand',()=>{
  assert.match(normalizeText('gbs login blm msk'),/tidak bisa login belum masuk/);
  assert.equal(detectIntent('dftar akun bos'),'REGISTER_REQUEST');
});

test('QRIS/barcode missing routes to screenshot-first disturbance flow',()=>{
  assert.equal(detectIntent('qris tidak muncul bos'),'GENERAL_DISTURBANCE');
  assert.equal(detectIntent('scan barcode ga bisa'),'GENERAL_DISTURBANCE');
});

test('DB contains session-key, case audit, entity, health, expiry and DLQ hardening',()=>{
  const src=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  for(const token of [
    'session_key TEXT','case_audit_events','case_entities','integration_health',
    'expireStaleHumanRequests','addDeadLetter','shouldSuppressOutbound',
    'closeOpenHumanRequests','reopened_from','case_key'
  ]) assert.match(src,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('engine contains anti-repeat, topic-switch, audit, entity, reopen and contradiction guards',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  for(const token of [
    'duplicate_reply_guard','TOPIC_SWITCH','MEMBER_MESSAGE_CLASSIFIED',
    'CASE_REOPEN_SIGNAL','HUMAN_STATUS_OVERRIDE','validateRegistrationData',
    'GENERIC_CLARIFY','attachment_type'
  ]) assert.match(src,new RegExp(token));
});

test('Telegram bridge requires reply-to-ticket for sensitive operational categories',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(src,/Sensitive operational replies MUST be reply-to-ticket/);
  assert.match(src,/RESET_PASSWORD','DEPOSIT_PROBLEM','WD_PROBLEM','BONUS/);
});

test('SLA escalation follows configurable base 1x 2x 4x stages',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  const hb=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(db,/sla_due_at-created_at/);
  assert.match(db,/\* 2/);
  assert.match(db,/\* 4/);
  assert.match(hb,/base\*4/);
  assert.match(hb,/base\*2/);
  assert.match(hb,/SLA ESCALATION/);
});

test('ops endpoints expose audit health and dead-letter retry',()=>{
  const src=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(src,/\/api\/ops\/audit\/:chatId/);
  assert.match(src,/\/api\/ops\/health/);
  assert.match(src,/\/api\/ops\/dead-letters/);
  assert.match(src,/\/api\/ops\/dead-letters\/:id\/retry/);
});

test('deposit cancellation includes explicit cannot-cancel outcome',()=>{
  const hb=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  const e=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(hb,/DP_CANCEL_REJECTED/);
  assert.match(e,/DP_CANCEL_REJECTED/);
});

test('takeover release performs audited resync',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/HUMAN_TAKEOVER_RELEASED/);
  assert.match(src,/AI_RESYNC_RESUMED/);
});
