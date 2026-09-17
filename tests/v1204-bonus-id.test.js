import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUserIdFromText } from '../src/user-id.js';

test('bonus/member ID parser accepts comma-separated forms',()=>{
  assert.equal(extractUserIdFromText('Id, Syafri01'),'Syafri01');
  assert.equal(extractUserIdFromText('ID, Syafri01'),'Syafri01');
  assert.equal(extractUserIdFromText('id: Syafri01'),'Syafri01');
  assert.equal(extractUserIdFromText('id. Syafri01'),'Syafri01');
});

test('bonus/member ID parser accepts compact ID prefix',()=>{
  assert.equal(extractUserIdFromText('IdSyafri01'),'Syafri01');
  assert.equal(extractUserIdFromText('IDSYAFRI01'),'SYAFRI01');
});
