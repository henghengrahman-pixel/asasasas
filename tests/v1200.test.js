import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { semanticNormalize, semanticScore } from '../src/semantic.js';

test('semantic normalize memahami singkatan operasional CS Indonesia',()=>{
  assert.equal(semanticNormalize('dp blm msk habis tf'),'deposit belum masuk habis transfer');
  assert.match(semanticNormalize('lupa psw akun'),/password/);
});

test('semantic similarity menghubungkan variasi kalimat dengan maksud sama',()=>{
  const same=semanticScore('dp blm msk','deposit saya belum masuk setelah transfer');
  const other=semanticScore('dp blm msk','mau tanya jadwal pertandingan bola');
  assert.ok(same>0.45,`same=${same}`);
  assert.ok(same>other+0.25,`same=${same} other=${other}`);
});

test('dashboard v1.20 menampilkan case intelligence dan feedback dua arah',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/caseMeta/);
  assert.match(js,/Data diketahui/);
  assert.match(js,/Bagus/);
  assert.match(js,/Koreksi/);
});
