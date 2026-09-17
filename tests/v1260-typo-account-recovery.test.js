
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, detectIntent } from '../src/normalizer.js';
import { inferResetAccountData, resetMissing } from '../src/reset-logic.js';
import fs from 'node:fs';

test('lpa id lpa sandi is understood as account recovery/reset password',()=>{
  assert.equal(normalizeText('lpa id lpa sandi'),'lupa id lupa password');
  assert.equal(detectIntent('lpa id lpa sandi'),'FORGOT_PASSWORD');
  assert.equal(detectIntent('lpa id lpa psw'),'FORGOT_PASSWORD');
});

test('reset parser understands DANA number and compact atasnama',()=>{
  const rows=[
    {sender_type:'customer',text:'lpa id lpa sandi'},
    {sender_type:'customer',text:'Dana 085719171522'},
    {sender_type:'customer',text:'Atasnama ahmadsonhaji'}
  ];
  const data=inferResetAccountData(rows,{});
  assert.equal(data.type,'dana');
  assert.equal(data.no,'085719171522');
  assert.equal(data.name.toLowerCase(),'ahmadsonhaji');
  assert.deepEqual(resetMissing(data),[]);
});

test('engine tells staff when member forgot both ID and password',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/LUPA ID \+ RESET PASSWORD/);
  assert.match(src,/Mohon cari akun dari data rekening\/e-wallet terdaftar/);
});
