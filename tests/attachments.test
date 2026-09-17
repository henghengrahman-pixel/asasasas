import test from 'node:test';
import assert from 'node:assert/strict';
import { extractChatEvents } from '../src/livechat.js';

test('extracts image attachment event',()=>{
  const chat={threads:[{id:'t1',events:[{id:'e1',type:'file',author_type:'customer',created_at:'2026-09-07T10:00:00Z',file:{url:'https://cdn.example.com/proof.jpg',content_type:'image/jpeg',name:'proof.jpg'}}]}]};
  const ev=extractChatEvents(chat);
  assert.equal(ev.length,1);
  assert.equal(ev[0].attachments.length,1);
  assert.equal(ev[0].attachments[0].isImage,true);
  assert.match(ev[0].text,/gambar/i);
});

test('keeps image attachment alongside text',()=>{
  const chat={threads:[{id:'t1',events:[{id:'e1',type:'message',text:'bukti ini bos',author_type:'customer',created_at:'2026-09-07T10:00:00Z',attachments:[{url:'https://cdn.example.com/proof.png',mime_type:'image/png'}]}]}]};
  const ev=extractChatEvents(chat);
  assert.equal(ev[0].text,'bukti ini bos');
  assert.equal(ev[0].attachments[0].isImage,true);
});
