
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, detectIntent } from '../src/normalizer.js';

test('lupa paspor in LC account context is treated as lupa password',()=>{
  assert.equal(normalizeText('lupa paspor bosku'),'lupa password bosku');
  assert.equal(detectIntent('lupa paspor bosku'),'FORGOT_PASSWORD');
  assert.equal(detectIntent('lpa paspor bos'),'FORGOT_PASSWORD');
});

test('standalone paspor is not globally rewritten',()=>{
  assert.match(normalizeText('paspor saya habis masa berlaku'),/paspor/);
});
