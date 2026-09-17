import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveChatClient } from '../src/livechat.js';

test('normalizes LiveChat chats_summary response', () => {
  const lc = new LiveChatClient({base:'https://example.test', accountId:'a', pat:'b'});
  const data = { chats_summary:[{id:'A'},{id:'B'}], found_chats:2 };
  const n = lc.normalizeChatList(data);
  assert.equal(n.source,'chats_summary');
  assert.equal(n.items.length,2);
  assert.equal(n.items[0].id,'A');
});

test('keeps compatibility with chats response', () => {
  const lc = new LiveChatClient({base:'https://example.test', accountId:'a', pat:'b'});
  const n = lc.normalizeChatList({chats:[{id:'C'}]});
  assert.equal(n.source,'chats');
  assert.equal(n.items.length,1);
});
