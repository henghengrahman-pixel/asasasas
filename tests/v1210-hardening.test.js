import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config=fs.readFileSync(new URL('../src/config.js',import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const hb=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');

test('v1.21.0 Telegram bridge supports Railway ENV bootstrap per category',()=>{
  for(const key of ['TELEGRAM_BOT_TOKEN','TELEGRAM_DEFAULT_CHAT_ID','TELEGRAM_RESET_CHAT_ID','TELEGRAM_WD_CHAT_ID','TELEGRAM_DEPOSIT_CHAT_ID','TELEGRAM_BONUS_CHAT_ID','TELEGRAM_ISSUE_CHAT_ID']){
    assert.match(config,new RegExp(key));
  }
  assert.match(server,/syncTelegramFromEnv/);
  assert.match(server,/deleteWebhook/);
});

test('v1.21.0 Telegram updates have persistent cross-process deduplication',()=>{
  assert.match(db,/CREATE TABLE IF NOT EXISTS telegram_processed_updates/);
  assert.match(db,/export async function claimTelegramUpdate/);
  assert.match(db,/export async function finishTelegramUpdate/);
  assert.match(hb,/claimTelegramUpdate\(updateId\)/);
  assert.match(hb,/finishTelegramUpdate\(updateId\)/);
});

test('v1.21.0 critical chat safety layers remain enabled',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(engine,/withChatLock/);
  assert.match(engine,/human_takeover_after_ai/);
  assert.match(engine,/requireTelegramDelivery:true/);
  assert.match(engine,/WAITING_HUMAN/);
});
