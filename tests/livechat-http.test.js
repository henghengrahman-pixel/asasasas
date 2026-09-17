import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LiveChatClient } from '../src/livechat.js';

function listen(server){ return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port))); }
function close(server){ return new Promise(resolve=>server.close(resolve)); }

test('mock LiveChat list/get/send integration', async()=>{
  const requests=[];
  const server=http.createServer((req,res)=>{
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      const action=req.url.split('/').pop();
      requests.push({action,auth:req.headers.authorization,body:body?JSON.parse(body):{}});
      res.setHeader('content-type','application/json');
      if(action==='list_chats') return res.end(JSON.stringify({found_chats:1,chats_summary:[{id:'c1',is_followed:true,last_thread_summary:{active:true}}]}));
      if(action==='get_chat') return res.end(JSON.stringify({id:'c1',users:[{id:'u1',type:'customer',name:'Test'}],threads:[{id:'t1',events:[{id:'e1',type:'message',text:'halo',author_id:'u1',author_type:'customer',created_at:new Date().toISOString()}]}]}));
      if(action==='send_event') return res.end(JSON.stringify({event_id:'sent-1'}));
      res.statusCode=404;res.end(JSON.stringify({error:{message:'not found'}}));
    });
  });
  const port=await listen(server);
  try{
    const lc=new LiveChatClient({base:`http://127.0.0.1:${port}/v3.5/agent/action`,accountId:'acc',pat:'pat'});
    const list=await lc.listChats();
    assert.equal(list._normalizedChats.length,1);
    assert.equal(lc.filterInbox(list._normalizedChats).length,1);
    const chat=await lc.getChat('c1');
    assert.equal(chat.id,'c1');
    const sent=await lc.sendMessage('c1','jawab');
    assert.equal(sent.event_id,'sent-1');
    assert.ok(requests.length>=3);
    assert.equal(requests[0].auth,'Basic '+Buffer.from('acc:pat').toString('base64'));
    const sendReq=requests.find(x=>x.action==='send_event');
    assert.ok(sendReq);
    assert.equal(sendReq.body.chat_id,'c1');
    assert.equal(sendReq.body.event.text,'jawab');
  } finally { await close(server); }
});
