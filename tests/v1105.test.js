import test from 'node:test';
import assert from 'node:assert/strict';
import { inferResetAccountData, resetMissing } from '../src/reset-logic.js';
function row(text){ return {sender_type:'customer',text,attachments:[]}; }
test('reset recognizes hyphenated account/phone number',()=>{
  let data={};
  data=inferResetAccountData([row('Lupa password'),row('Aris Budiyono')],data);
  data=inferResetAccountData([row('DANA')],data);
  data=inferResetAccountData([row('0838-2144-8307')],data);
  assert.equal(data.name,'Aris Budiyono');
  assert.equal(data.type,'dana');
  assert.equal(data.no,'083821448307');
  assert.deepEqual(resetMissing(data),[]);
});
test('reset recognizes spaced and dotted account number',()=>{
  const a=inferResetAccountData([row('BCA'),row('Nama rekening Karni'),row('0838 2144 8307')],{});
  assert.equal(a.no,'083821448307');
  const b=inferResetAccountData([row('no rek: 0838.2144.8307')],{});
  assert.equal(b.no,'083821448307');
});
