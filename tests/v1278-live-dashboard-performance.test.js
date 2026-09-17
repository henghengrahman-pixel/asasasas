
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('conversation rendering uses stable message fingerprint',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/function stableMessageFingerprint/);
  assert.match(src,/if\(fp===messageFingerprint\)/);
  assert.match(src,/messageFingerprint=fp/);
});

test('active text selection is not destroyed by polling',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/function selectionInside/);
  assert.match(src,/if\(auto&&selectionInside\(box\)\)return/);
});

test('scroll position is preserved and auto-scroll only happens near bottom',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/function preserveScrollOnRender/);
  assert.match(src,/nearBottom/);
  assert.match(src,/preserveScrollOnRender\(box/);
});

test('live dashboard separates conversation and inbox polling cadence',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/now-lastConversationPoll>=500/);
  assert.match(src,/now-lastChatListPoll>=1200/);
  assert.match(src,/setInterval\(liveUiTick,250\)/);
});

test('copy button exists per message and clipboard copy is supported',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/data-copy-msg/);
  assert.match(src,/navigator\.clipboard\.writeText/);
  assert.match(src,/document\.execCommand\('copy'\)/);
});

test('message text is explicitly selectable in CSS',()=>{
  const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(css,/user-select:text !important/);
  assert.match(css,/cursor:text/);
  assert.match(css,/scrollbar-gutter:stable/);
});

test('stale in-flight chat response cannot paint another room',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/if\(currentChat!==id\)return/);
});

test('images are lazy loaded and asynchronously decoded',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/loading="lazy"/);
  assert.match(src,/decoding="async"/);
});
