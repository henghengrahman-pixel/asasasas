import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';
import { sanitizeCorrection } from '../src/learning.js';

test('bonus umum selalu masuk jalur bonus staff',()=>{
  assert.equal(detectIntent('bos bonus saya gimana'),'BONUS_REQUEST');
  assert.equal(detectIntent('bonus harian belum dapat'),'BONUS_DAILY');
});

test('deposit workflow mewajibkan user ID dan bukti transfer',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/DEPOSIT_VERIFY/);
  assert.match(s,/user ID sama bukti transfernya/);
  assert.match(s,/proofUrl/);
  assert.match(s,/telegram:true/);
});

test('reset password mengumpulkan jenis nama dan nomor rekening',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/jenis rekening\/bank\/e-wallet/);
  assert.match(s,/nama rekening/);
  assert.match(s,/nomor rekening/);
  assert.match(s,/RESET_PASSWORD/);
});

test('WD selalu diarahkan ke human request',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/Every WD problem goes to Telegram staff/);
  assert.match(s,/kendala wd/);
});

test('Deposit lengkap masuk Telegram dan punya tombol status DP',()=>{
  const e=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const b=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(e,/telegram:true/);
  assert.match(b,/DEPOSIT_PROBLEM/);
  assert.match(b,/Deposit Done/);
  assert.match(b,/Detail Bukti/);
});

test('manual human reply jadi kandidat belajar dan pola aman berulang dapat auto approve',()=>{
  const s=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  assert.match(s,/captureHumanReplyLearning/);
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(db,/source_type='HUMAN_CHAT'/);
  assert.match(db,/'PENDING'/);
  assert.match(db,/occurrences\+1>=3/);
  assert.match(db,/safeHumanAutoLearn/);
});

test('teguran AI langsung aktif sebagai koreksi approved',()=>{
  assert.equal(sanitizeCorrection('  jangan jawab begitu  '),'jangan jawab begitu');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(db,/source_type.*AI_FEEDBACK/);
  assert.match(db,/'APPROVED'/);
  const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(ui,/Tegur AI/);
  assert.match(ui,/feedback/);
});

test('dashboard menyediakan menu Belajar dari CS',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/Belajar dari CS/);
  assert.match(html,/tab-learning/);
});
