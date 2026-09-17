import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');

test('v1.25.0 WD problem must request current-case ID before Telegram',()=>{
  const wd=engine.slice(engine.indexOf("if(wf?.workflow_type==='WD_CHECK'"), engine.indexOf('// Informational bonus questions'));
  assert.match(wd,/extractUserIdFromText\(text\) \|\| extractRequestedUserIdFromText\(text\)/);
  assert.doesNotMatch(wd,/const uid=extractUserIdFromText\(text\)[^;]*extractUserId\(ctx\)/);
  assert.match(wd,/Boleh kirim ID akunnya ya bosku/);
  assert.match(wd,/requireTelegramDelivery:true/);
});

test('v1.25.0 WD holding reply is sent only after Telegram delivery path',()=>{
  assert.match(engine,/const WD_WAITING_STAFF_REPLY=WD_PROCESSING_REPLY;/);
  const wd=engine.slice(engine.indexOf("if(wf?.workflow_type==='WD_CHECK'"), engine.indexOf('// Informational bonus questions'));
  assert.match(wd,/holding:WD_WAITING_STAFF_REPLY/);
});

test('v1.25.0 pure iya while WD waits human gets thank-you waiting reply',()=>{
  assert.match(engine,/const WD_ACK_WAIT_REPLY='Terima kasih sudah mau menunggu bosku 😊'/);
  assert.match(engine,/waitingWd \? WD_ACK_WAIT_REPLY : acknowledgementReply\(\)/);
});
