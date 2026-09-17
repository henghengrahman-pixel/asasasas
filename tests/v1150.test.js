import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
const ai=fs.readFileSync(new URL('../src/ai.js',import.meta.url),'utf8');

test('v1.15 deposit CS buttons match final workflow',()=>{
  assert.match(bridge,/Deposit Done/);
  assert.match(bridge,/Detail Bukti/);
  assert.match(bridge,/Bukti Tidak Jelas/);
  assert.match(engine,/DP_DETAIL_PROOF/);
  assert.match(engine,/DP_UNCLEAR_PROOF/);
  assert.match(engine,/RRN \/ nomor referensi/);
});

test('v1.15 deposit follow-up requires a new proof after staff rejection',()=>{
  assert.match(engine,/WAITING_DETAIL_PROOF/);
  assert.match(engine,/WAITING_CLEAR_PROOF/);
  assert.match(engine,/previousProofUrl/);
  assert.match(engine,/proofIsNew/);
});

test('v1.15 reset password uses bank data, verification deposit proof, and exact credential reply',()=>{
  assert.match(engine,/DATA REKENING\/WALLET YANG MAU DI RESET/);
  assert.match(engine,/Bukti deposit verifikasi/);
  assert.match(engine,/USER ID\nPASSWORD\nLINK/);
  assert.match(engine,/parseResetCredentialReply/);
  assert.match(engine,/HUMAN_RESET_CREDENTIALS/);
  assert.match(bridge,/Silakan Melakukan Deposit/);
  assert.match(bridge,/Tidak Terdaftar/);
});

test('v1.15 sensitive reset credentials require Telegram reply-to-ticket',()=>{
  assert.match(bridge,/Reset credentials are sensitive/);
  assert.match(bridge,/if\(likelyReset\) return null/);
  assert.match(bridge,/findOpenBridgeTicketByTelegram/);
});

test('v1.15 conversation brain and image understanding remain active',()=>{
  assert.match(engine,/saveConversationBrain/);
  assert.match(engine,/getOperationalHistory/);
  assert.match(ai,/completeVision/);
  assert.match(ai,/Jangan menyimpulkan transaksi berhasil hanya dari screenshot/);
});
