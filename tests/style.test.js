import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStyleInstruction } from '../src/ai.js';

test('default Natural CS style avoids robotic language',()=>{
  const s=buildStyleInstruction({replyStyle:'NATURAL_CS',replyLength:'SHORT',boskuUsage:'MODERATE',emojiUsage:'LIGHT',formalLanguage:false});
  assert.match(s,/staf LiveChat manusia/i);
  assert.match(s,/1-2 kalimat/i);
  assert.match(s,/jangan di setiap kalimat/i);
  assert.match(s,/bahasa terlalu formal\/robotik/i);
  assert.match(s,/Jangan mengulang pertanyaan/i);
});

test('style settings support no emoji and custom note',()=>{
  const s=buildStyleInstruction({replyStyle:'FRIENDLY',replyLength:'MEDIUM',boskuUsage:'RARE',emojiUsage:'NONE',formalLanguage:true,replyStyleNote:'Jangan pakai kata sayang.'});
  assert.match(s,/Jangan gunakan emoji/i);
  assert.match(s,/maksimal 3-4 kalimat/i);
  assert.match(s,/Jangan pakai kata sayang/i);
});
