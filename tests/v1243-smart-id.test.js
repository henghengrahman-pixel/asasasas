import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequestedUserIdFromText } from '../src/user-id.js';

test('waiting-id parser extracts member ID embedded in bonus sentence',()=>{
  assert.equal(extractRequestedUserIdFromText('Bonus deposit Watini01'),'Watini01');
  assert.equal(extractRequestedUserIdFromText('claim bonus harian BASRET'),'BASRET');
  assert.equal(extractRequestedUserIdFromText('WD rusli93'),'rusli93');
  assert.equal(extractRequestedUserIdFromText('member JEREENG'),'JEREENG');
});

test('waiting-id parser does not mistake workflow words for ID',()=>{
  assert.equal(extractRequestedUserIdFromText('bonus deposit harian ya bos'),'');
  assert.equal(extractRequestedUserIdFromText('belum masuk bosku'),'');
  assert.equal(extractRequestedUserIdFromText('mau claim bonus deposit'),'');
  assert.equal(extractRequestedUserIdFromText('rekening dana limit'),'');
});

test('waiting-id parser avoids ambiguous free-form sentences',()=>{
  assert.equal(extractRequestedUserIdFromText('tolong cek akun teman saya nanti malam'),'');
});
