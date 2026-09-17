import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';

test('v1.16 bonus info is not treated as a claim',()=>{
  assert.equal(detectIntent('bonus mingguan apa aja bos?'),'BONUS_INFO');
  assert.equal(detectIntent('bonus senin berapa?'),'BONUS_INFO');
  assert.equal(detectIntent('jadwal bonus rollingan kapan'),'BONUS_INFO');
});

test('v1.16 actual bonus claims route as claim intents',()=>{
  assert.equal(detectIntent('mau claim bonus cashback bos'),'BONUS_REQUEST');
  assert.equal(detectIntent('bonus saya belum masuk'),'BONUS_REQUEST');
  assert.equal(detectIntent('claim bonus harian'),'BONUS_DAILY');
});

test('v1.16 official weekly promo knowledge is seeded',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(db,/#BONUS_MINGGUAN/);
  assert.match(db,/Cashback Live Games & Slot 5% up to 10%/);
  assert.match(db,/Event Lomba Turnover Live Games & Slot/);
  assert.match(db,/Rollingan Slot & Live Games 1%/);
  assert.match(db,/grup Bonus Telegram/);
});

test('v1.16 engine has deterministic info path and Telegram claim flow remains',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(engine,/effective==='BONUS_INFO'/);
  assert.match(engine,/#BONUS_MINGGUAN/);
  assert.match(engine,/makeHumanRequest\(\{chatId,eventId,intent:'BONUS_REQUEST'/);
  assert.match(engine,/telegram:true/);
});
