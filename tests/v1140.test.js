import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const ai=fs.readFileSync(new URL('../src/ai.js',import.meta.url),'utf8');
const poller=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
const cfg=fs.readFileSync(new URL('../src/config.js',import.meta.url),'utf8');

test('v1.14 style examples are approved-only',()=>{
  assert.match(db,/source_type='HUMAN_CHAT' AND status='APPROVED'/);
});

test('v1.14 auto history needs three safe repeats',()=>{
  assert.match(db,/occurrences\+1\)>=3/);
  assert.match(db,/VALUES\(\$1,\$2,\$3,\$4,1,false\)/);
});

test('v1.14 human request has database race guard',()=>{
  assert.match(db,/idx_human_requests_one_open_chat/);
  assert.match(db,/if\(e\.code!=='23505'\) throw e/);
});

test('v1.14 OpenAI retries transient failures but not auth',()=>{
  assert.match(ai,/408,409,429,500,502,503,504/);
  assert.match(ai,/config\.openaiRetries/);
  assert.match(ai,/\[400,404,405,415,422\]/);
});

test('v1.14 member burst debounce is enabled',()=>{
  assert.match(cfg,/memberDebounceMs/);
  assert.match(poller,/config\.memberDebounceMs/);
  assert.match(poller,/summaryFingerprints\.delete\(chatId\)/);
});
