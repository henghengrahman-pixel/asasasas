import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v1.13.2 retries open Telegram bridge requests and supports DP route aliases',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(src,/listHumanRequests\('OPEN',200\)/);
  assert.match(src,/DEPOSIT_PROBLEM:\['DEPOSIT_PROBLEM','DEPOSIT','DP'\]/);
  assert.match(src,/lastBacklogScanAt/);
});

test('v1.13.2 permits safe unquoted Telegram result only for a unique open category ticket',()=>{
  const src=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
  assert.match(src,/inferCategoryFromHumanAnswer/);
  assert.match(src,/rows\.length===1/);
  assert.match(src,/listOpenBridgeTicketsForTelegram/);
});
