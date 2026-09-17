import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inferResetAccountData, resetMissing, resetAskFor, isDepositConfirmedText } from '../src/reset-logic.js';

function row(text){ return {sender_type:'customer',text,attachments:[]}; }

test('reset password merges split member account data across turns',()=>{
  let data={};
  data=inferResetAccountData([row('Lupa password'),row('Aris budiyono')],data);
  assert.equal(data.name,'Aris budiyono');
  assert.deepEqual(resetMissing(data),['no']);
  data=inferResetAccountData([row('Dana')],data);
  assert.equal(data.type,'dana');
  assert.deepEqual(resetMissing(data),['no']);
  data=inferResetAccountData([row('081225986800')],data);
  assert.equal(data.no,'081225986800');
  assert.deepEqual(resetMissing(data),[]);
});

test('reset password accepts all account fields in one member message',()=>{
  const data=inferResetAccountData([row('DANA 081225986800 atas nama Aris Budiyono')],{});
  assert.equal(data.type,'dana');
  assert.equal(data.no,'081225986800');
  assert.match(data.name,/Aris Budiyono/i);
  assert.deepEqual(resetMissing(data),[]);
});

test('reset asks one missing field at a time',()=>{
  assert.match(resetAskFor('name'),/nama rekening/i);
  assert.match(resetAskFor('no',['no','name']),/REKENING \/ E-Wallet beserta atas nama/i);
  assert.match(resetAskFor('no'),/nomor rekening/i);
});

test('deposit confirmation phrase detection',()=>{
  assert.equal(isDepositConfirmedText('saya sudah depo bos'),true);
  assert.equal(isDepositConfirmedText('udah deposit'),true);
  assert.equal(isDepositConfirmedText('belum deposit'),false);
});

test('reset human bridge has all required actions',()=>{
  const hb=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  const eng=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  for(const a of ['RESET_DEPOSIT_FIRST','RESET_NOT_REGISTERED','RESET_DEPOSIT_NOT_IN']){
    assert.match(hb,new RegExp(a));
    assert.match(eng,new RegExp(a));
    assert.match(ui,new RegExp(a));
  }
});
