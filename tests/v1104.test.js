import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeCategory, isTelegramBridgeCategory } from '../src/bridge-category.js';

test('v1.10.4 deposit problems route to Telegram bridge',()=>{
  assert.equal(bridgeCategory('DEPOSIT_PROBLEM'),'DEPOSIT_PROBLEM');
  assert.equal(isTelegramBridgeCategory('DEPOSIT_PROBLEM'),true);
});

test('v1.10.4 source includes stateful ID + proof DP flow and exact success wording',async()=>{
  const fs=await import('node:fs/promises');
  const engine=await fs.readFile(new URL('../src/engine.js',import.meta.url),'utf8');
  assert.match(engine,/workflow_type==='DEPOSIT_VERIFY'/);
  assert.match(engine,/proofUrl/);
  assert.match(engine,/telegram:true/);
  assert.match(engine,/Deposit bosku sudah berhasil kami proses ya/);
});
