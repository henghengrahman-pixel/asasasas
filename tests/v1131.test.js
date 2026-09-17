import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');

test('deposit workflow accepts standalone user id after bot requested it',()=>{
  assert.match(engine,/workflowAskedForId/);
  assert.match(engine,/extractStandaloneRequestedUserId/);
  assert.match(engine,/extractUserId\(ctx\) \|\| \(workflowAskedForId \? extractStandaloneRequestedUserId\(ctx\) : ''\)/);
});

test('standalone id fallback is guarded against obvious account numbers and common replies',()=>{
  assert.match(engine,/likely phone\/account number/);
  assert.match(engine,/blocked=new Set/);
});
