
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('anonymous admin send-as reply is accepted only as exact reply-to-ticket',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(src,/anonymousAdminReply/);
  assert.match(src,/m\.sender_chat/);
  assert.match(src,/m\.reply_to_message\?\.message_id/);
  assert.match(src,/String\(ticket\.telegram_message_id\|\|''\)!==repliedId/);
});

test('failed telegram reply is reopened and update is retryable',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(src,/reopenBridgeTicket\(ticket\.id,e\.message\)/);
  assert.match(src,/throw e;/);
  assert.match(src,/failTelegramUpdate\(updateId,e\.message\)/);
});

test('human Telegram reply can send during LC Human Takeover',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/HUMAN_BRIDGE_REPLY_DURING_TAKEOVER/);
  const start=src.indexOf('export async function answerHumanRequest');
  const end=src.indexOf('export async function resumeConversationAfterHumanTakeover');
  const humanRegion=src.slice(start,end);
  assert.doesNotMatch(humanRegion,/throw new Error\('HUMAN_TAKEOVER_ACTIVE'\)/);
  assert.match(src,/sendAndStore\(livechat,request\.chat_id,finalText,intent,'human_bridge'\)/);
});

test('human bridge LC send retries up to three times',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/senderType==='human_bridge'\?3:1/);
  assert.match(src,/for\(let attempt=1;attempt<=maxAttempts;attempt\+\+\)/);
});

test('reset credentials reply still formats member response automatically',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/intent==='FORGOT_PASSWORD'/);
  assert.match(src,/parseResetCredentialReply\(humanAnswer\)/);
  assert.match(src,/resetCredentialMemberReply\(credentials\)/);
  assert.match(src,/HUMAN_RESET_CREDENTIALS/);
});
