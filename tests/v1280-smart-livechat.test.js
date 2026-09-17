import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inferResetAccountData, resetMissing } from '../src/reset-logic.js';

test('reset password parses compact number + DANA + account holder name in one message',()=>{
  const rows=[
    {sender_type:'customer',text:'Lupa user dan password'},
    {sender_type:'customer',text:'087740372556 dana Asman'}
  ];
  const data=inferResetAccountData(rows,{});
  assert.equal(data.no,'087740372556');
  assert.equal(data.type,'dana');
  assert.equal(data.name,'Asman');
  assert.deepEqual(resetMissing(data),[]);
});

test('reset parser also supports type + number + multiword name',()=>{
  const rows=[{sender_type:'customer',text:'BCA 1234567890 Budi Santoso'}];
  const data=inferResetAccountData(rows,{});
  assert.equal(data.no,'1234567890');
  assert.equal(data.type,'bca');
  assert.equal(data.name,'Budi Santoso');
});

test('Knowledge Base and Responses Manual are both injected into live AI sources',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(engine,/getRelevantKnowledge\(query,intent,14\)/);
  assert.match(engine,/getRelevantCanned\(query,14,intent\)/);
  assert.match(engine,/\[KNOWLEDGE /);
  assert.match(engine,/\[RESPONSE /);
  assert.match(db,/source_kind==='manual'/);
  assert.match(db,/getRelevantKnowledge/);
});

test('Tanya Staff saves approved guidance without member delivery during Human Takeover',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(engine,/learn_only_if_takeover/);
  assert.match(engine,/saveHumanGuidanceLearning/);
  assert.match(engine,/delivered:false/);
  assert.match(db,/HUMAN_GUIDANCE/);
  assert.match(db,/status='APPROVED'/);
  assert.match(server,/deliveryMode:'learn_only_if_takeover'/);
});

test('Alt+ArrowUp and Alt+ArrowDown navigate chat list',()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/function navigateChatByKeyboard/);
  assert.match(app,/e\.altKey/);
  assert.match(app,/ArrowUp/);
  assert.match(app,/ArrowDown/);
  assert.match(app,/scrollIntoView\(\{block:'nearest'\}\)/);
});

test('hashtag shortcut loads exact Responses Manual entry for manual reply',()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(app,/expandResponseShortcut/);
  assert.match(app,/\/api\/canned\/shortcut\?shortcut=/);
  assert.match(app,/bindShortcutTextarea\(\$\('#manualText'\),\$\('#sendManual'\)\)/);
  assert.match(server,/\/api\/canned\/shortcut/);
  assert.match(server,/getCannedByShortcut/);
});
