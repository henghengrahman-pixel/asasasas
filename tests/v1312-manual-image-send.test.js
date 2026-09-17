import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('manual chat composer exposes image picker and preview',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="pickImage"/);
  assert.match(html,/id="manualImage"/);
  assert.match(html,/accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(js,/uploadManualImage/);
  assert.match(js,/8\*1024\*1024/);
});

test('server image route requires takeover and stores outbound attachment',()=>{
  const src=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(src,/\/api\/conversations\/:id\/image/);
  assert.match(src,/HUMAN_TAKEOVER_REQUIRED/);
  assert.match(src,/uploadAndSendFile/);
  assert.match(src,/\[CS mengirim gambar\]/);
});

test('livechat client uploads then sends file event',()=>{
  const src=fs.readFileSync(new URL('../src/livechat.js',import.meta.url),'utf8');
  assert.match(src,/async uploadFile\(/);
  assert.match(src,/\/upload_file/);
  assert.match(src,/type:'file'/);
  assert.match(src,/async uploadAndSendFile\(/);
});
