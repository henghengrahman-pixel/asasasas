
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('hard topic switch compares semantic workflow intent, not raw WD_STATUS type',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/function workflowIntentFromType/);
  assert.match(src,/\['WD_CHECK','WD_STATUS','WD_REPLACEMENT'\]\.includes\(wfType\) \? 'WITHDRAW_PROBLEM'/);
  assert.match(src,/const previousWorkflowIntent=workflowIntentFromType\(workflowBeforeResolve\?\.workflow_type\)\|\|'GENERAL'/);
});

test('WD pending workflow survives repeated member followups',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf("if(wf?.workflow_type==='WD_STATUS'");
  const end=src.indexOf("if(wf?.workflow_type!=='WD_REPLACEMENT'",start);
  const block=src.slice(start,end);
  assert.match(block,/\['PENDING','PENDING_FOLLOWUP'\]/);
  assert.match(block,/setConversationWorkflow\(chatId,\{type:'WD_STATUS',state:'PENDING_FOLLOWUP'/);
  assert.doesNotMatch(block,/clearConversationWorkflow\(chatId\)/);
});

test('customer thread-id changes cannot restart greeting during active operational case',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/activeOperationalCase/);
  assert.match(src,/active_operational_case_customer_event/);
  assert.match(src,/bindGreetingThreadWithoutGreeting/);
});

test('delayed system banner is validated before new-session reset',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const start=src.indexOf('export async function processGreetingTrigger');
  const end=src.indexOf('function criticalHumanFacts',start);
  const block=src.slice(start,end);
  const checkPos=block.indexOf('hasConversationAfterTrigger');
  const resetPos=block.indexOf('beginNewConversationSession');
  assert.ok(checkPos>=0);
  assert.ok(resetPos>checkPos,'session reset must happen only after delayed-banner safety check');
  assert.match(block,/active_case_duplicate_banner_without_thread/);
});

test('WD continuation phrases stay in the active WD case and do not restart collection',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/active_wd_case_continuation_no_restart/);
  assert.match(src,/wdContinuation/);
  assert.match(src,/workflowPreserved:true,continuation:true/);
});
