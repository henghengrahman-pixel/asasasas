import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const hb=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');

test('CS learning ON CONFLICT matches partial unique index',()=>{
  assert.match(db,/ON CONFLICT \(chat_id,source_event_id\) WHERE source_event_id IS NOT NULL DO NOTHING RETURNING \*/);
});

test('Telegram fast polling is isolated from maintenance backlog',()=>{
  const fast=Math.max(hb.indexOf("const updates=await tg.getUpdates({offset,timeout:3})"),hb.indexOf("const updates=await tg.getUpdates({offset,timeout:8})"));
  const slow=hb.indexOf("const opens=await db.listHumanRequests('OPEN',200)", fast);
  assert.ok(fast>=0,'fast polling loop missing');
  assert.ok(slow>fast,'maintenance loop missing after fast polling loop');
  assert.match(hb,/maintenanceRunning=true/);
});

test('CS learning backfill is delayed and batched so bridge starts responsive',()=>{
  assert.match(server,/createLearningWorker/);
  assert.match(server,/initialDelayMs:15000/);
  assert.match(server,/learningWorker\.start\(\)/);
});


test('Telegram callback is ACKed before Postgres update claim',()=>{
  const ack=hb.indexOf('ULTRA-FAST CALLBACK ACK');
  const claim=hb.indexOf('await handleUpdatesConcurrent(updates,livechat,8)',ack);
  assert.ok(ack>=0,'ultra-fast callback ACK missing');
  assert.ok(claim>ack,'callback ACK must happen before DB-backed update processing');
  assert.match(hb,/u\._fastCallbackAcked=true/);
});
