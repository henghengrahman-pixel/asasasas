import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('welcome banner has priority over customer classification in poller',()=>{
  const src=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  assert.match(src,/if \(isWelcomeTriggerEvent\(latest\)\)/);
  assert.match(src,/if \(isWelcomeTriggerEvent\(ev\)\)/);
});

test('customer processor hard-routes welcome banner to greeting trigger',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('export async function processCustomerMessage');
  const block=src.slice(start,start+2200);
  assert.match(block,/if\(isGreetingTriggerMessage\(text\)\)/);
  assert.match(block,/senderType:'system'/);
  assert.match(block,/return processGreetingTrigger/);
});

test('authoritative OMTOGEL banner cannot be blocked by stale greeting_enabled setting',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('export async function processGreetingTrigger');
  const end=src.indexOf('function isAuthoritativeWelcomeBanner',start);
  const block=src.slice(start,end);
  assert.match(block,/if\(!greetingEnabled && !exactWelcomeBanner\)/);
  assert.match(block,/greetingText\(new Date\(\),config\.timezone\)/);
});

test('system banner never reaches OpenAI generic reply path',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('export async function processCustomerMessage');
  const guard=src.indexOf('if(isGreetingTriggerMessage(text))',start);
  const ai=src.indexOf('ai.classifyAndReply',start);
  assert.ok(guard>start && guard<ai);
});
