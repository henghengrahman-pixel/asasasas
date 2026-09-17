import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const expected='Deposit bosku sudah berhasil kami proses ya 😊🙏 Silakan dicek kembali pada saldo akun bosku. Terima kasih dan selamat bermain, semoga beruntung bosku ^^ ❤️';

test('deposit done member reply uses requested final wording',()=>{
  const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.ok(engine.includes(expected));
  assert.ok(db.includes(expected));
  assert.ok(!engine.includes('Sudah kami proses ya bosku 😊 Silakan dicek kembali saldo/membernya. Terima kasih 🙏'));
  assert.ok(!db.includes('Sudah kami proses ya bosku 😊 Silakan dicek kembali saldo/membernya. Terima kasih 🙏'));
});
