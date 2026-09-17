import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const cssFiles=fs.readdirSync(path.join(root,'public/assets/css')).filter(x=>x.endsWith('.css'));
const pages=fs.readdirSync(path.join(root,'public/pages')).filter(x=>x.endsWith('.html'));

test('conversations.css is runtime-loaded only by conversations page',()=>{
  for(const f of pages){const has=read('public/pages/'+f).includes('/static/css/conversations.css');assert.equal(has,f==='conversations.html',f)}
});
test('login.css is runtime-loaded only by login',()=>{
  assert.match(read('public/index.html'),/\/static\/css\/login\.css/);
  for(const f of pages)assert.doesNotMatch(read('public/pages/'+f),/\/static\/css\/login\.css/);
});
test('legacy style.css and app.js are not loaded by production html',()=>{
  for(const f of ['public/index.html',...pages.map(x=>'public/pages/'+x)]){const h=read(f);assert.doesNotMatch(h,/\/style\.css/);assert.doesNotMatch(h,/\/app\.js/)}
});
test('global hidden has one owner',()=>{
  assert.match(read('public/assets/css/base.css'),/\.hidden\s*\{/);
  for(const f of cssFiles.filter(x=>x!=='base.css'))assert.doesNotMatch(read('public/assets/css/'+f),/(^|[,}\s])\.hidden\s*\{/m,f);
});
test('table-wrap and cell-actions are owned by tables.css',()=>{
  for(const sel of ['table-wrap','cell-actions']){
    assert.match(read('public/assets/css/tables.css'),new RegExp('\\.'+sel+'\\s*\\{'));
    for(const f of cssFiles.filter(x=>x!=='tables.css'))assert.doesNotMatch(read('public/assets/css/'+f),new RegExp('(^|[,}\\s])\\.'+sel+'\\s*\\{','m'),f);
  }
});
test('conversation selectors are page scoped and avoid root leakage',()=>{
  const css=read('public/assets/css/conversations.css');
  assert.doesNotMatch(css,/(^|\n)\s*(html|body)\s*[,\{]/);
  assert.doesNotMatch(css,/(^|\n)\s*\.(messages|composer|customer-panel|conversation-layout)\s*\{/);
  assert.match(css,/body\[data-page="conversations"\] \.(messages|conversation-layout)/);
});
test('conversation layout prevents overflow and keeps composer in flex flow',()=>{
  const css=read('public/assets/css/conversations.css');
  assert.match(css,/grid-template-columns:310px minmax\(0,1fr\) 280px/);
  assert.match(css,/\.conversation-pane\{[^}]*min-height:0[^}]*display:flex;flex-direction:column/s);
  assert.match(css,/\.messages\{[^}]*flex:1;min-height:0;overflow-y:auto[^}]*justify-content:flex-start[^}]*gap:8px/s);
  assert.match(css,/\.composer-shell\{flex:none/);
  assert.doesNotMatch(css,/\.composer\{[^}]*position:(fixed|absolute)/s);
});
test('initial inbox skeleton is removed after first data render',()=>{
  const js=read('public/assets/js/pages/conversations.js');assert.match(js,/chat-list-loading[^\n]*remove\(\)/);
});
test('message dedup uses store messageMap and send is single-flight',()=>{
  const store=read('public/assets/js/pages/conversation-store.js'),js=read('public/assets/js/pages/conversations.js');
  assert.match(store,/messageMap:new Map/);assert.match(js,/store\.hasMessage/);assert.match(js,/sendBusy/);assert.match(js,/state\.sendBusy=true/);
});
test('health route remains JSON service endpoint',()=>{
  const server=read('src/server.js');assert.match(server,/app\.get\('\/health'[\s\S]{0,350}\.json\(\{ok:true,service:'livechat-ai'\}\)/);
});
test('target desktop viewport contracts are explicit',()=>{
  const css=read('public/assets/css/conversations.css');
  for(const width of [1920,1600,1440,1366])assert.ok(width>1320);
  assert.match(css,/grid-template-columns:310px minmax\(0,1fr\) 280px/);
  assert.match(css,/@media\(max-width:1320px\)[\s\S]*grid-template-columns:300px minmax\(0,1fr\)/);
  assert.ok(1280<=1320);
});
