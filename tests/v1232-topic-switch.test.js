import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {detectIntent} from '../src/normalizer.js';

test('v1.23.2 exact WD complaint from screenshot is WITHDRAW, never deposit',()=>{
  assert.equal(detectIntent('rusli93 proses wd ga masuk2'),'WITHDRAW_PROBLEM');
  assert.equal(detectIntent('proses wd ga masuk2'),'WITHDRAW_PROBLEM');
  assert.notEqual(detectIntent('proses wd ga masuk2'),'DEPOSIT_PROBLEM');
});

test('v1.23.2 fresh operational topic overrides stale conversation workflow',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/OPERATIONAL_TOPIC_SWITCH/);
  assert.match(s,/fresh!==workflowIntent/);
  assert.match(s,/clearConversationWorkflow\(chatId\)/);
  const switchAt=s.indexOf('OPERATIONAL_TOPIC_SWITCH');
  const staleDepositReturn=s.indexOf("if(wfType==='DEPOSIT_VERIFY') return 'DEPOSIT_PROBLEM'",switchAt);
  assert.ok(switchAt>=0 && staleDepositReturn>switchAt,'fresh topic switch must run before stale deposit workflow return');
});
