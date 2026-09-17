
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DP_DANA_NOT_IN_REPLY } from '../src/deposit-actions.js';

test('deposit keyboard includes DANA TIDAK MASUK action',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(src,/text:'DANA TIDAK MASUK'.*DP_DANA_NOT_IN/);
});

test('DANA TIDAK MASUK sends polite mutation-check guidance',()=>{
  assert.match(DP_DANA_NOT_IN_REPLY,/dana deposit bosku belum terlihat masuk ke rekening kami/i);
  assert.match(DP_DANA_NOT_IN_REPLY,/mutasi rekening atau riwayat transaksi/i);
  assert.match(DP_DANA_NOT_IN_REPLY,/bukti mutasi\/riwayat transaksi terbaru/i);
});

test('DANA TIDAK MASUK keeps case open waiting for mutation proof',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/DP_DANA_NOT_IN/);
  assert.match(src,/DEPOSIT_FUNDS_NOT_RECEIVED/);
  assert.match(src,/WAITING_MEMBER_MUTATION_PROOF/);
});
