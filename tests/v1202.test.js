import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractUserIdFromText } from '../src/user-id.js';

test('v1.20.2 parses user id with dot punctuation',()=>{
  assert.equal(extractUserIdFromText('id. CHAGE'),'CHAGE');
  assert.equal(extractUserIdFromText('ID: CHAGE'),'CHAGE');
  assert.equal(extractUserIdFromText('id CHAGE'),'CHAGE');
});

test('v1.20.2 WD waiting-id continuation accepts standalone requested ID',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/workflow_type==='WD_CHECK'[\s\S]{0,500}extractRequestedUserIdFromText\(text\)/);
});

test('v1.20.2 WD requires telegram before member acknowledgement',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const wd=s.slice(s.indexOf("workflow_type==='WD_CHECK'"), s.indexOf('// Informational bonus questions'));
  assert.match(wd,/requireTelegramDelivery:true/);
  assert.match(wd,/holding:WD_WAITING_STAFF_REPLY/);
  assert.doesNotMatch(wd,/holding:WD_PROCESSING_REPLY/);
});
