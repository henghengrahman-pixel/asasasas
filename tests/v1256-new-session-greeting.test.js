import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('LiveChat thread id is primary hard session boundary with authoritative welcome fallback',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(engine,/threadKey=rawThreadKey \? `thread:\$\{rawThreadKey\}` : `welcome:\$\{bannerEventKey\}`/);
  assert.match(engine,/boundarySource=rawThreadKey\?'LIVECHAT_THREAD_ID'/);
  assert.match(engine,/AUTHORITATIVE_SYSTEM_WELCOME/);
  assert.match(engine,/beginNewConversationSession/);
  assert.match(engine,/getCurrentSessionContext\(chatId,10000\)/);
});

test('old workflow cannot contaminate current-session operational history',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(db,/export async function getCurrentSessionContext/);
  assert.match(db,/ALTER TABLE messages ADD COLUMN IF NOT EXISTS session_key TEXT/);
  assert.match(db,/workflow_type=NULL/);
  assert.match(db,/case_brain='\{\}'::jsonb/);
  assert.match(db,/last_reply_hash=NULL/);
});

test('greeting text remains daypart aware and first-response friendly',()=>{
  const greeting=fs.readFileSync(new URL('../src/greeting.js',import.meta.url),'utf8');
  assert.match(greeting,/Selamat \$\{part\}, bosku/);
  assert.match(greeting,/Ada yang bisa kami bantu/);
});
