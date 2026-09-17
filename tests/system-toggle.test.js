import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('poller has system_enabled gate before LiveChat listChats',()=>{
  const s=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  const gate=s.indexOf("getSetting('system_enabled',true)");
  const call=s.indexOf('livechat.listChats()');
  assert.ok(gate>=0 && call>gate);
});

test('engine blocks when LIVECHAT AI master is OFF',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/system_enabled/);
  assert.match(s,/LIVECHAT_AI_SYSTEM_OFF/);
});

test('dashboard exposes LIVECHAT AI master switch',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="systemEnabled"/);
  assert.match(js,/settings\/system-enabled/);
  assert.match(js,/data-human-card/);
  assert.doesNotMatch(js,/\$\('#autoReply'\)/);
});
