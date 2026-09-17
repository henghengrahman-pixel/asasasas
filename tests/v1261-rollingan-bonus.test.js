
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, detectIntent } from '../src/normalizer.js';
import { pickBonusLabel } from '../src/bonus-label.js';

test('rollingan typos normalize to rollingan bonus',()=>{
  assert.equal(normalizeText('rolingan'),'rollingan');
  assert.equal(normalizeText('rolllingan'),'rollingan');
  assert.equal(normalizeText('rolling'),'rollingan');
  assert.equal(pickBonusLabel('rolingan'),'BONUS ROLLINGAN');
});

test('rollingan info stays bonus info',()=>{
  assert.equal(detectIntent('syarat rolingan'),'BONUS_INFO');
  assert.equal(detectIntent('kapan rollingan dibagi'),'BONUS_INFO');
});

test('missing rollingan routes to bonus request',()=>{
  assert.equal(detectIntent('babi gk ada rolingan'),'BONUS_REQUEST');
  assert.equal(detectIntent('rollingan belum masuk'),'BONUS_REQUEST');
  assert.equal(detectIntent('belum dapat rollingan'),'BONUS_REQUEST');
  assert.equal(pickBonusLabel('gk ada rolingan'),'BONUS ROLLINGAN');
});
