
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('End Chat uses LiveChat deactivate_chat id payload first',()=>{
  const src=fs.readFileSync(new URL('../src/livechat.js',import.meta.url),'utf8');
  const start=src.indexOf('async endChat(chatId)');
  const end=src.indexOf('async prepareImageAttachments',start);
  const block=src.slice(start,end);
  assert.match(block,/body:\{id\},shape:'id'/);
  assert.match(block,/this\.call\('deactivate_chat',candidate\.body\)/);
});

test('End Chat retains chat_id compatibility fallback after id shape',()=>{
  const src=fs.readFileSync(new URL('../src/livechat.js',import.meta.url),'utf8');
  const start=src.indexOf('async endChat(chatId)');
  const end=src.indexOf('async prepareImageAttachments',start);
  const block=src.slice(start,end);
  assert.ok(block.indexOf("{body:{id},shape:'id'}") < block.indexOf("{body:{chat_id:id},shape:'chat_id'}"));
});

test('End Chat is idempotent for already closed chats',()=>{
  const src=fs.readFileSync(new URL('../src/livechat.js',import.meta.url),'utf8');
  assert.match(src,/alreadyClosed:true/);
  assert.match(src,/get_chat_404/);
  assert.match(src,/Number\(e\?\.status\)===404/);
});

test('dashboard closes local conversation only after LC endChat succeeds',()=>{
  const src=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const routePos=src.indexOf("app.post('/api/conversations/:id/end'");
  const lcPos=src.indexOf('const lcResult=await lc.endChat(req.params.id)',routePos);
  const localPos=src.indexOf('const local=await markConversationEnded(req.params.id)',routePos);
  assert.ok(routePos>=0);
  assert.ok(lcPos>routePos);
  assert.ok(localPos>lcPos);
});
