import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeText, detectIntent } from '../src/normalizer.js';

test('sandi/sandiku dinormalisasi sebagai password',()=>{
  assert.equal(normalizeText('lupa sandi bos'),'lupa password bos');
  assert.equal(normalizeText('cek sandiku bos'),'cek password bos');
});

test('permintaan cek sandi dikenali sebagai reset password',()=>{
  assert.equal(detectIntent('bosku bisa cek in nama dan sandiku'),'FORGOT_PASSWORD');
  assert.equal(detectIntent('lupa sandi bos'),'FORGOT_PASSWORD');
});

test('reset password tidak meminta user ID dan langsung route setelah data rekening lengkap',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=s.indexOf('// Reset password: NEVER ask user ID');
  const end=s.indexOf('// Every WD problem goes to Telegram staff');
  assert.ok(start>=0 && end>start);
  const block=s.slice(start,end);
  assert.doesNotMatch(block,/missing\.push\(['\"]user ID/);
  assert.doesNotMatch(block,/data\.userId/);
  assert.match(block,/NO REK/);
  assert.match(block,/a\/n/);
  assert.match(block,/JENIS REK/);
  assert.match(block,/reset password ko/);
});

test('prompt AI melarang minta user ID pada forgot password dan menempatkan AI sebagai CS manusia',()=>{
  const s=fs.readFileSync(new URL('../src/ai.js',import.meta.url),'utf8');
  assert.match(s,/KHUSUS FORGOT_PASSWORD: jangan pernah meminta user ID kepada member/);
  assert.match(s,/posisikan diri sebagai CS yang sedang melayani/);
  assert.match(s,/Jangan pernah menyebut diri sebagai AI/);
});
