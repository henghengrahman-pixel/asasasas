import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');

test('v1.20.6 return-to-AI resumes latest unanswered member message',()=>{
  assert.match(engine,/resumeConversationAfterHumanTakeover/);
  assert.match(engine,/operator_returned_conversation_to_ai/);
  assert.match(server,/resumeConversationAfterHumanTakeover\(\{chatId,livechat:lc\}\)/);
});

test('v1.20.6 resumed chat is never treated as new greeting candidate',()=>{
  assert.match(engine,/const wasNewConversation=!skipInsert/);
});

test('v1.20.6 delayed promo greeting is suppressed after conversation starts',()=>{
  assert.match(engine,/conversation_already_started_after_trigger/);
  assert.match(engine,/GREETING_SUPPRESSED/);
});
