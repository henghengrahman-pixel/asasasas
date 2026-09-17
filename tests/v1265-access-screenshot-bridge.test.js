
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';

test('common login/access complaints are operational intents',()=>{
  assert.equal(detectIntent('ga bisa login bos'),'LOGIN_PROBLEM');
  assert.equal(detectIntent('link ga bisa akses'),'LINK_PROBLEM');
});

test('access/login flow asks screenshot first and sends evidence to staff',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const block=src.slice(src.indexOf('// Login/access/barcode/general disturbance'),src.indexOf('// Game macet/error'));
  assert.match(block,/Boleh dibantu kirimkan screenshot kendalanya/);
  assert.match(block,/Keterangan : mohon dicek/);
  assert.match(block,/WAITING_PROOF/);
  assert.match(block,/WAITING_HUMAN/);
});

test('Telegram bridge sends latest attachment as photo when present',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(src,/proofPhoto=attachmentUrls/);
  assert.match(src,/sendPhotoWithRetry/);
});
