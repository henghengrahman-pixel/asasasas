import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');

test('reset/operational checking uses requested wait message',()=>{
  assert.match(engine,/Mohon tunggu sebentar ya bosku/);
  assert.match(engine,/Kami cek terlebih dahulu permintaannya/);
});

test('WD asks ID when missing and sends processing message',()=>{
  assert.match(engine,/Boleh kirim ID akunnya ya bosku/);
  assert.match(engine,/Withdraw bosku sedang kami proses ya/);
  assert.match(engine,/cek kepastian wd/);
});

test('WD pending reply stays silent until member talks again',()=>{
  assert.match(engine,/silentReason:'WD_PENDING'/);
  assert.match(engine,/WD_STATUS/);
  assert.match(bridge,/status WD pending disimpan/);
});

test('DANA limit collects replacement account and sends it back to WD group',()=>{
  assert.match(engine,/rekening bosku sedang limit/);
  assert.match(engine,/WAITING_MEMBER_ACCOUNT/);
  assert.match(engine,/NAMA REK :/);
  assert.match(engine,/NO REK :/);
  assert.match(engine,/JENIS REK :/);
  assert.match(engine,/alihkan wd ke rekening ini/);
});

test('LiveChat-like dashboard preserves line breaks and has bottom multiline composer',()=>{
  assert.match(html,/textarea id="manualText"/);
  assert.match(app,/msgbody/);
  assert.match(css,/white-space:pre-wrap/);
  assert.match(css,/msgrow\.customer/);
  assert.match(css,/msgrow\.ai/);
  assert.match(css,/\.composer/);
  assert.match(app,/Shift|shiftKey/);
});

test('manual dashboard CS replies are captured for learning',()=>{
  assert.match(server,/captureHumanReplyLearning/);
  assert.match(server,/authorId:'admin'/);
});
