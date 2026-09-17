import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');

test('v1.20.3 Tanya Staff can open full conversation history',()=>{
  assert.ok(server.includes("req.query.full"));
  assert.ok(server.includes('getFullContext(req.params.id,20000)'));
  assert.ok(app.includes("'?full=1'" ) || app.includes("+'?full=1'"));
  assert.ok(app.includes('Seluruh Percakapan'));
});

test('v1.20.3 Tanya Staff direct reply uses same LiveChat conversation send endpoint',()=>{
  assert.ok(app.includes("'/api/conversations/'+encodeURIComponent(chat)+'/send'"));
  assert.ok(app.includes('Kirim ke Member'));
  assert.ok(app.includes('humanDirectText'));
});

test('v1.20.3 human takeover controls are available inside Tanya Staff',()=>{
  assert.ok(app.includes('data-htakeover-card'));
  assert.ok(app.includes('data-henableai-card'));
  assert.ok(app.includes('HUMAN TAKEOVER'));
  assert.ok(db.includes('c.handling_mode'));
});

test('v1.20.3 direct reply remains available while request stays OPEN',()=>{
  assert.ok(server.includes("if(!(await isHumanTakeover(req.params.id)))"));
  assert.ok(app.includes("human?'':'disabled'"));
  assert.ok(app.includes('humanReplyDrafts'));
});
