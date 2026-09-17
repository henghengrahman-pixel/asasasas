import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const engine=fs.readFileSync(new URL('../src/engine.js', import.meta.url),'utf8');

test('WD holding after Telegram uses requested processing template',()=>{
  assert.match(engine,/const WD_PROCESSING_REPLY='Withdraw bosku sedang kami proses ya 😊🙏\\nMohon ditunggu beberapa saat\. Jika bosku ingin meninggalkan akun terlebih dahulu juga tidak masalah, withdraw tetap akan kami proses sampai selesai ya bosku ☺️❤️'/);
  assert.match(engine,/const WD_WAITING_STAFF_REPLY=WD_PROCESSING_REPLY;/);
});
