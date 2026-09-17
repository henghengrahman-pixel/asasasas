import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';

test('complaint intent catches loss/frustration without gambling encouragement',()=>{
  assert.equal(detectIntent('saya kalah terus dan kecewa'),'LOSS_COMPLAINT');
});

test('human request UI contains operational quick actions',()=>{
  const s=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  for(const k of ['RESET_DEPOSIT_FIRST','WD_QUEUE','WD_REQUEST_VALID_ACCOUNT','WD_DANA_LIMIT','BONUS_DONE','BONUS_DEPOSIT_FIRST']) assert.ok(s.includes(k),k);
});

test('human drafts survive live refresh',()=>{
  const s=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.ok(s.includes('humanDrafts'));
  assert.ok(s.includes('Preserve what staff is typing'));
});

test('telegram bridge supports ticket-code fallback and delivery failure tracking',()=>{
  const s=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.ok(s.includes('findOpenBridgeTicketByCode'));
  assert.ok(s.includes('recordBridgeDeliveryFailure'));
});

test('WD replacement workflow returns member bank data to WD human bridge',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.ok(s.includes("workflow_type!=='WD_REPLACEMENT'"));
  assert.ok(s.includes('minta ganti rekening'));
});

test('telegram tickets expose inline operational buttons',()=>{
  const s=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.ok(s.includes('ticketKeyboard'));
  assert.ok(s.includes('WD_DANA_LIMIT'));
  assert.ok(s.includes('BONUS_DEPOSIT_FIRST'));
});
