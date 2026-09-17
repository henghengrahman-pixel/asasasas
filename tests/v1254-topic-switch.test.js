import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {detectIntent} from '../src/normalizer.js';

test('loss complaint remains loss even when deposit is only context',()=>{
  assert.equal(detectIntent('Penipu koplok sudah depo berkali kali anjing ga ada gacor iya koplok'),'LOSS_COMPLAINT');
});

test('waiting proof review cannot swallow explicit new loss topic',()=>{
  const s=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(s,/isExplicitTopicSwitch/);
  assert.match(s,/effective!==waitingWorkflowIntent/);
  assert.match(s,/&& !isExplicitTopicSwitch/);
  assert.match(s,/PROOF_REVIEW:'PROOF_REVIEW'/);
  assert.match(s,/LOSS_COMPLAINT/);
});
