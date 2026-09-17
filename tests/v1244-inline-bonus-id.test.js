import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractRequestedUserIdFromText } from '../src/user-id.js';

test('specific bonus first message extracts inline member ID',()=>{
  assert.equal(extractRequestedUserIdFromText('Bonus deposit harian Safa01'),'Safa01');
  assert.equal(extractRequestedUserIdFromText('Bonus deposit Watini01'),'Watini01');
  assert.equal(extractRequestedUserIdFromText('claim bonus harian BASRET'),'BASRET');
});

test('specific bonus engine always uses inline requested-ID parser on first message',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js', import.meta.url),'utf8');
  const marker='const uid=extractUserIdFromText(text) || extractRequestedUserIdFromText(text) || extractUserId(ctx)';
  assert.equal(src.includes(marker),true);
  assert.equal(src.includes("(wf?.workflow_type==='BONUS_CLAIM' ? extractRequestedUserIdFromText(text) : '') || extractUserId(ctx)"),false);
});
