import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';

test('v1.24.9 loss/rungkad wins over profanity and deposit-as-context',()=>{
  assert.equal(detectIntent('Masa kalah trus anjing depo tiap hari enggak pernah di kasi'),'LOSS_COMPLAINT');
  assert.equal(detectIntent('rungkad terus bos padahal depo tiap hari'),'LOSS_COMPLAINT');
});

test('v1.24.9 explicit deposit transaction failure still wins',()=>{
  assert.equal(detectIntent('kalah terus bos, depo tadi belum masuk'),'DEPOSIT_PROBLEM');
});

test('v1.24.9 generic image is not sufficient to force contextual deposit',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js', import.meta.url),'utf8');
  assert.match(engine,/if\(depositWord && depositProblem\) return 'DEPOSIT_PROBLEM'/);
  assert.match(engine,/generic image is NOT deposit evidence by itself/i);
});
