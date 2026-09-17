import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hb=fs.readFileSync(new URL('../src/human-bridge.js', import.meta.url),'utf8');

test('v1.30.3 completed Telegram CTA keeps LiveChat identity trail',()=>{
  assert.match(hb,/async function completedTicketText/);
  assert.match(hb,/👤 Nama LC: \$\{info\.lcName\}/);
  assert.match(hb,/🆔 LiveChat ID: \$\{info\.chatId\}/);
  assert.match(hb,/🔑 User ID: \$\{info\.userId\}/);
  assert.match(hb,/Diproses oleh: \$\{clean\(who,120\)\}/);
  assert.match(hb,/Waktu: \$\{formatWibTime\(\)\}/);
});

test('v1.30.3 user id for Telegram audit is resolved from workflow/request/context',()=>{
  assert.match(hb,/getConversationWorkflow\(chatId\)/);
  assert.match(hb,/getContext\(chatId,30\)/);
  assert.match(hb,/extractUserIdFromText\(text\)/);
  assert.match(hb,/extractRequestedUserIdFromText\(text\)/);
});

test('v1.30.3 photo tickets keep original message and emit identity-preserving completion reply if text edit is unavailable',()=>{
  assert.match(hb,/clearMessageButtons/);
  assert.match(hb,/sendMessage\([^\n]+completedText/);
});
