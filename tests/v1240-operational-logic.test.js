import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent, normalizeText } from '../src/normalizer.js';
import { bridgeCategory, isTelegramBridgeCategory } from '../src/bridge-category.js';

test('v1.24 operational phrases map to the correct deterministic intent',()=>{
  const cases=new Map([
    ['dp blm masuk','DEPOSIT_PROBLEM'],
    ['proses wd ga masuk2','WITHDRAW_PROBLEM'],
    ['lupa psw ga bisa masuk','FORGOT_PASSWORD'],
    ['bonus harian belum masuk','BONUS_DAILY'],
    ['kalah terus bos','LOSS_COMPLAINT'],
    ['rungkad parah','LOSS_COMPLAINT'],
    ['minta link terbaru','LINK_ACCESS'],
    ['link ga bisa akses','LINK_PROBLEM'],
    ['web gangguan','GENERAL_DISTURBANCE'],
    ['kemenangan blm dibayar','PAYOUT_NOT_RECEIVED'],
    ['mau ganti rekening','ACCOUNT_CHANGE_REQUEST'],
    ['mau daftar','REGISTER_REQUEST'],
    ['daftar gagal','REGISTER_PROBLEM'],
    ['games macet','GAME_PROBLEM'],
    ['rek limid','BANK_ACCOUNT_LIMIT'],
    ['game macet saldo kepotong','GAME_PROBLEM'],
    ['dana limit','BANK_ACCOUNT_LIMIT']
  ]);
  for(const [text,want] of cases) assert.equal(detectIntent(text),want,`${text} -> ${normalizeText(text)}`);
});

test('v1.24 transaction anchors beat generic login/access words',()=>{
  assert.equal(detectIntent('wd ga masuk bos'),'WITHDRAW_PROBLEM');
  assert.equal(detectIntent('deposit ga masuk'),'DEPOSIT_PROBLEM');
  assert.equal(detectIntent('password lupa ga bisa masuk'),'FORGOT_PASSWORD');
  assert.equal(detectIntent('link ga bisa masuk'),'LINK_PROBLEM');
});

test('v1.24 operational escalations all have a Telegram bridge route',()=>{
  const intents=['DEPOSIT_PROBLEM','WITHDRAW_PROBLEM','FORGOT_PASSWORD','BONUS_REQUEST','BONUS_DAILY','PAYOUT_NOT_RECEIVED','ACCOUNT_CHANGE_REQUEST','BANK_ACCOUNT_LIMIT','REGISTER_PROBLEM','LINK_PROBLEM','LOGIN_PROBLEM','GAME_PROBLEM','GENERAL_DISTURBANCE','LOSS_COMPLAINT'];
  for(const intent of intents){
    assert.equal(isTelegramBridgeCategory(intent),true,intent);
    assert.notEqual(bridgeCategory(intent),'PANEL_ONLY',intent);
  }
});

test('v1.24 engine gates sensitive acknowledgement on confirmed Telegram delivery',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/requireTelegramDelivery:true/g);
  assert.match(src,/REQUIRED_TELEGRAM_DISPATCH_PENDING/);
  assert.match(src,/GAME_CHECK','WAITING_PROOF/);
  assert.match(src,/extractOperationalAmount/);
});
