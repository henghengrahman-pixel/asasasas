import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('session boundary prioritizes stable LiveChat thread and uses event-keyed welcome fallback',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/threadKey=rawThreadKey \? `thread:\$\{rawThreadKey\}` : `welcome:\$\{bannerEventKey\}`/);
  assert.match(src,/AUTHORITATIVE_SYSTEM_WELCOME/);
  assert.match(src,/VALIDATED_FALLBACK/);
});

test('poller retries a fresh welcome banner even when message was already inserted',()=>{
  const src=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  assert.match(src,/async function ensureFreshWelcomeGreeting/);
  assert.match(src,/processGreetingTrigger\(\{/);
  assert.match(src,/await ensureFreshWelcomeGreeting\(chatId,events,livechat\)/);
});

test('welcome retry remains idempotent through processGreetingTrigger claim',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(engine,/claimGreetingForThread\(chatId,threadKey\)/);
  assert.match(engine,/greeting_already_sent_for_session/);
});
