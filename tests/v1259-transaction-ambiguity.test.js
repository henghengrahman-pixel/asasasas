
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';

test('saldo belum masuk without transaction type is ambiguous',()=>{
  assert.equal(detectIntent('Saldo belum masuk boss'),'TRANSACTION_AMBIGUOUS');
  assert.equal(detectIntent('uang belum masuk bosku'),'TRANSACTION_AMBIGUOUS');
});

test('explicit WD and DP still route deterministically',()=>{
  assert.equal(detectIntent('WD belum masuk boss'),'WITHDRAW_PROBLEM');
  assert.equal(detectIntent('deposit belum masuk boss'),'DEPOSIT_PROBLEM');
});

test('engine asks DP or WD instead of guessing deposit',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/TRANSACTION_CLARIFY/);
  assert.match(src,/Yang belum masuk deposit atau withdraw-nya ya bosku\?/);
  assert.match(src,/Boleh kirim ID akunnya ya bosku/);
  assert.match(src,/Boleh kirim user ID sama bukti transfernya ya bosku/);
});
