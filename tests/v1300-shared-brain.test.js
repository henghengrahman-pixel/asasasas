import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const config=fs.readFileSync(new URL('../src/config.js',import.meta.url),'utf8');
const env=fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8');

test('shared brain has a dedicated Postgres connection with DATABASE_URL fallback',()=>{
  assert.match(config,/brainDatabaseUrl:\s*process\.env\.BRAIN_DATABASE_URL\s*\|\|\s*process\.env\.DATABASE_URL/);
  assert.match(db,/export const brainPool/);
  assert.match(env,/^BRAIN_DATABASE_URL=/m);
});

test('all six AI sources are read from shared brain and injected into engine',()=>{
  assert.match(db,/brainPool\.query\(`SELECT category,rule_type,content FROM ai_rules/);
  assert.match(db,/brainPool\.query\(`SELECT id,category,title,content,updated_at FROM knowledge_base/);
  assert.match(db,/brainPool\.query\(`SELECT source_id,shortcut,title,category,content,tags,scope,source_kind,response_mode,updated_at FROM livechat_canned_responses/);
  assert.match(db,/brainPool\.query\(`SELECT \* FROM bot_promo_rules/);
  assert.match(db,/brainPool\.query\(`SELECT \* FROM bot_important_info/);
  assert.match(db,/brainPool\.query\(`SELECT \* FROM learning_examples WHERE status='APPROVED'/);
  for(const fn of ['getRules','getRelevantKnowledge','getRelevantPromoRules','getRelevantImportantInfo','getRelevantCanned','getRelevantLearning','getAutoHistoryLearning','getHumanStyleExamples']){
    assert.ok(engine.includes(`db.${fn}(`),`engine missing ${fn}`);
  }
});

test('runtime Telegram and human bridge remain on isolated runtime pool',()=>{
  assert.match(db,/export async function getTelegramSettingsInternal\(\)[\s\S]*?pool\.query/);
  assert.match(db,/export async function getHumanRequest\(id\)[\s\S]*?pool\.query/);
  assert.match(db,/CREATE TABLE IF NOT EXISTS human_bridge_tickets/);
  assert.doesNotMatch(db,/brainPool\.query\(`SELECT[^`]*human_bridge_tickets/);
});

test('Belajar dari CS crosses runtime history to shared brain without cross-db SQL join',()=>{
  const start=db.indexOf('export async function backfillHumanLearning(limit=5000,{maxRuntimeMs=0}={})');
  const end=db.indexOf('export async function backfillHumanLearningAll',start);
  const block=db.slice(start,end);
  assert.match(block,/FROM messages m/);
  assert.match(block,/brainPool\.query\(`SELECT chat_id,source_event_id FROM learning_examples/);
  assert.doesNotMatch(block,/LEFT JOIN learning_examples/);
  assert.match(block,/learning_backfill_cursor/);
});

test('admin Knowledge and AI Rules endpoints write to shared brain',()=>{
  assert.match(server,/api\/rules[\s\S]*?brainPool\.query/);
  assert.match(server,/api\/knowledge[\s\S]*?brainPool\.query/);
  assert.match(server,/brainDb/);
});
