
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractRequestedUserIdFromText, extractUserIdFromText } from '../src/user-id.js';

test('common shorthand complaint words are never parsed as user ID',()=>{
  assert.equal(extractRequestedUserIdFromText('Deposit saya blm masuk bosku'),'');
  assert.equal(extractRequestedUserIdFromText('deposit saya msh pending'),'');
  assert.equal(extractRequestedUserIdFromText('blm masuk bos'),'');
});

test('deposit flow asks ID first when ID and proof are both missing',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('// Deposit complaint:');
  const end=src.indexOf('// Reset password:',start);
  const block=src.slice(start,end);
  assert.match(block,/WAITING_ID/);
  assert.match(block,/User ID akunnya dulu/);
  assert.match(block,/WAITING_PROOF/);
  assert.match(block,/User ID-nya sudah kami terima/);
  assert.doesNotMatch(block,/DEPOSIT_VERIFY','COLLECTING'/);
});

test('free-form requested ID parser is only allowed while WAITING_ID',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('function currentCaseUserId');
  const end=src.indexOf('function extractOperationalAmount',start);
  const block=src.slice(start,end);
  assert.match(block,/const waitingId=\/WAITING_ID\//);
  assert.match(block,/if\(waitingId\)/);
  assert.match(block,/extractRequestedUserIdFromText\(text\)/);
});

test('explicit user ID is still recognized immediately',()=>{
  assert.equal(extractUserIdFromText('User ID: Manir79'),'Manir79');
  assert.equal(extractUserIdFromText('ID Manir79'),'Manir79');
});
