import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveChatClient, extractChatEvents } from '../src/livechat.js';

test('normalize get_chat wrapper',()=>{
  const c=new LiveChatClient({base:'x',accountId:'a',pat:'b'});
  const chat=c.normalizeChatDetail({chat:{id:'1',threads:[]}}, {id:'1',users:[{type:'customer',name:'A'}]});
  assert.equal(chat.id,'1');
  assert.equal(chat._detailSource,'chat');
  assert.equal(chat.users[0].name,'A');
});

test('extract text from common LiveChat shapes',()=>{
  const chat={threads:[{id:'t1',events:[
    {id:'e1',type:'message',text:'halo',author_id:'c1',created_at:'2026-01-01T00:00:00Z'},
    {id:'e2',type:'message',content:{text:'bos'},author:{id:'a1',type:'agent'},created_at:'2026-01-01T00:00:01Z'}
  ]}]};
  const e=extractChatEvents(chat);
  assert.equal(e.length,2);
  assert.equal(e[0].text,'halo');
  assert.equal(e[1].text,'bos');
  assert.equal(e[1].authorType,'agent');
});
