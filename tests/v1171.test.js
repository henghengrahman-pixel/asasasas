import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');

test('v1.17.1 reset deposit continuation can resolve exact prior Telegram ticket',()=>{
  assert.match(db,/findBridgeTicketByTelegram\(chatId,messageId\)/);
  assert.match(bridge,/_resetContinuation:true/);
  assert.match(bridge,/ACTION:RESET_DEPOSIT_FIRST/);
  assert.match(bridge,/replyId/);
});

test('v1.17.1 continuation prefers OPEN reset request from the same LiveChat chat',()=>{
  assert.match(bridge,/getOpenHumanRequest\(ticket\.chat_id\)/);
  assert.match(bridge,/FORGOT_PASSWORD/);
  assert.match(bridge,/closeBridgeTicketByRequest\(request\.id,'ANSWERED'\)/);
});

test('v1.17.1 reset credentials remain reply-to-ticket only',()=>{
  assert.match(bridge,/Reset credentials are sensitive/);
  assert.match(bridge,/if\(likelyReset\) return null/);
  assert.match(engine,/(?:user\\s\*id\|userid\|username)/);
  assert.match(engine,/link(?:\\s\*login)?/);
});
