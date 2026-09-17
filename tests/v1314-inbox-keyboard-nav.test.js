import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../public/pages/conversations.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../public/assets/js/pages/conversations.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/assets/css/conversations.css',import.meta.url),'utf8');

test('modular Conversations keeps Newest Alt+Arrow navigation footer',()=>{
  assert.match(html,/id="jumpNewest"/);
  assert.match(html,/Newest/);
  assert.match(html,/Alt\+↑\/↓/);
  assert.match(html,/id="keyboardNavCount"/);
});

test('Alt+Arrow navigation is implemented in modular conversations runtime',()=>{
  assert.match(js,/function navigateChatByKeyboard/);
  assert.match(js,/e\.altKey/);
  assert.match(js,/ArrowUp/);
  assert.match(js,/ArrowDown/);
  assert.match(js,/scrollIntoView\(\{block:'nearest'\}\)/);
});

test('keyboard navigation footer remains scoped to Conversations CSS',()=>{
  assert.match(css,/body\[data-page="conversations"\] \.inbox-nav-footer/);
  assert.match(css,/body\[data-page="conversations"\] \.keyboard-nav-count/);
});
