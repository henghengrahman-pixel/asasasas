import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveChatCannedClient } from '../src/canned.js';

test('normalizes canned response list and items',()=>{
  const c=new LiveChatCannedClient({base:'https://example.invalid',accountId:'a',pat:'b'});
  const n=c.normalizeList({canned_responses:[{id:1,shortcut:'#PULSA',text:'Deposit via Pulsa'}]});
  assert.equal(n.source,'canned_responses');
  const x=c.normalizeItem(n.items[0]);
  assert.equal(x.id,'1'); assert.equal(x.shortcut,'#PULSA'); assert.equal(x.text,'Deposit via Pulsa');
});

test('normalizes alternate canned response shapes',()=>{
  const c=new LiveChatCannedClient({base:'https://example.invalid',accountId:'a',pat:'b'});
  const n=c.normalizeList({result:{items:[{response_id:'r2',name:'#DANA',content:'Nomor DANA 0812'}]}});
  assert.equal(n.source,'result.items');
  const x=c.normalizeItem(n.items[0]);
  assert.equal(x.id,'r2'); assert.equal(x.shortcut,'#DANA'); assert.equal(x.text,'Nomor DANA 0812');
});
