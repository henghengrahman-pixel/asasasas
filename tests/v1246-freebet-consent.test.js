import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FREEBET_TERMS, FREEBET_DONE_REPLY, FREEBET_NOT_ELIGIBLE_REPLY, isFreebet50, isFreebetAgreement } from '../src/freebet.js';

test('v1.24.6 identifies FreeBet / bonus 50 percent without stealing RONDA',()=>{
  assert.equal(isFreebet50('claim bonus freebet mudin99','BONUS FREEBET'),true);
  assert.equal(isFreebet50('claim bonus 50% mudin99',''),true);
  assert.equal(isFreebet50('claim bonus ronda 50% mudin99','BONUS RONDA'),false);
});

test('v1.24.6 FreeBet sends full terms before staff escalation',()=>{
  assert.match(FREEBET_TERMS,/SYARAT BONUS FREEBET SLOTGAME/);
  assert.match(FREEBET_TERMS,/Minimal Deposit.*Rp\.50\.000/);
  assert.match(FREEBET_TERMS,/10x Turnover/);
  assert.match(FREEBET_TERMS,/balas OKE \/ SETUJU/i);
});

test('v1.24.6 agreement accepts oke or setuju',()=>{
  for(const x of ['oke','OKE bosku','setuju','saya setuju','siap']) assert.equal(isFreebetAgreement(x),true,x);
  assert.equal(isFreebetAgreement('oke tapi bonus saya belum masuk'),false);
});

test('v1.24.6 exact FreeBet result replies are present',()=>{
  assert.equal(FREEBET_DONE_REPLY,'Untuk bonusnya sudah kita masukan ke dalam Akun User IDnya ya bosku. Terima kasih dan selamat bermain bosku 😊');
  assert.match(FREEBET_NOT_ELIGIBLE_REPLY,/beberapa ID/);
  assert.match(FREEBET_NOT_ELIGIBLE_REPLY,/VPN\/SSH\/PROXY\/TUNNELING/);
});

test('v1.24.6 FreeBet agreement is processed before generic acknowledgement shortcut',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const freebet=src.indexOf('const freebetWorkflowResult=await maybeHandleFreebetWorkflow');
  const ack=src.indexOf('if(isAcknowledgementText(text))');
  assert.ok(freebet>0 && ack>freebet);
  assert.match(src,/type:'FREEBET_CLAIM',state:'WAITING_AGREEMENT'/);
  assert.match(src,/FREEBET 50% - MEMBER SUDAH SETUJU/);
  assert.match(src,/BONUS_FREEBET_DONE/);
  assert.match(src,/BONUS_FREEBET_NOT_ELIGIBLE/);
});

test('v1.24.6 Telegram FreeBet ticket has DONE and TIDAK BISA CLAIM only',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(src,/BONUS_FREEBET_DONE/);
  assert.match(src,/BONUS_FREEBET_NOT_ELIGIBLE/);
  assert.match(src,/TIDAK BISA CLAIM/);
});
