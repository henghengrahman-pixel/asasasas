
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBonusLabel, formatBonusClaimQuestion } from '../src/bonus-label.js';

test('generic bonus deposit means daily Rp5.000 bonus',()=>{
  assert.equal(pickBonusLabel('claim bonus deposit id partoredjo'),'BONUS HARIAN Rp5.000');
  assert.equal(pickBonusLabel('bonus depo partoredjo'),'BONUS HARIAN Rp5.000');
  assert.equal(pickBonusLabel('klaim bonus 5000'),'BONUS HARIAN Rp5.000');
  assert.equal(formatBonusClaimQuestion('partoredjo','BONUS HARIAN Rp5.000'),'ID : partoredjo\n\nclaim bonus harian rp5.000');
});

test('explicit named campaigns override generic deposit wording',()=>{
  assert.equal(pickBonusLabel('claim bonus bulanan deposit slot livegame'),'BONUS BULANAN');
  assert.equal(pickBonusLabel('claim freebet 50% setelah deposit'),'BONUS FREEBET');
  assert.equal(pickBonusLabel('claim bonus harian deposit'),'BONUS HARIAN');
});
