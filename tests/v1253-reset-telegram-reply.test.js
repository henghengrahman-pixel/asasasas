import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');

test('reset parser stops one-line fields at next label',()=>{
  assert.match(engine,/\(\.\+\?\)\(\?=\\s\+\(\?:password\|psw\|pass\|link/);
  assert.match(engine,/labelledLink=.*link/);
});

test('exact Telegram reset reply can recover ticket/request state drift safely',()=>{
  assert.match(bridge,/prior && prior\.category==='RESET_PASSWORD'/);
  assert.match(bridge,/priorRequest\?\.status==='OPEN'/);
  assert.match(bridge,/Telegram message_id -> ticket -> LiveChat chat_id/);
});

test('typed reset ticket code family is recognized while credential replies still require exact reply',()=>{
  assert.match(bridge,/\(\?:RST\|WD\|DP\|BON\|CUS\)/);
  assert.match(bridge,/likelyReset=.*password/);
});
