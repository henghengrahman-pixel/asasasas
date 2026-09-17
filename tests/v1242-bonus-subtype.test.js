import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickBonusLabel, formatBonusClaimQuestion } from '../src/bonus-label.js';

test('explicit bonus harian is preserved exactly',()=>{
  assert.equal(pickBonusLabel('Id gasakk clim bonus harian ya bos'),'BONUS HARIAN');
  assert.equal(pickBonusLabel('claim bonus harian slotgames 5%'),'BONUS HARIAN SLOT');
  assert.equal(pickBonusLabel('claim bonus harian slot & live games 5%'),'BONUS HARIAN SLOT & LIVE GAMES');
});

test('bonus bulanan and mingguan remain distinct from harian',()=>{
  assert.equal(pickBonusLabel('claim bonus bulanan'),'BONUS BULANAN');
  assert.equal(pickBonusLabel('claim bonus mingguan'),'BONUS MINGGUAN');
});

test('telegram claim wording does not duplicate bonus word',()=>{
  assert.equal(formatBonusClaimQuestion('GASAKK','BONUS HARIAN'),'ID : GASAKK\n\nclaim bonus harian');
  assert.equal(formatBonusClaimQuestion('GASAKK','CASHBACK'),'ID : GASAKK\n\nclaim bonus cashback');
});

test('engine resolves explicit subtype before semantic promo retrieval',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const direct=src.indexOf('const direct=pickBonusLabel(text)');
  const important=src.indexOf('getRelevantImportantInfo(n,30)');
  assert.ok(direct>=0 && important>direct);
  assert.match(src,/question:formatBonusClaimQuestion\(uid,bonusType\)/);
});
