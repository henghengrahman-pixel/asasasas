import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';
import { bridgeCategory, isTelegramBridgeCategory } from '../src/bridge-category.js';

test('v1.23 operational intent coverage',()=>{
  assert.equal(detectIntent('kemenangan saya blm dibayar bos'),'PAYOUT_NOT_RECEIVED');
  assert.equal(detectIntent('rekening dana saya limid'),'BANK_ACCOUNT_LIMIT');
  assert.equal(detectIntent('daftar gagal terus error'),'REGISTER_PROBLEM');
  assert.equal(detectIntent('mau daftar bos linknya'),'REGISTER_REQUEST');
  assert.equal(detectIntent('ga bisa akses bos'),'LINK_PROBLEM');
  assert.equal(detectIntent('game macet keluar sendiri'),'GAME_PROBLEM');
  assert.equal(detectIntent('rungkad terus bos'),'LOSS_COMPLAINT');
});

test('v1.23 new operational cases are Telegram bridge categories',()=>{
  assert.equal(bridgeCategory('PAYOUT_NOT_RECEIVED'),'ISSUE');
  assert.equal(bridgeCategory('BANK_ACCOUNT_LIMIT'),'WD_PROBLEM');
  assert.equal(bridgeCategory('REGISTER_PROBLEM'),'ISSUE');
  assert.equal(bridgeCategory('GAME_PROBLEM'),'ISSUE');
  assert.equal(bridgeCategory('LOSS_COMPLAINT'),'ISSUE');
  for(const intent of ['PAYOUT_NOT_RECEIVED','BANK_ACCOUNT_LIMIT','REGISTER_PROBLEM','GAME_PROBLEM','LOSS_COMPLAINT']){
    assert.equal(isTelegramBridgeCategory(intent),true,intent);
  }
});

test('v1.23 sensitive workflows require confirmed Telegram delivery; loss complaints notify without blocking',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  for(const marker of ['PAYOUT_CHECK','ACCOUNT_CHANGE','ACCOUNT_LIMIT','GAME_CHECK','ACCESS_CHECK','REGISTER_CHECK','LOSS_REVIEW']) assert.ok(s.includes(marker),marker);
  assert.match(s,/PAYOUT_NOT_RECEIVED[\s\S]{0,1400}requireTelegramDelivery:true/);
  assert.match(s,/ACCOUNT_CHANGE_REQUEST[\s\S]{0,1800}requireTelegramDelivery:true/);
  assert.match(s,/BANK_ACCOUNT_LIMIT[\s\S]{0,1600}requireTelegramDelivery:true/);
  const loss=s.slice(s.indexOf("if(effective==='LOSS_COMPLAINT')"),s.indexOf("// Member kasar/emosi"));
  assert.match(loss,/notifyTelegramEvent/);
  assert.doesNotMatch(loss,/requireTelegramDelivery:true/);
});

test('v1.23 link and registration workflows still bridge to Telegram',()=>{
  const e=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const h=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(e,/notifyTelegramEvent/);
  assert.match(e,/LINK AKSES/);
  assert.match(e,/registrationTicket\(data\)/);
  assert.match(e,/REGISTER_WAITING_REPLY/);
  assert.match(h,/export async function notifyTelegramEvent/);
  assert.match(h,/TELEGRAM_NOTIFY_FAILED/);
});

test('v1.23 Telegram tickets show correlation code and category',()=>{
  const h=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(h,/ticket\.ticket_code/);
  assert.match(h,/Kategori: \$\{ticket\.category\}/);
});
