import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/assets/css/archives.css',import.meta.url),'utf8');
test('active AI context is scoped by persisted session_key with greeting fallback only for legacy rows',()=>{
  assert.match(db,/ALTER TABLE messages ADD COLUMN IF NOT EXISTS session_key TEXT/);
  assert.match(db,/m\.session_key=NULLIF\(c\.session_key,''\)/);
  assert.match(db,/m\.session_key IS NULL[\s\S]*GREETING_TRIGGER/);
  assert.match(engine,/boundarySource:'LIVECHAT_THREAD_ID'/);
  assert.match(engine,/AUTHORITATIVE_SYSTEM_WELCOME/);
});
test('conversation detail and delta polling use current conversation session_key',()=>{
  const guards=(server.match(/session_key=COALESCE\(\(SELECT NULLIF\(session_key,''\) FROM conversations WHERE chat_id=\$1\),session_key\)/g)||[]).length;
  assert.ok(guards>=2,`expected at least 2 session-key guards, found ${guards}`);
});
test('archives list and history detail are independently scrollable',()=>{
  assert.match(css,/\.archive-list\{[^}]*min-height:0;[^}]*overflow:auto/);
  assert.match(css,/\.archive-detail\{[^}]*min-height:0;[^}]*display:flex/);
  assert.match(css,/\.archive-messages\{[^}]*min-height:0;[^}]*overflow-y:auto/);
});
