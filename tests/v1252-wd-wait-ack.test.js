import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js', import.meta.url),'utf8');

test('WD waiting acknowledgement recognizes natural wait phrases without repeating WD template',()=>{
  assert.match(engine,/function isWaitingAcknowledgementText/);
  assert.match(engine,/waitingWd && isWaitingAcknowledgementText\(text\)/);
  assert.match(engine,/const WD_ACK_WAIT_REPLY='Terima kasih sudah mau menunggu bosku 😊'/);
});

test('waiting acknowledgement guard does not swallow fresh unresolved problems',()=>{
  assert.match(engine,/belum\|blm\|belom\|gagal\|error\|kendala\|masalah/);
});
