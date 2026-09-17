
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('OMTOGEL system promo is recognized as authoritative welcome banner',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/function isAuthoritativeWelcomeBanner/);
  assert.match(src,/lebih mudah menghubungi kami via telegram & whatsapp/);
  assert.match(src,/layanancsomtogel\.live/);
  assert.match(src,/livebolautama\.ink/);
});

test('fresh authoritative banner bypasses stale active-case no-thread suppression',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('export async function processGreetingTrigger');
  const end=src.indexOf('function isAuthoritativeWelcomeBanner',start);
  const block=src.slice(start,end);
  assert.match(block,/freshAuthoritativeBanner/);
  assert.match(block,/!freshAuthoritativeBanner && !rawThreadKey/);
  assert.match(block,/fresh_authoritative_omtogel_system_banner/);
});

test('authoritative banner resets session only after validation and greets once',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('export async function processGreetingTrigger');
  const end=src.indexOf('function isAuthoritativeWelcomeBanner',start);
  const block=src.slice(start,end);
  assert.ok(block.indexOf('freshAuthoritativeBanner') < block.indexOf('beginNewConversationSession'));
  assert.match(block,/claimGreetingForThread/);
  assert.match(block,/greetingText\(new Date\(\),config\.timezone\)/);
});

test('old delayed banners remain suppressible',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/conversation_already_started_after_trigger/);
  assert.match(src,/active_case_duplicate_banner_without_thread/);
});
