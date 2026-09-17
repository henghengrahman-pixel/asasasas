import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProDecision } from '../src/response-validator.js';
import { normalizeBrain } from '../src/brain.js';

test('pro gate blocks repeated question',()=>{
  const d=validateProDecision({decision:{action:'ASK_INFO',confidence:.9,reply:'Boleh kirim User ID akun bosku?'},history:[{sender_type:'ai',text:'Boleh kirim user ID akun bosku?'}],brain:{missingInfo:['user id']}});
  assert.equal(d.action,'ASK_HUMAN');
});

test('pro gate refuses asking known user id again',()=>{
  const d=validateProDecision({decision:{action:'ASK_INFO',confidence:.9,reply:'Boleh kirim User ID akun bosku?'},brain:{missingInfo:['lainnya'],knownFacts:['User ID member: HOKI123']}});
  assert.equal(d.action,'ASK_HUMAN');
});

test('pro gate allows confident normal reply',()=>{
  const d=validateProDecision({decision:{action:'AUTO_REPLY',confidence:.95,reply:'Baik bosku, berikut link akses terbaru.'},brain:{},intent:'LINK_ACCESS',hasKnowledge:true});
  assert.equal(d.action,'AUTO_REPLY');
});

test('brain keeps professional structured case fields',()=>{
  const b=normalizeBrain({primary_intent:'deposit_problem',status:'waiting_human',expected_reply:'hasil verifikasi staff',actions_done:['proof_received','ticket_sent'],resolved:false});
  assert.equal(b.primaryIntent,'DEPOSIT_PROBLEM');
  assert.equal(b.status,'WAITING_HUMAN');
  assert.deepEqual(b.actionsDone,['proof_received','ticket_sent']);
});
