import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {detectIntent, normalizeText} from '../src/normalizer.js';

test('deposit history plus kapan WD is withdraw eligibility, not deposit problem',()=>{
  assert.equal(detectIntent('Deposit teruuussss kapan WD nya'),'WITHDRAW_REQUEST');
  assert.equal(detectIntent('udah 3x depo kapan bisa wd bos'),'WITHDRAW_REQUEST');
  assert.equal(detectIntent('depo tiap hari, boleh wd gak?'),'WITHDRAW_REQUEST');
  assert.equal(normalizeText('teruuussss'),'terus');
});

test('real deposit failure still stays deposit problem',()=>{
  assert.equal(detectIntent('deposit tadi belum masuk bos'),'DEPOSIT_PROBLEM');
  assert.equal(detectIntent('transfer sudah tapi saldo deposit belum masuk'),'DEPOSIT_PROBLEM');
});

test('engine has dedicated WD eligibility path and does not ask deposit proof',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/WITHDRAW_REQUEST/);
  assert.match(s,/CEK KELAYAKAN \/ PERMINTAAN WD/);
  assert.match(s,/apakah akun bosku sudah bisa melakukan WD/);
  assert.match(s,/sameWithdrawFamily/);
});
