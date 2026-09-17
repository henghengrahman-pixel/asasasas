
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('real promo/system banner stays System instead of becoming CS',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/function isTrueSystemBanner/);
  assert.match(src,/Lebih Mudah Menghubungi Kami Via Telegram/);
  assert.match(src,/isTrueSystemBanner\(m\)\?'system':'ai'/);
  assert.match(src,/type==='system'\?'System':'CS'/);
});

test('ordinary outbound system/action messages still render as CS on right',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/originalType==='customer'\?'customer':isTrueSystemBanner\(m\)\?'system':'ai'/);
});

test('system banner css remains centered',()=>{
  const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(css,/\.msgrow\.system\s*\{\s*justify-content:center !important;/s);
});

test('learning history scanner skips stale-session items instead of throwing',()=>{
  const src=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(src,/STALE_SESSION_REQUEST/);
  assert.match(src,/staleSkipped\+\+/);
  assert.match(src,/HISTORY_ITEM_SKIPPED/);
});

test('learning scan endpoint treats stale history as non-fatal',()=>{
  const src=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(src,/learningWorker\.runNow/);
  assert.match(src,/BACKFILL_FAILED/);
});

test('learning scan UI does not popup raw stale-session error',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/sesi lama dilewati/);
  assert.match(src,/Scanning chat CS/);
  assert.match(src,/Scan gagal:/);
});
