
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';
import { pickBonusLabel } from '../src/bonus-label.js';
import { NEW_MEMBER_TERMS, RONDA_TERMS, isNewMemberBonus, isRondaBonus } from '../src/special-bonus.js';

test('cancel/reject deposit is a dedicated intent',()=>{
  assert.equal(detectIntent('tolong batalkan deposit saya'),'DEPOSIT_CANCEL');
  assert.equal(detectIntent('reject deposit bos'),'DEPOSIT_CANCEL');
  assert.equal(detectIntent('minta batalkan fom deposit'),'DEPOSIT_CANCEL');
});

test('new member and ronda are distinct bonus campaigns',()=>{
  assert.equal(pickBonusLabel('bonus new member'),'BONUS NEW MEMBER');
  assert.equal(pickBonusLabel('bonus ronda'),'BONUS RONDA');
  assert.equal(isNewMemberBonus('BONUS NEW MEMBER',''),true);
  assert.equal(isRondaBonus('BONUS RONDA',''),true);
  assert.match(NEW_MEMBER_TERMS,/Minimal Deposit.*Rp50\.000/s);
  assert.match(NEW_MEMBER_TERMS,/3x Turnover/);
  assert.match(RONDA_TERMS,/00\.00 - 06\.00/);
  assert.match(RONDA_TERMS,/TO 8/);
});

test('new member/ronda info and claims route as bonus',()=>{
  assert.equal(detectIntent('syarat bonus new member'),'BONUS_INFO');
  assert.equal(detectIntent('mau claim bonus new member'),'BONUS_REQUEST');
  assert.equal(detectIntent('syarat bonus ronda'),'BONUS_INFO');
  assert.equal(detectIntent('mau claim ronda'),'BONUS_REQUEST');
});

test('Telegram keyboards expose the requested actions',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  for(const marker of [
    'DP_CANCEL_DONE',
    'BONUS_NEW_MEMBER_DONE','BONUS_NEW_MEMBER_PLAYED',
    'BONUS_RONDA_DONE','BONUS_RONDA_PLAYED','BONUS_RONDA_SAME_IP'
  ]) assert.match(src,new RegExp(marker));
  assert.match(src,/SALDO SUDAH DIMAINKAN/);
  assert.match(src,/SAMA IP/);
});

test('engine sends rules before special bonus claim and supports all staff outcomes',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/NEW_MEMBER_TERMS/);
  assert.match(src,/RONDA_TERMS/);
  assert.match(src,/Rules \$\{canonical\} sudah diinformasikan ke member/);
  assert.match(src,/DP_CANCEL_DONE/);
  assert.match(src,/BONUS_NEW_MEMBER_PLAYED/);
  assert.match(src,/BONUS_RONDA_SAME_IP/);
});
