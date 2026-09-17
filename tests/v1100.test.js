import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';
import { bridgeCategory } from '../src/bridge-category.js';

test('gangguan dibedakan dari lupa password',()=>{
  assert.equal(detectIntent('ga bisa masuk bos'),'LOGIN_PROBLEM');
  assert.equal(detectIntent('ga bisa login'),'LOGIN_PROBLEM');
  assert.equal(detectIntent('lupa password ga bisa masuk'),'FORGOT_PASSWORD');
  assert.equal(detectIntent('link ga bisa akses'),'LINK_PROBLEM');
  assert.equal(detectIntent('permainan eror keluar sendiri'),'GAME_PROBLEM');
  assert.equal(detectIntent('ada gangguan server'),'GENERAL_DISTURBANCE');
});

test('gangguan masuk Human Bridge ISSUE',()=>{
  assert.equal(bridgeCategory('LOGIN_PROBLEM'),'ISSUE');
  assert.equal(bridgeCategory('LINK_PROBLEM'),'ISSUE');
  assert.equal(bridgeCategory('GAME_PROBLEM'),'ISSUE');
  assert.equal(bridgeCategory('GENERAL_DISTURBANCE'),'ISSUE');
  assert.equal(bridgeCategory('ACCOUNT_CHANGE_REQUEST'),'WD_PROBLEM');
});

test('polling near realtime dan UI cepat tanpa full rerender tiap tick',()=>{
  const cfg=fs.readFileSync(new URL('../src/config.js',import.meta.url),'utf8');
  const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(cfg,/Math\.max\(1000/);
  assert.match(ui,/setInterval\(liveUiTick,250\)/);
  assert.match(ui,/now-lastConversationPoll>=500/);
  assert.match(ui,/now-lastChatListPoll>=1200/);
  assert.match(ui,/stableMessageFingerprint/);
});

test('telegram ticket awal sederhana dan routing tetap internal',()=>{
  const hb=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  const eng=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(hb,/Initial Telegram ticket intentionally stays simple/);
  assert.match(eng,/NO REK \$\{data\.no\}/);
  assert.match(eng,/reset password ko/);
  assert.match(eng,/claim bonus/);
  assert.match(eng,/minta ganti rekening/);
});

test('belajar CS aktif langsung untuk style dan auto approve pola aman berulang',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  const eng=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(db,/getHumanStyleExamples\(limit=30\)/);
  assert.match(db,/occurrences\+1>=3/);
  assert.match(db,/safeHumanAutoLearn/);
  assert.match(eng,/getHumanStyleExamples\(30\)/);
});
