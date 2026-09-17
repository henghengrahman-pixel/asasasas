import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectIntent } from '../src/normalizer.js';
import { extractUserIdFromText } from '../src/user-id.js';

test('v1.18.2 bonus claim with inline ID is understood immediately',()=>{
  assert.equal(detectIntent('bosku claim bonus harian id yanid89'),'BONUS_DAILY');
  assert.equal(extractUserIdFromText('bosku claim bonus harian id yanid89'),'yanid89');
  assert.equal(extractUserIdFromText('claim bonus harian id: YANID89'),'YANID89');
  assert.equal(extractUserIdFromText('claim bonus harian userid=yanid89'),'yanid89');
  assert.equal(extractUserIdFromText('claim bonus harian user id yanid89'),'yanid89');
  assert.equal(extractUserIdFromText('claim bonus harian idnya yanid89'),'yanid89');
  assert.equal(extractUserIdFromText('claim bonus harian id nya yanid89'),'yanid89');
});

test('v1.18.2 bonus flow prioritizes current-message ID and accepts standalone requested ID',()=>{
  const eng=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(eng,/extractUserIdFromText\(text\) \|\| extractRequestedUserIdFromText\(text\)/);
  assert.match(eng,/extractStandaloneRequestedUserId\(ctx\)/);
  assert.match(eng,/claim bonus \$\{String\(bonusType/);
});

test('v1.18.2 account ID parser does not treat generic bonus words as an ID',()=>{
  assert.equal(extractUserIdFromText('claim bonus harian id bonus'),'');
  assert.equal(extractUserIdFromText('id akun'),'');
});
