import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hb=fs.readFileSync(new URL('../src/human-bridge.js', import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/db.js', import.meta.url),'utf8');

test('v1.24.8 Telegram tickets show LiveChat customer name prominently',()=>{
  assert.match(hb,/Nama LC:/);
  assert.match(hb,/getConversationIdentity\(request\.chat_id\)/);
  assert.match(db,/export async function getConversationIdentity\(chatId\)/);
});

test('v1.24.8 Telegram informational events also include LiveChat name',()=>{
  assert.match(hb,/getConversationIdentity\(chatId\)/);
  assert.match(hb,/👤 Nama LC: \$\{lcName\}/);
});
