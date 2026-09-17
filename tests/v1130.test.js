import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { learningSignature, isSafeHistoryExample } from '../src/learning.js';
import { LiveChatClient } from '../src/livechat.js';

test('history learning signature clusters conversational variants',()=>{
  assert.equal(learningSignature('Siap bosku, mohon tunggu ya 😊'),learningSignature('Siap bos, tunggu ya'));
});

test('history auto-learning rejects sensitive facts as reusable replies',()=>{
  assert.equal(isSafeHistoryExample('Siap bosku, kami cek dulu ya 🙏'),true);
  assert.equal(isSafeHistoryExample('Password: abc123 dan nomor rekening 081234567890'),false);
});

test('inbox rank follows LiveChat list order',()=>{
  const poller=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(poller,/chats\.entries\(\)/);
  assert.match(db,/lc_inbox_rank/);
  assert.match(server,/lc_inbox_rank ASC NULLS LAST/);
});

test('AI prompt includes full history patterns and structured case memory',()=>{
  const ai=fs.readFileSync(new URL('../src/ai.js',import.meta.url),'utf8');
  assert.match(ai,/POLA HISTORI CS OTOMATIS/);
  assert.match(ai,/MEMORI KASUS TERSTRUKTUR SAAT INI/);
});

test('end chat understands already inactive detail',()=>{
  const lc=new LiveChatClient({base:'http://x',accountId:'a',pat:'b'});
  assert.equal(lc.chatActiveFlag({last_thread:{active:false}}),false);
  assert.equal(lc.chatActiveFlag({status:'active'}),true);
});
