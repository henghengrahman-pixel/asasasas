import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/engine.js',import.meta.url),'utf8');

test('v1.24.5 pure OK is terminal and cannot re-trigger WD workflow',()=>{
  assert.match(engine,/if\(isAcknowledgementText\(text\)\)\{[\s\S]*?return \{intent:'ACKNOWLEDGEMENT'/);
  assert.match(engine,/function acknowledgementReply\(\)\{ return 'Oke bosku 😊'; \}/);
  const ackBlock=engine.match(/if\(isAcknowledgementText\(text\)\)\{[\s\S]*?return \{intent:'ACKNOWLEDGEMENT'[\s\S]*?\n    \}/)?.[0]||'';
  assert.doesNotMatch(ackBlock,/WD_PROCESSING_REPLY|maybeHandleWorkflow|maybeHandleOperationalFlow/);
});

test('v1.24.5 gratitude has requested fixed reply and is terminal before workflow',()=>{
  assert.match(engine,/function isGratitudeText/);
  assert.match(engine,/Terima kasih kembali, bosku 😊 Senang bisa membantu\. Semoga aktivitas bosku selalu lancar dan menyenangkan\. Selamat melanjutkan aktivitas kembali ya, bosku 🙏/);
  const gratitudePos=engine.indexOf('if(isGratitudeText(text))');
  const workflowPos=engine.indexOf('const workflowResult=await maybeHandleWorkflow');
  assert.ok(gratitudePos>0 && workflowPos>gratitudePos);
});

test('v1.24.5 gratitude matcher is strict and does not swallow operational follow-up',()=>{
  assert.match(engine,/makasih, tapi WD saya belum masuk/);
  assert.match(engine,/\^\(\?:\(\?:makasih\|makasi\|terima kasih\|thanks\|thank you\|thx\)/);
});
