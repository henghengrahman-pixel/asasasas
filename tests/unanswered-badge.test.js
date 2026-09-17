import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/assets/css/conversations.css',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../public/assets/js/pages/conversations.js',import.meta.url),'utf8');

test('needs-reply is based on the latest sender so both AI and human replies clear it',()=>{
  assert.match(server,/CASE WHEN lm\.sender_type='customer' THEN true ELSE false END AS needs_reply/);
  assert.match(server,/\$2='NEEDS_REPLY' AND lm\.sender_type='customer'/);
  assert.match(server,/SELECT m\.sender_type FROM messages m WHERE m\.chat_id=c\.chat_id ORDER BY m\.id DESC LIMIT 1/);
});

test('unanswered active chat renders a red reply-needed marker',()=>{
  assert.match(page,/c\.needs_reply\?'<span class=\"needs-reply\"/);
  assert.match(css,/\.needs-reply\{[^}]*background:#ff3347/);
});
