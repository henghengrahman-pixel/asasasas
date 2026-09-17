import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';
import { bridgeCategory } from '../src/bridge-category.js';

test('bonus umum ditanya jenis bonus dulu',()=>{
  assert.equal(detectIntent('mau claim bonus'),'BONUS_REQUEST');
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/BONUS_CLAIM/);
  assert.match(s,/#BONUS_TANYA/);
  assert.match(s,/Bonus apa yang mau diklaim/);
});

test('komplain kasar dan kalah punya intent khusus dan jawaban tenang',()=>{
  assert.equal(detectIntent('kontol web rusak'),'ABUSIVE');
  assert.equal(detectIntent('rungkad terus bos'),'LOSS_COMPLAINT');
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/#KOMPLAIN_MAKI/);
  assert.match(s,/#KOMPLAIN_MAKI_ULANG/);
  assert.match(s,/#KOMPLAIN_KALAH/);
  assert.doesNotMatch(s,/yakin anda bisa meraih kemenangan besar/i);
});

test('unknown tidak dibalas asal, diarahkan ke Tanya Staff, dan member tetap mendapat holding reply',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/safe_wait_staff/);
  assert.match(s,/WAITING_HUMAN_ACK/);
  assert.match(s,/sent:true,reply,waitingHuman:true/);
  assert.match(s,/isTelegramBridgeCategory\(intent\)/);
});

test('telegram group reset WD deposit bonus dan gangguan',()=>{
  assert.equal(bridgeCategory('DEPOSIT_PROBLEM'),'DEPOSIT_PROBLEM');
  assert.equal(bridgeCategory('GENERAL'),'PANEL_ONLY');
  assert.equal(bridgeCategory('LOGIN_PROBLEM'),'ISSUE');
  assert.equal(bridgeCategory('LINK_PROBLEM'),'ISSUE');
  assert.equal(bridgeCategory('GAME_PROBLEM'),'ISSUE');
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/Reset Password/);
  assert.match(html,/WD Problem/);
  assert.match(html,/Bonus/);
  assert.match(html,/Gangguan \/ Login \/ Link \/ Game/);
  assert.match(html,/Deposit Problem/);
});

test('AI prompt melarang janji kemenangan dan tebakan',()=>{
  const s=fs.readFileSync(new URL('../src/ai.js',import.meta.url),'utf8');
  assert.match(s,/jangan menjanjikan kemenangan/i);
  assert.match(s,/ASK_HUMAN dengan reply kosong/);
});
