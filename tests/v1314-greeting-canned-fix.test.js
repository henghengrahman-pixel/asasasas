import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('authoritative system welcome banner bypasses stale previous-session human takeover guard',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('export async function processGreetingTrigger');
  const end=src.indexOf('function isAuthoritativeWelcomeBanner',start);
  const block=src.slice(start,end);
  assert.match(block,/const exactWelcomeBanner=isAuthoritativeWelcomeBanner\(text\)/);
  assert.match(block,/if\(!exactWelcomeBanner && await db\.isHumanTakeover\(chatId\)\)/);
  assert.ok(block.indexOf('const exactWelcomeBanner=') < block.indexOf('db.isHumanTakeover(chatId)'));
  assert.match(block,/beginNewConversationSession\(chatId/);
  assert.match(block,/greetingText\(new Date\(\),config\.timezone\)/);
});

test('canned shortcut endpoint supports live query and empty query for # menu',()=>{
  const src=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const start=src.indexOf("app.get('/api/canned/shortcut'");
  const end=src.indexOf("app.post('/api/canned/manual'",start);
  const block=src.slice(start,end);
  assert.match(block,/req\.query\?\.q/);
  assert.match(block,/searchCannedResponses\(q,limit\)/);
  assert.doesNotMatch(block,/listCannedResponses\(1000\)/);
  assert.match(block,/items:ranked/);
});

test('conversation composer asks shortcut endpoint and shows up to 20 matches',()=>{
  const src=fs.readFileSync(new URL('../public/assets/js/pages/conversations.js',import.meta.url),'utf8');
  assert.match(src,/\/api\/canned\/shortcut\?q=/);
  assert.match(src,/slice\(0,20\)/);
  assert.match(src,/Ketik # untuk shortcut|shortcutMenu/);
});
