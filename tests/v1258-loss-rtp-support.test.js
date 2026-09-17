
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';

test('loss complaints remain LOSS_COMPLAINT even with deposit context or profanity',()=>{
  assert.equal(detectIntent('tiap maen kalah terus tai'),'LOSS_COMPLAINT');
  assert.equal(detectIntent('sudah depo berkali kali tapi ga pernah menang'),'LOSS_COMPLAINT');
  assert.equal(detectIntent('situs tai ga dikasih skater'),'LOSS_COMPLAINT');
});

test('loss branch responds directly, offers RTP as reference, and does not open forced human wait',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const block=src.slice(src.indexOf("if(effective==='LOSS_COMPLAINT')"),src.indexOf("// Member kasar/emosi"));
  assert.match(block,/Jangan berkecil hati/);
  assert.match(block,/informasi RTP/);
  assert.match(block,/sendAndStore/);
  assert.match(block,/notifyTelegramEvent/);
  assert.doesNotMatch(block,/makeHumanRequest/);
  assert.doesNotMatch(block,/WAITING_HUMAN/);
});

test('RTP still comes from Menu Penting and no guaranteed win wording is introduced',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/RTP_INFO/);
  assert.match(src,/IMPORTANT_\$\{wanted\}/);
  assert.doesNotMatch(src,/pasti menang banyak/);
  assert.doesNotMatch(src,/pasti.*JP besar/);
});
