import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('poller primes System session before customer processing',()=>{
  const src=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  const sync=src.indexOf('const events=extractChatEvents(chat)');
  const prime=src.indexOf('await ensureFreshWelcomeGreeting(chatId,events,livechat)',sync);
  const process=src.indexOf('processCustomerMessage({chatId,eventId:ev.eventId',sync);
  assert.ok(prime>sync && prime<process,'welcome/session preflight must run before customer processing');
});

test('welcome preflight persists System boundary before greeting/session reset',()=>{
  const src=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  const start=src.indexOf('async function ensureFreshWelcomeGreeting');
  const end=src.indexOf('async function bootstrapChat',start);
  const block=src.slice(start,end);
  assert.ok(block.indexOf('db.insertMessage') < block.indexOf('processGreetingTrigger'));
  assert.match(block,/senderType:'system'/);
});

test('late banner cannot append greeting after operational reply',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/late_banner_outbound_already_exists/);
  assert.match(src,/late_banner_outbound_exists/);
});

test('member burst debounce is long enough to combine short fragments',()=>{
  const src=fs.readFileSync(new URL('../src/config.js',import.meta.url),'utf8');
  assert.match(src,/MEMBER_DEBOUNCE_MS, 2200/);
});

test('operational history is session-boundary scoped',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(engine,/return db\.getCurrentSessionContext\(chatId,10000\)/);
  assert.match(db,/intent='GREETING_TRIGGER'/);
});
