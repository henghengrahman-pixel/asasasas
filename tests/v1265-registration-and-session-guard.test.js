
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';
import { parseRegistrationText, registrationMissing, registrationTicket, REGISTER_FORM } from '../src/registration.js';

test('mau daftar routes to REGISTER_REQUEST',()=>{
  assert.equal(detectIntent('mau daftar bos'),'REGISTER_REQUEST');
  assert.equal(detectIntent('tolong bantu daftar'),'REGISTER_REQUEST');
});

test('registration parser accepts email and phone as optional',()=>{
  const data=parseRegistrationText(`Username : budi123
Bank/E-wallet : DANA
Atas Nama Rekening : Budi Santoso
Nomor Rekening : 081234567890`,{});
  assert.equal(data.username,'budi123');
  assert.equal(data.bank,'DANA');
  assert.equal(data.name,'Budi Santoso');
  assert.equal(data.no,'081234567890');
  assert.deepEqual(registrationMissing(data),[]);
});

test('registration form contains all requested fields',()=>{
  for(const label of ['Username','Email','Nomor Telepon','Bank/E-wallet','Atas Nama Rekening','Nomor Rekening']){
    assert.match(REGISTER_FORM,new RegExp(label.replace('/','\\/'),'i'));
  }
});

test('registration ticket asks CS to register and reply with credentials',()=>{
  const data={username:'budi123',bank:'DANA',name:'Budi Santoso',no:'081234567890'};
  const q=registrationTicket(data);
  assert.match(q,/Mohon CS daftarkan akun member ini/);
  assert.match(q,/UserID : contoh123/);
  assert.match(q,/Password : qq123123/);
  assert.match(q,/Link Login : https:\/\/omtogeltxt\.com\/clearcache/);
});

test('engine auto-forwards registration credentials like reset password',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/intent==='REGISTER_REQUEST'/);
  assert.match(src,/HUMAN_REGISTER_CREDENTIALS/);
  assert.match(src,/REGISTER_REPLY_INCOMPLETE/);
  assert.match(src,/resetCredentialMemberReply\(credentials\)/);
});

test('stale Telegram tickets are blocked after a new LiveChat session starts',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(engine,/STALE_SESSION_REQUEST/);
  assert.match(engine,/isHumanRequestInCurrentSession/);
  assert.match(db,/h\.created_at >= c\.greeting_sent_at/);
});
