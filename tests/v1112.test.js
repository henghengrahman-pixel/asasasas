import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, detectIntent } from '../src/normalizer.js';
import { bridgeCategory } from '../src/bridge-category.js';

test('bonus typo is normalized and routed as bonus',()=>{
  assert.equal(normalizeText('bnus harian'), 'bonus harian');
  assert.equal(detectIntent('bnus harian'), 'BONUS_DAILY');
  assert.equal(bridgeCategory(detectIntent('bonuz new member')), 'BONUS');
});

test('forgot password wins over generic login problem',()=>{
  assert.equal(detectIntent('ga bisa masuk lupa psw'), 'FORGOT_PASSWORD');
  assert.equal(bridgeCategory(detectIntent('ga bisa masuk lupa psw')), 'RESET_PASSWORD');
});

test('operational issue aliases route to issue group',()=>{
  for (const text of ['link ga bisa di akses','game eror keluar sendiri','server gangguan','ga bisa login']) {
    assert.equal(bridgeCategory(detectIntent(text)), 'ISSUE', text);
  }
});

test('WD/account redirect are separated correctly',()=>{
  assert.equal(detectIntent('wd blm diproses'), 'WITHDRAW_PROBLEM');
  assert.equal(bridgeCategory(detectIntent('wd blm diproses')), 'WD_PROBLEM');
  assert.equal(detectIntent('wd alihkan ke rekening lain'), 'ACCOUNT_CHANGE_REQUEST');
  assert.equal(bridgeCategory(detectIntent('wd alihkan ke rekening lain')), 'WD_PROBLEM');
});

test('deposit/WD terse messages are treated as high-risk staff categories',()=>{
  assert.equal(detectIntent('deposit'), 'DEPOSIT_PROBLEM');
  assert.equal(bridgeCategory(detectIntent('deposit')), 'DEPOSIT_PROBLEM');
  assert.equal(detectIntent('wd'), 'WITHDRAW_PROBLEM');
  assert.equal(bridgeCategory(detectIntent('wd')), 'WD_PROBLEM');
});
