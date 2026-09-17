import test from 'node:test';
import assert from 'node:assert/strict';
import { daypart, greetingText } from '../src/greeting.js';

test('daypart follows configured timezone',()=>{
  assert.equal(daypart(new Date('2026-09-07T00:00:00Z'),'Asia/Jakarta'),'pagi');
  assert.equal(daypart(new Date('2026-09-07T05:00:00Z'),'Asia/Jakarta'),'siang');
  assert.equal(daypart(new Date('2026-09-07T09:00:00Z'),'Asia/Jakarta'),'sore');
  assert.equal(daypart(new Date('2026-09-07T14:00:00Z'),'Asia/Jakarta'),'malam');
});
test('greeting is natural and contains daypart',()=>{
  const s=greetingText(new Date('2026-09-07T00:00:00Z'),'Asia/Jakarta');
  assert.match(s,/Selamat pagi/); assert.match(s,/bosku/);
});
