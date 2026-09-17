import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../src/human-bridge.js', import.meta.url),'utf8');

test('v1.23.1 callback always ACKs before slow ticket/LiveChat work',()=>{
  const ack=src.indexOf("answerCallbackQuery(q.id,'Sedang diproses…')");
  const lookup=src.indexOf('getBridgeTicketById(m[1])');
  assert.ok(ack>=0,'callback ACK missing');
  assert.ok(lookup>ack,'ticket lookup must happen after immediate ACK');
});

test('v1.23.1 unauthorized Telegram operator also gets callback ACK',()=>{
  assert.match(src,/if\(!authorizedTelegramUser\(q\.from\)\)\{[\s\S]*?answerCallbackQuery\(q\.id,'Akun Telegram ini belum diizinkan\.'/);
});
