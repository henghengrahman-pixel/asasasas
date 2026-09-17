
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('typing # opens a real-time Responses Manual dropdown',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/function activeShortcutToken/);
  assert.match(src,/function shortcutCandidates/);
  assert.match(src,/function renderShortcutMenu/);
  assert.match(src,/textarea\.addEventListener\('input',\(\)=>\{refreshShortcutMenu\(textarea\)\}\)/);
});

test('shortcut dropdown supports keyboard navigation and selection',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/ArrowDown/);
  assert.match(src,/ArrowUp/);
  assert.match(src,/chooseShortcut\(shortcutIndex\)/);
  assert.match(src,/Escape/);
});

test('shortcut selection replaces only active # token with response content',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/const before=String\(ta\.value\|\|''\)\.slice\(0,range\.start\)/);
  assert.match(src,/const after=String\(ta\.value\|\|''\)\.slice\(range\.end\)/);
  assert.match(src,/ta\.value=before\+content\+after/);
});

test('manual responses get ranking boost and dropdown shows preview',()=>{
  const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/row\.source_kind==='manual'/);
  assert.match(src,/shortcutPreview/);
  assert.match(src,/source_kind==='manual'\?'Manual':'LiveChat'/);
});

test('autocomplete CSS is present',()=>{
  const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(css,/\.shortcutMenu/);
  assert.match(css,/\.shortcutOption\.active/);
  assert.match(css,/\.shortcutPreview/);
});
