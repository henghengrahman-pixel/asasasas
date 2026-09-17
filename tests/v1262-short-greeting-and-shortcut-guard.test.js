
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeText, detectIntent } from '../src/normalizer.js';

test('short Indonesian greetings are normalized and classified deterministically',()=>{
  assert.equal(normalizeText('slmt mlm bos'),'selamat malam bos');
  assert.equal(detectIntent('slmt mlm bos'),'GREETING');
  assert.equal(detectIntent('slmt pg bos'),'GREETING');
  assert.equal(detectIntent('malem bosku'),'GREETING');
});

test('engine handles explicit greetings before AI and blocks shortcut leakage',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/explicit_member_greeting/);
  assert.match(src,/explicitGreetingReply/);
  assert.match(src,/sanitizeOutboundMemberText/);
  assert.match(src,/Internal canned\/shortcut identifiers are control data/);
  assert.match(src,/\^#\[a-z0-9_/i);
});

test('shortcut leak has a human-safe fallback instead of sending the token',()=>{
  const src=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(src,/Bisa dijelaskan sedikit kendalanya supaya kami bantu dengan tepat/);
  assert.doesNotMatch(src,/sendMessage\(chatId,\s*['"]#mak['"]/i);
});
