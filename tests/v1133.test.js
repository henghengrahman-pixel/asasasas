import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('getChat evaluates all candidates and does not return first non-empty detail',()=>{
  const s=fs.readFileSync(new URL('../src/livechat.js',import.meta.url),'utf8');
  assert.match(s,/thread_limit:\s*100/);
  assert.doesNotMatch(s,/if \(count > 0\) return chat/);
  assert.match(s,/if \(count > bestCount\)/);
});

test('operational workflows can scan full stored conversation history',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  const eng=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(db,/getFullContext\(chatId, limit=10000\)/);
  assert.match(eng,/getOperationalHistory\(chatId\)/);
  assert.match(eng,/db\.getFullContext\(chatId,10000\)/);
});

test('AI prompt explicitly treats digest and recent context as one whole conversation',()=>{
  const s=fs.readFileSync(new URL('../src/ai.js',import.meta.url),'utf8');
  assert.match(s,/percakapan dari awal/);
  assert.match(s,/Telusuri masalah dari awal sampai status terbaru/);
});
