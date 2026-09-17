import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');

test('deposit flow waits for ID+proof, sends holding, then bridges',()=>{
  assert.match(engine,/DEPOSIT_VERIFY/);
  assert.match(engine,/Boleh kirim user ID-nya/);
  assert.match(engine,/WAITING_CHECK_REPLY/);
  assert.match(engine,/Silakan cek deposit member/);
});

test('telegram deposit ticket has final and proof-review actions',()=>{
  assert.match(bridge,/Deposit Done/);
  assert.match(bridge,/Detail Bukti/);
});

test('end chat closes LiveChat and local inbox',()=>{
  assert.match(server,/conversations\/:id\/end/);
  assert.match(server,/lc\.endChat/);
  assert.match(ui,/End chat/);
});

test('inbox exposes LiveChat-like preview, time, needs-reply indicator',()=>{
  assert.match(server,/last_message/);
  assert.match(server,/needs_reply/);
  assert.match(ui,/chatlisttime/);
  assert.match(css,/unreaddot/);
  assert.match(css,/startedline/);
});
