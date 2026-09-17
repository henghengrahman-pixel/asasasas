
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, detectIntent } from '../src/normalizer.js';

test('reset depo/dp means cancel deposit, not reset password',()=>{
  assert.equal(normalizeText('tolong reset depo nya kak'),'tolong reset deposit nya kak');
  assert.equal(detectIntent('tolong reset depo nya kak'),'DEPOSIT_CANCEL');
  assert.equal(detectIntent('reset dp bos'),'DEPOSIT_CANCEL');
  assert.equal(detectIntent('reset deposit saya'),'DEPOSIT_CANCEL');
});

test('cancel/batalkan/hapus/reject deposit all route to DEPOSIT_CANCEL',()=>{
  for(const text of [
    'cancel depo bos',
    'batalkan deposit saya',
    'batal dp nya',
    'reject deposit bosku',
    'hapus form deposit',
    'hapus depo saya'
  ]){
    assert.equal(detectIntent(text),'DEPOSIT_CANCEL',text);
  }
});

test('reset password remains FORGOT_PASSWORD and does not become deposit cancel',()=>{
  assert.equal(detectIntent('tolong reset password saya'),'FORGOT_PASSWORD');
  assert.equal(detectIntent('lupa password bos'),'FORGOT_PASSWORD');
});

test('plain deposit complaint remains DEPOSIT_PROBLEM',()=>{
  assert.equal(detectIntent('deposit saya belum masuk'),'DEPOSIT_PROBLEM');
});
