import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../public/assets/js/core/shell.js',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../public/pages/archives.html',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/assets/js/pages/archives.js',import.meta.url),'utf8');
test('archives snapshot prior session through resilient queue and normalized messages',()=>{
  assert.match(db,/CREATE TABLE IF NOT EXISTS archive_jobs/);
  assert.match(db,/UNIQUE\(chat_id,session_key\)/);
  assert.match(db,/archiveConversationSessionResilient\(chatId,\{excludeEventId:triggerEventId/);
  assert.match(db,/CREATE TABLE IF NOT EXISTS conversation_archive_messages/);
  assert.match(db,/ON CONFLICT\(archive_id,source_message_id\) DO NOTHING/);
  assert.match(db,/markConversationEnded\(chatId\)[\s\S]*archiveConversationSessionResilient/);
});
test('archives routes use cursor list, metadata detail and message paging',()=>{
  assert.match(server,/app\.get\('\/api\/archives'/);
  assert.match(server,/app\.get\('\/api\/archives\/:archiveId'/);
  assert.match(server,/app\.get\('\/api\/archives\/:archiveId\/messages'/);
  assert.doesNotMatch(server,/listConversationArchives\([^\n]*offset:/);
  assert.match(ui,/nextCursor/); assert.match(ui,/AbortController/); assert.match(ui,/nextBefore/);
  assert.match(server,/dashboardPages=new Set\(\[[^\]]*'archives'/);assert.match(shell,/\['archives','Archives'\]/);assert.match(page,/data-page="archives"/);
});
