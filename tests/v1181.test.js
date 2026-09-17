import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');

test('telegram callback is acknowledged before slow action handler',()=>{
  const ack=bridge.indexOf("answerCallbackQuery(q.id,'Sedang diproses…')");
  const action=bridge.indexOf('await actionHandler({request,action:m[2],livechat})');
  assert.ok(ack>0 && action>ack);
});

test('bridge callback ticket is atomically claimed',()=>{
  assert.match(bridge,/claimBridgeTicketAction\(m\[1\],m\[2\]\)/);
  assert.match(db,/status='PROCESSING'.*status='OPEN'/s);
});

test('failed callback reopens ticket',()=>{
  assert.match(bridge,/reopenBridgeTicket\(ticket\.id,e\.message\)/);
});

test('telegram updates are handled concurrently with bounded workers',()=>{
  assert.match(bridge,/handleUpdatesConcurrent\(updates,livechat,8\)/);
  assert.match(bridge,/Promise\.all\(/);
});

test('stale processing ticket recovery is present',()=>{
  assert.match(db,/recoverStaleBridgeProcessing/);
  assert.match(bridge,/recoverStaleBridgeProcessing\(120\)/);
});
