import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeBrain, applyBrainGate } from '../src/brain.js';

test('brain normalizes case state',()=>{
  const b=normalizeBrain({goal:'reset_password',stage:'collect_data',known_facts:['bank dana'],missing_info:['nomor rekening'],sentiment:'kesal',risk:'high'},'GENERAL');
  assert.equal(b.goal,'RESET_PASSWORD');
  assert.equal(b.stage,'COLLECT_DATA');
  assert.equal(b.risk,'HIGH');
  assert.deepEqual(b.missingInfo,['nomor rekening']);
});

test('contradiction gate forces ask human',()=>{
  const d=applyBrainGate({intent:'GENERAL',decision:{action:'AUTO_REPLY',reply:'asal'},brain:{contradictions:['nominal berbeda'],risk:'LOW'},hasKnowledge:true});
  assert.equal(d.action,'ASK_HUMAN'); assert.equal(d.reply,'');
});

test('high risk without verified source cannot auto reply',()=>{
  const d=applyBrainGate({intent:'WITHDRAW_PROBLEM',decision:{action:'AUTO_REPLY',reply:'sudah masuk'},brain:{risk:'HIGH'},hasKnowledge:false});
  assert.equal(d.action,'ASK_HUMAN');
});

test('engine digests old history from oldest forward and persists brain',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(engine,/getContextSlice\(chatId,digested,take\)/);
  assert.match(engine,/saveConversationBrain/);
  assert.match(engine,/applyBrainGate/);
});

test('learning backfill scans stored CS history in batches',()=>{
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(db,/backfillHumanLearningAll/);
  assert.match(server,/createLearningWorker/);
  assert.match(server,/batchSize:config\.learningBatchSize/);
});
