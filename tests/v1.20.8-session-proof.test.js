import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const poller=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');

test('v1.20.8 noisy deposit complaint is deterministic before AI',()=>{
  assert.equal(detectIntent('Anjing kau ak dah DP0 tpi blm masuk2'),'DEPOSIT_PROBLEM');
  assert.equal(detectIntent('depo belum masuk'),'DEPOSIT_PROBLEM');
});

test('v1.20.8 bootstrap forwards thread id and image attachments into engine',()=>{
  assert.match(poller,/threadId:latest\.threadId/);
  assert.match(poller,/attachments:latest\.attachments\|\|\[\]/);
});

test('v1.20.8 normal poll path forwards thread id and attachments',()=>{
  assert.match(poller,/threadId:ev\.threadId/);
  assert.match(poller,/attachments:ev\.attachments\|\|\[\]/);
});

test('v1.20.8 greeting is evaluated before operational workflow returns',()=>{
  const greetingPos=engine.indexOf("const greetingEnabled=Boolean(await db.getSetting('greeting_enabled'");
  const resolvePos=engine.indexOf('intent=await resolveContextualIntent');
  const workflowPos=engine.indexOf('const workflowResult=await maybeHandleWorkflow');
  assert.ok(greetingPos>0 && resolvePos>greetingPos && workflowPos>resolvePos);
});

test('v1.20.8 greeting state exposes per-thread id',()=>{
  assert.match(db,/greeting_sent_at,c\.greeting_thread_id,c\.workflow_type/);
});

test('v1.20.8 attachment image keeps recent deposit context locked',()=>{
  assert.match(engine,/hasCurrentImage/);
  assert.match(engine,/depositWord && \(depositProblem \|\| hasCurrentImage \|\| hasRecentImage\)/);
  assert.match(engine,/latestProof\(ctx\)/);
});
