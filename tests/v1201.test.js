import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardDecision } from '../src/guard.js';

test('bonus completion claim from AI is blocked before staff confirmation',()=>{
  const d=guardDecision({intent:'GENERAL',hasKnowledge:true,decision:{action:'AUTO_REPLY',confidence:0.99,reply:'Untuk bonusnya sudah kita masukan ke dalam Akun User IDnya ya bosku.'}});
  assert.equal(d.action,'HANDOFF');
  assert.equal(d.blocked,true);
  assert.equal(d.blockReason,'UNVERIFIED_TRANSACTION_CLAIM');
});

test('bonus request is high risk even when routed with explicit bonus claim intent',()=>{
  const d=guardDecision({intent:'BONUS_REQUEST',hasKnowledge:false,decision:{action:'AUTO_REPLY',confidence:0.99,reply:'Baik bosku, bonus akan kami cek.'}});
  assert.equal(d.action,'HANDOFF');
  assert.equal(d.blocked,true);
});

test('bonus claim workflow requires successful Telegram dispatch before holding reply',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const matches=engine.match(/claim bonus[\s\S]{0,220}requireTelegramDelivery:true/g)||[];
  assert.ok(matches.length>=2,`strict bonus dispatch paths=${matches.length}`);
  assert.match(engine,/REQUIRED_TELEGRAM_DISPATCH_PENDING/);
});

test('new LiveChat thread uses per-thread greeting claim',()=>{
  const poller=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(poller,/threadId:ev\.threadId/);
  assert.match(engine,/claimGreetingForThread/);
  assert.match(db,/greeting_thread_id/);
});
