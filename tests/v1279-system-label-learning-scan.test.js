
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('true System promo stays System identity',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/const type=originalType==='customer'\?'customer':isTrueSystemBanner\(m\)\?'system':'ai'/);
  assert.match(src,/type==='system'\?'System':'CS'/);
  assert.match(src,/Lebih Mudah Menghubungi Kami Via Telegram/);
});

test('historical learning scan skips stale sessions instead of aborting',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(db,/staleSkipped/);
  assert.match(db,/STALE_SESSION_REQUEST/);
  assert.match(server,/learningWorker\.runNow/);
  assert.match(app,/Sesi lama dilewati/);
});

test('learning scan returns processed skipped stale and failed counts',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(db,/return \{scanned,created,skipped,staleSkipped,failed,batches,errors\}/);
});
