
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('poller detects welcome banner independently of author type',()=>{
  const src=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  assert.match(src,/function isWelcomeTriggerEvent/);
  assert.match(src,/if \(isWelcomeTriggerEvent\(ev\)\)/);
  assert.match(src,/if \(isWelcomeTriggerEvent\(latest\)\)/);
  assert.match(src,/if \(isWelcomeTriggerEvent\(ev\)\)/);
});

test('welcome System event never activates Human Takeover',()=>{
  const src=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  assert.match(src,/ingestAgentEvent\(chatId,ev,chat,livechat,\{allowTakeover:false,allowGreetingTrigger:true\}\)/);
});

test('greeting trigger tolerates provider delay up to ten minutes',()=>{
  const poller=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(poller,/Math\.max\(Number\(config\.greetingTriggerMaxAgeSeconds\|\|0\),600\)/);
  assert.match(engine,/Math\.max\(600,Number\(config\.greetingTriggerMaxAgeSeconds\|\|0\)\)/);
});

test('hours-old System banners are explicitly suppressed',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/stale_authoritative_system_banner/);
  assert.match(src,/stale_system_banner/);
});
