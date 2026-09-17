
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeText } from '../src/normalizer.js';
import { DP_DPPGA_REPLY, DP_BARCODE_REPLY } from '../src/deposit-actions.js';

const dppga=`Mohon ditunggu ya bosku
Kendala transaksi bosku sudah kami laporkan ke tim pusat QRIS dan saat ini masih dalam proses pengecekan.

Jika transaksi berhasil diterima oleh QRIS kami, dana akan otomatis masuk ke akun bosku. Namun, jika transaksi tidak dapat diterima, dana akan dikembalikan (refund) ke akun atau e-wallet yang digunakan.

⏳ Estimasi proses maksimal 7×24 jam.

Terima kasih atas kesabaran dan pengertiannya ya, bosku 😊🙏`;

const barcode=`Mohon maaf ya bosku
Setelah kami lakukan pengecekan, kami tidak menemukan permintaan BARCODE dengan nominal dan waktu seperti yang tertera pada bukti yang bosku kirimkan.

Mohon dicek kembali ya, bosku. Terima kasih 😊🙏`;

test('deposit Telegram keyboard includes DPPGA and BARCODE',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(src,/text:'DPPGA'.*DP_DPPGA/);
  assert.match(src,/text:'BARCODE'.*DP_BARCODE/);
});

test('DPPGA uses exact member confirmation wording and keeps QRIS review state',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.equal(DP_DPPGA_REPLY,dppga);
  assert.match(src,/DP_DPPGA:\['#DP_DPPGA',DP_DPPGA_REPLY\]/);
  assert.match(src,/DP_DPPGA/);
  assert.match(src,/DEPOSIT_QRIS_REVIEW/);
  assert.match(src,/WAITING_QRIS_CENTER/);
  assert.match(src,/maxEtaHours:168/);
});

test('BARCODE uses exact member confirmation wording',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.equal(DP_BARCODE_REPLY,barcode);
  assert.match(src,/DP_BARCODE:\['#DP_BARCODE',DP_BARCODE_REPLY\]/);
  assert.match(src,/DP_BARCODE/);
  assert.match(src,/DEPOSIT_BARCODE/);
  assert.match(src,/BARCODE_NOT_FOUND/);
});

test('expanded shorthand normalizer understands common conversational typos',()=>{
  assert.equal(normalizeText('klo qrisnya gbs msk trus gimana'),'kalau qris tidak bisa masuk terus gimana');
  assert.equal(normalizeText('mksdnya brcd ga ada'),'maksudnya barcode tidak ada');
  assert.equal(normalizeText('cancelin depo'),'batalkan deposit');
});

test('AI prompt contains explicit continuity contract',()=>{
  const src=fs.readFileSync(new URL('../src/ai.js',import.meta.url),'utf8');
  for(const phrase of [
    'KONTINUITAS PERCAKAPAN WAJIB',
    'Pertahankan SATU masalah aktif',
    'Jangan mengulang pertanyaan yang datanya sudah diberikan',
    'Foto/screenshot tidak otomatis berarti deposit',
    'tanyakan SATU klarifikasi spesifik'
  ]) assert.ok(src.includes(phrase),phrase);
});
