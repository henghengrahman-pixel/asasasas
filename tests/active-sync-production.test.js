import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LiveChatClient } from '../src/livechat.js';

function pagedClient(total,{duplicate=false,repeatedCursor=false,malformedCursor=false,transientFirst=false}={}){
  const pageSize=100;
  const pages=[];
  for(let start=0;start<total;start+=pageSize){
    const items=[];
    for(let i=start;i<Math.min(total,start+pageSize);i++) items.push({id:`chat-${i}`,is_followed:true,last_thread_summary:{active:true}});
    pages.push(items);
  }
  if(!pages.length) pages.push([]);
  const c=new LiveChatClient({base:'http://unit.test',accountId:'a',pat:'p'});
  let transientUsed=false;
  const bodies=[];
  c.call=async(action,body={})=>{
    assert.equal(action,'list_chats');
    bodies.push(body);
    if(transientFirst && !transientUsed){transientUsed=true;const e=new Error('RATE_LIMIT');e.status=429;throw e;}
    let idx=0;
    if(body.page_id){
      const m=String(body.page_id).match(/^p(\d+)$/);
      idx=m?Number(m[1])-1:0;
    }
    const items=[...(pages[idx]||[])];
    if(duplicate && idx===1 && pages[0]?.[0]) items.unshift(pages[0][0]);
    const out={chats_summary:items};
    if(idx<pages.length-1) out.next_page_id=`p${idx+2}`;
    if(repeatedCursor && idx===1) out.next_page_id='p2';
    if(malformedCursor && idx===0) out.next_page_id={bad:true};
    return out;
  };
  return {c,bodies};
}

for(const total of [50,100,101,500,1000,5000]){
  test(`full pagination returns all ${total} chats without artificial cap`,async()=>{
    const {c,bodies}=pagedClient(total);
    const out=await c.listChats({paginate:true});
    assert.equal(out._normalizedChats.length,total);
    assert.equal(out._inventoryComplete,true);
    assert.equal(out._pagesFetched,Math.max(1,Math.ceil(total/100)));
    for(const body of bodies.slice(1)) assert.deepEqual(Object.keys(body),['page_id']);
  });
}

test('fast path reads only first provider page and marks inventory partial',async()=>{
  const {c,bodies}=pagedClient(5000);
  const out=await c.listChats({paginate:false});
  assert.equal(out._normalizedChats.length,100);
  assert.equal(out._pagesFetched,1);
  assert.equal(out._inventoryComplete,false);
  assert.equal(out._paginationStopReason,'fast_path');
  assert.equal(bodies.length,1);
});

test('duplicate chat ids across pages are deduplicated',async()=>{
  const {c}=pagedClient(101,{duplicate:true});
  const out=await c.listChats({paginate:true});
  assert.equal(out._normalizedChats.length,101);
  assert.equal(new Set(out._normalizedChats.map(x=>x.id)).size,101);
});

test('repeated page id stops safely and snapshot is not complete',async()=>{
  const {c,bodies}=pagedClient(500,{repeatedCursor:true});
  const out=await c.listChats({paginate:true});
  assert.equal(out._inventoryComplete,false);
  assert.equal(out._paginationStopReason,'repeated_page_id');
  assert.ok(bodies.length<10);
});

test('malformed next page id is rejected without looping',async()=>{
  const {c,bodies}=pagedClient(500,{malformedCursor:true});
  const out=await c.listChats({paginate:true});
  assert.equal(out._inventoryComplete,false);
  assert.equal(out._paginationStopReason,'malformed_next_page_id');
  assert.equal(bodies.length,1);
});

test('missing next page means authoritative final page',async()=>{
  const {c}=pagedClient(50);
  const out=await c.listChats({paginate:true});
  assert.equal(out._inventoryComplete,true);
  assert.equal(out._paginationStopReason,'end_of_pages');
});

test('transient list failure is retried with bounded retry',async()=>{
  const {c,bodies}=pagedClient(50,{transientFirst:true});
  const out=await c.listChats({paginate:true,retries:2});
  assert.equal(out._inventoryComplete,true);
  assert.equal(out._normalizedChats.length,50);
  assert.equal(bodies.length,2);
});

test('poller source keeps fast path separate from authoritative deep reconciliation',()=>{
  const src=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  assert.match(src,/listChats\(\{paginate:false\}\)/);
  assert.match(src,/listChats\(\{paginate:true,maxPages:10000,retries:2\}\)/);
  assert.match(src,/if\(data\?\._inventoryComplete!==true\)/);
  assert.match(src,/reconcileInboxVisibilityAuthoritative\(activeIds\)/);
  const fast=src.slice(src.indexOf('export async function syncOnce'),src.indexOf('async function mapBounded'));
  assert.doesNotMatch(fast,/reconcileInboxVisibilityAuthoritative/);
});

test('poller startup runs immediately and tick is recorded before async dependencies',()=>{
  const src=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  const tick=src.indexOf('lastTick=new Date(syncStarted).toISOString()');
  const setting=src.indexOf("db.getSetting('system_enabled',true)");
  assert.ok(tick>=0 && tick<setting);
  assert.match(src,/void run\(\);/);
  assert.match(src,/if \(inFlight\) return \{skipped:'already_running'\}/);
  assert.match(src,/lastSuccess=new Date\(\)\.toISOString\(\)/);
});

test('deep generation has stale response protection and completes only full snapshots',()=>{
  const src=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
  assert.match(src,/generation!==deepState\.generation/);
  assert.match(src,/deepState\.completedGeneration=generation/);
  assert.match(src,/deepState\.inventoryComplete=true/);
  assert.match(src,/deepState\.inventoryComplete=false/);
});

test('authoritative DB reconciliation is separate from grace-based partial reconciliation',()=>{
  const src=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(src,/export async function reconcileInboxVisibilityAuthoritative/);
  assert.match(src,/WHERE visible_in_inbox=true AND NOT \(chat_id = ANY\(\$1::text\[\]\)\) RETURNING chat_id/);
});

test('permanent requester 403 is cached and does not retry deactivate_chat',async()=>{
  const c=new LiveChatClient({base:'http://unit.test',accountId:'a',pat:'p'});
  let deactivate=0;
  c.call=async(action)=>{
    if(action==='get_chat') return {id:'x',last_thread:{active:true}};
    if(action==='deactivate_chat'){deactivate++;const e=new Error('LIVECHAT_403: Requester is not user of the chat');e.status=403;throw e;}
    throw new Error(`unexpected ${action}`);
  };
  await assert.rejects(()=>c.endChat('x'),e=>e.status===403 && e.nonRetryable===true);
  await assert.rejects(()=>c.endChat('x'),e=>e.status===403 && e.nonRetryable===true && e.cached===true);
  assert.equal(deactivate,1);
});
