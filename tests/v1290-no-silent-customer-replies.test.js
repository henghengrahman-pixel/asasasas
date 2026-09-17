import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('open human request acknowledges every new member message unless human takeover',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/if\(openHuman\)\{/);
  assert.match(src,/WAITING_HUMAN_ACK/);
  assert.match(src,/sendAndStore\(livechat,chatId,reply,openHuman\.intent\|\|intent\)/);
});

test('ASK_HUMAN and HANDOFF send a safe holding reply',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/safe_wait_staff/);
  assert.match(src,/human_ask_disabled_safe_fallback/);
});

test('empty AI reply is converted to safe member response',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/empty_ai_reply_safe_fallback/);
  assert.match(src,/fallback:true/);
});

test('AI exceptions still acknowledge member while routing staff',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/AI gagal menentukan jawaban/);
  assert.match(src,/safeHoldingReplyForIntent\(intent,'error'\)/);
  assert.match(src,/sent:true,reply,fallback:true/);
});

test('required Telegram delivery failure no longer leaves member silent',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('if(requireTelegramDelivery && !tgResult?.ok)');
  const block=src.slice(start,start+1300);
  assert.match(block,/sendAndStore\(livechat,chatId,fallback,intent\)/);
  assert.match(block,/telegramPending:true/);
});

test('Human Takeover still prevents AI from replying',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/if \(await db\.isHumanTakeover\(chatId\)\) return \{skipped:'human_takeover'\}/);
});
