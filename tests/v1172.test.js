import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v1.17.2 callback resolves ticket by id without 500-ticket scan limit',()=>{
  const hb=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(hb,/getBridgeTicketById\(m\[1\]\)/);
  assert.doesNotMatch(hb,/listBridgeTickets\(500\)\.find/);
  assert.match(db,/export async function getBridgeTicketById/);
});

test('v1.17.2 reset continuation supports deposit-first and deposit-not-in tickets',()=>{
  const hb=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(hb,/ACTION:RESET_DEPOSIT_FIRST/);
  assert.match(hb,/ACTION:RESET_DEPOSIT_NOT_IN/);
});

test('v1.17.2 reset credentials require full user password and login link triplet',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/if\(user && password && link\)/);
  assert.match(src,/if\(lines\.length>=3/);
  assert.match(src,/LINK LOGIN lengkap/);
});
