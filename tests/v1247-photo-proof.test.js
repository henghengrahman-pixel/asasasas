
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
const telegram=fs.readFileSync(new URL('../src/telegram.js',import.meta.url),'utf8');

test('v1.24.7 photo-first flow asks only for user ID then waits human',()=>{
  assert.match(engine,/PROOF_REVIEW/);
  assert.match(engine,/Bukti\/fotonya sudah kami terima/);
  assert.match(engine,/WAITING_HUMAN/);
  assert.match(engine,/WAITING_CHECK_REPLY/);
});

test('v1.24.7 Telegram sends proof as photo not raw link',()=>{
  assert.match(telegram,/async sendPhoto\(/);
  assert.match(bridge,/sendPhotoWithRetry/);
  assert.match(bridge,/proofPhoto/);
  assert.match(bridge,/Bukti gambar dikirim sebagai Telegram photo/);
});

test('v1.24.7 proof ticket has requested triage actions',()=>{
  assert.match(bridge,/Deposit done/);
  assert.match(bridge,/WD sedang diproses/);
  assert.match(bridge,/Clear cache/);
  assert.match(bridge,/CLEAR_CACHE/);
});

test('v1.24.7 operator actions use requested customer messages',()=>{
  assert.match(engine,/Deposit bosku sudah berhasil kami proses ya/);
  assert.match(engine,/Withdraw bosku sedang kami proses ya/);
  assert.match(engine,/CARA CLEAR CACHE DI HP/);
  assert.match(engine,/https:\/\/omtogelxml\.com\//);
  assert.match(engine,/CLEARCACHE_OMTOGEL\.jpg/);
});
