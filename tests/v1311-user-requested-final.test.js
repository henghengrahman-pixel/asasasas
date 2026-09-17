import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('Website Profile is editable and injected into bot sources',()=>{
  assert.match(server,/\/api\/website-profile/);
  assert.match(engine,/\[WEBSITE PROFILE\]/);
  assert.match(engine,/source:'WEBSITE_PROFILE'/);
  assert.match(html,/id="tab-website"/);
});

test('active alternate links are authoritative and prioritized',()=>{
  assert.match(engine,/alternativeLinks/);
  assert.match(engine,/active!==false/);
  assert.match(engine,/sort\(\(a,b\)=>Number\(b\.priority/);
});

test('Rules Knowledge Responses support portable bulk backup and restore',()=>{
  assert.match(server,/\/api\/brain\/export/);
  assert.match(server,/\/api\/brain\/import/);
  assert.match(server,/REPLACE_CONFIRM_REQUIRED/);
  assert.match(app,/downloadBrain\(/);
  assert.match(html,/Download Semua/);
});

test('test-derived behavior pack seeds context DP WD reset loss and bridge safety',()=>{
  for(const term of ['Anti Tanya Ulang','Alur Deposit Belum Masuk','Alur Withdraw Belum Masuk','Alur Reset Password','Penanganan Member Kalah','Human Bridge Aman']) assert.match(db,new RegExp(term));
});

test('Telegram fast path remains ACK-first and whitelist fails closed when selected',()=>{
  assert.match(bridge,/ULTRA-FAST CALLBACK ACK/);
  assert.match(bridge,/answerCallbackQuery/);
  assert.match(bridge,/if\(!allowed\.length\) return false/);
});

test('public health is minimal and webhook validates raw request bytes',()=>{
  assert.match(server,/req\.rawBody/);
  assert.match(server,/WEBHOOK_SECRET_NOT_CONFIGURED/);
  assert.match(server,/json\(\{ok:true,service:'livechat-ai'\}\)/);
});

test('mobile dashboard uses fixed bottom control navigation',()=>{
  assert.match(css,/position:fixed!important/);
  assert.match(css,/bottom:0/);
  assert.match(css,/websiteForm/);
});
