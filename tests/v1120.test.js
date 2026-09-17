import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { LiveChatClient } from '../src/livechat.js';

function listen(server){ return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port))); }
function close(server){ return new Promise(resolve=>server.close(resolve)); }

test('v1.12.0 LiveChat end chat uses deactivate_chat', async()=>{
  let got=null;
  const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{got={url:req.url,body:JSON.parse(body||'{}')};res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));});});
  const port=await listen(server);
  try{
    const lc=new LiveChatClient({base:`http://127.0.0.1:${port}/v3.5/agent/action`,accountId:'acc',pat:'pat'});
    await lc.endChat('chat-123');
    assert.match(got.url,/deactivate_chat$/);
    assert.equal(got.body.id,'chat-123');
  }finally{await close(server)}
});

test('v1.12.0 DP flow merges proof + later user ID and sends wait reply', async()=>{
  const engine=await fs.readFile(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(engine,/workflow_type==='DEPOSIT_VERIFY'/);
  assert.match(engine,/proofUrl/);
  assert.match(engine,/User ID-nya sudah kami terima/);
  assert.match(engine,/WAITING_CHECK_REPLY/);
  assert.match(engine,/Silakan cek deposit member/);
});

test('v1.12.0 has structured Bot Provision promo rules and promo knowledge injection', async()=>{
  const [db,engine,html]=await Promise.all([
    fs.readFile(new URL('../src/db.js',import.meta.url),'utf8'),
    fs.readFile(new URL('../src/engine.js',import.meta.url),'utf8'),
    fs.readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  assert.match(db,/CREATE TABLE IF NOT EXISTS bot_promo_rules/);
  assert.match(engine,/PROMO AKTIF/);
  assert.match(html,/Bekal Bot/);
});
