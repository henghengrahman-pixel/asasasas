import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, detectIntent } from '../src/normalizer.js';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');

test('v1.20.7 normalizes noisy DP shorthand with numeric suffixes',()=>{
  assert.equal(normalizeText('anjing DP0 blm msk2'),'anjing deposit belum masuk');
  assert.equal(detectIntent('DP0 blm msk2'),'DEPOSIT_PROBLEM');
  assert.equal(detectIntent('depoo blm masuk'),'DEPOSIT_PROBLEM');
});

test('v1.20.7 context resolver keeps receipt image inside deposit case',()=>{
  assert.match(engine,/resolveContextualIntent/);
  assert.match(engine,/wfType==='DEPOSIT_VERIFY'/);
  assert.match(engine,/depositWord[\s\S]*hasCurrentImage[\s\S]*DEPOSIT_PROBLEM/);
});

test('v1.20.7 operational routing runs before stale open human request',()=>{
  const op=engine.indexOf('const operationalResult=await maybeHandleOperationalFlow');
  const open=engine.indexOf('const openHuman=await db.getOpenHumanRequest',op);
  assert.ok(op>0 && open>op);
});
