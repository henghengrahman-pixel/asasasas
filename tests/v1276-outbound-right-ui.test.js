
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('main conversation renders customer left, true system banner centered, other outbound right',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/const type=originalType==='customer'\?'customer':isTrueSystemBanner\(m\)\?'system':'ai'/);
  assert.match(src,/data-original-sender=/);
});

test('human request history keeps true system banner centered and other outbound on right',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=src.indexOf('function humanMessageHtml');
  const end=src.indexOf('async function loadHumanConversation',start);
  const block=src.slice(start,end);
  assert.match(block,/const type=originalType==='customer'\?'customer':isTrueSystemBanner\(m\)\?'system':'ai'/);
  assert.ok(block.includes("const label=type==='customer'?(name||'Member'):type==='system'?'System':'CS';"));
});

test('outbound ai class is styled on the right',()=>{
  const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(css,/\.msgrow\.ai[^\{]*\{justify-content:flex-end\}/);
});
