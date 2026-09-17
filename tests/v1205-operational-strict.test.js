import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetMissing, resetAskFor, inferResetAccountData } from '../src/reset-logic.js';

test('v1.20.5 reset only requires account/wallet number plus holder name',()=>{
  assert.deepEqual(resetMissing({type:'gopay',no:'085377268144',name:''}),['name']);
  assert.deepEqual(resetMissing({type:'',no:'085377268144',name:'Elva'}),[]);
  assert.match(resetAskFor('no',['no','name']),/nomor REKENING \/ E-Wallet beserta atas nama rekeningnya/i);
});

test('v1.20.5 reset merges gopay + phone number across customer turns',()=>{
  const rows=[
    {sender_type:'customer',text:'Bantu saya lupa sandi bosku'},
    {sender_type:'customer',text:'Rekening gopay'},
    {sender_type:'customer',text:'085377268144'},
    {sender_type:'customer',text:'atas nama Elva'}
  ];
  const d=inferResetAccountData(rows,{});
  assert.equal(d.type,'gopay');
  assert.equal(d.no,'085377268144');
  assert.equal(d.name,'Elva');
});

test('v1.20.5 reset, deposit and WD all require Telegram delivery before acknowledgement',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const reset=s.slice(s.indexOf("if(effective==='FORGOT_PASSWORD'"),s.indexOf('// Every WD problem'));
  const deposit=s.slice(s.indexOf('// Deposit complaint'),s.indexOf('// Reset password'));
  const wd=s.slice(s.indexOf('// Every WD problem'),s.indexOf('// Informational bonus questions'));
  assert.match(reset,/requireTelegramDelivery:true/);
  assert.match(deposit,/requireTelegramDelivery:true/);
  assert.match(wd,/requireTelegramDelivery:true/);
});

test('v1.20.5 operational flows persist WAITING_HUMAN state with collected data',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/type:'WD_CHECK',state:'WAITING_HUMAN'/);
  assert.match(s,/type:'DEPOSIT_VERIFY',state:'WAITING_HUMAN'/);
  assert.match(s,/type:'RESET_PASSWORD',state:'WAITING_HUMAN'/);
  assert.match(s,/type:'BONUS_CLAIM',state:'WAITING_HUMAN'/);
});

test('v1.20.5 waiting-human followups cannot restart ID collection',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/workflow_state==='WAITING_HUMAN'/);
  assert.match(s,/masih dalam pengecekan staff/);
});

test('v1.20.5 stale open human request is cancelled when operational intent changes',()=>{
  const s=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(s,/oldIntent===wantedIntent/);
  assert.match(s,/UPDATE human_requests SET status='CANCELLED'/);
  assert.match(s,/UPDATE human_bridge_tickets SET status='CANCELLED'/);
});
