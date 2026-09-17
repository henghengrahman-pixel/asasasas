
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';
import { extractUserIdFromText } from '../src/user-id.js';

test('claim bonus harian with inline ID is classified and ID is extracted',()=>{
  const text='klaim bonus harian id hida948';
  assert.equal(detectIntent(text),'BONUS_DAILY');
  assert.equal(extractUserIdFromText(text),'hida948');
});

test('customer message after authoritative System banner is not greeted again',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/authoritativeBannerSession/);
  assert.match(src,/bindGreetingThreadWithoutGreeting/);
  assert.match(src,/MUST be processed for its real intent/);
});

test('specific bonus with inline ID routes to Telegram and waiting reply',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('// Specific bonus');
  const end=src.indexOf('// Kemenangan/payout',start);
  const block=src.slice(start,end);
  assert.match(block,/BONUS_INLINE_ID_READY/);
  assert.match(block,/makeHumanRequest/);
  assert.match(block,/telegram:true/);
  assert.match(block,/holding:WAITING_CHECK_REPLY/);
  assert.match(block,/requireTelegramDelivery:true/);
});

test('new-session banner keeps old case state isolated',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(db,/beginNewConversationSession/);
  assert.match(db,/workflow_type=NULL/);
  assert.match(db,/ai_waiting_human=false/);
  assert.match(db,/handling_mode='AI'/);
});
