import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient } from '../src/telegram.js';
import { encryptSecret,decryptSecret,maskSecret } from '../src/secure-store.js';

test('Telegram client sends exact chat/topic/reply identifiers',async()=>{
  const old=global.fetch; let call;
  global.fetch=async(url,opt)=>{call={url,opt,body:JSON.parse(opt.body)};return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:77,chat:{id:-100123}}})};};
  try{
    const tg=new TelegramClient('123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef');
    const r=await tg.sendMessage('-100123','ticket',{topicId:'42',replyTo:'55'});
    assert.equal(r.message_id,77); assert.match(call.url,/\/sendMessage$/);
    assert.equal(call.body.chat_id,'-100123'); assert.equal(call.body.message_thread_id,42); assert.equal(call.body.reply_parameters.message_id,55);
  }finally{global.fetch=old;}
});

test('Bot token encryption roundtrip and masking',()=>{
  const token='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef';
  const enc=encryptSecret(token); assert.notEqual(enc,token); assert.equal(decryptSecret(enc),token); assert.ok(maskSecret(token).includes('••••'));
});
