import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('src/server.js');
const conv=read('public/assets/js/pages/conversations.js');
const convHtml=read('public/pages/conversations.html');
const convCss=read('public/assets/css/conversations.css');
const shell=read('public/assets/js/core/shell.js');
const db=read('src/db.js');
const docker=read('Dockerfile');

test('/health stays JSON-only and operator health UI is /system-health',()=>{
  assert.match(server,/app\.get\('\/health'[\s\S]{0,350}service:'livechat-ai'/);
  assert.match(server,/app\.get\('\/system-health'/);
  const dashboard=server.slice(server.indexOf('const dashboardPages'),server.indexOf('const TWOFA_SECRET_KEY'));
  assert.doesNotMatch(dashboard,/'health'/);
  assert.match(shell,/\['system-health','Health'\]/);
});

test('user actions supersede background inbox polling',()=>{
  assert.doesNotMatch(conv,/if\(state\.listBusy\)return/);
  assert.match(conv,/reason==='poll'\?0:2/);
  assert.match(conv,/active\.controller\.abort/);
  assert.match(conv,/reason:'search'/);
  assert.match(conv,/reason:'filter'/);
  assert.match(conv,/reason:'refresh'/);
  assert.match(conv,/reason:'pagination'/);
});

test('background inbox poll is recursive and non-overlapping',()=>{
  assert.match(conv,/background_busy/);
  assert.match(conv,/setTimeout\(async\(\)=>\{await fetchList/);
  assert.doesNotMatch(conv,/setInterval\(/);
  assert.match(conv,/document\.hidden\?15000/);
});

test('detail switching is latest-request-wins and timeout-safe',()=>{
  assert.match(conv,/state\.detailAbort\?\.abort/);
  assert.match(conv,/const version=\+\+state\.detailVersion/);
  assert.match(conv,/version!==state\.detailVersion\|\|selected\(\)!==id/);
  assert.match(conv,/detailError\(e\.message\)/);
});

test('default conversation detail does not load brain context',()=>{
  const block=server.slice(server.indexOf("app.get('/api/conversations/:id'"),server.indexOf("app.get('/api/conversations/:id/messages'"));
  assert.doesNotMatch(block,/getConversationBrain/);
  assert.match(server,/app\.get\('\/api\/conversations\/:id\/brain'/);
});

test('message realtime uses delta endpoint and event/id dedup',()=>{
  assert.match(server,/WHERE chat_id=\$1 AND id>\$2 AND session_key=COALESCE\(\(SELECT NULLIF\(session_key,''\) FROM conversations WHERE chat_id=\$1\),session_key\) ORDER BY id ASC/);
  assert.match(conv,/messageAfterId/);
  assert.match(conv,/store\.hasMessage\(chatId,id\)/);
  assert.match(db,/UNIQUE\(chat_id,event_id\)/);
});

test('closed conversation is removed from inbox and explicit CLOSED state exists',()=>{
  assert.match(conv,/visible_in_inbox===false/);
  assert.match(conv,/store\.remove\(id\)/);
  assert.match(db,/handling_state='CLOSED'/);
  assert.match(db,/visible_in_inbox=false/);
});

test('canned responses are lazy loaded only from # input and DB search is bounded',()=>{
  const open=conv.slice(conv.indexOf('async function openChat'),conv.indexOf('async function loadOlder'));
  assert.doesNotMatch(open,/loadShortcuts/);
  assert.match(conv,/composer\.addEventListener\('input'/);
  assert.match(conv,/loadShortcuts\(t\.q\.slice\(1\)\)/);
  assert.match(server,/searchCannedResponses\(q,limit\)/);
  assert.match(db,/export async function searchCannedResponses/);
  assert.match(db,/LIMIT \$5/);
});

test('canned autocomplete cancels stale searches',()=>{
  assert.match(conv,/state\.shortcutAbort\?\.abort/);
  assert.match(conv,/shortcutVersion/);
});

test('Conversations CSS is page-scoped and layout cannot horizontally overflow',()=>{
  assert.match(convCss,/body\[data-page="conversations"\]\{overflow:hidden\}/);
  assert.match(convCss,/grid-template-columns:310px minmax\(0,1fr\) 280px/);
  assert.match(convCss,/\.conversation-pane\{[^}]*min-width:0[^}]*min-height:0/s);
  assert.match(convCss,/\.messages\{[^}]*flex:1[^}]*min-height:0[^}]*overflow-y:auto/s);
  assert.match(convCss,/\.composer-shell\{flex:none/);
  for(const page of fs.readdirSync(new URL('../public/pages',import.meta.url)).filter(x=>x.endsWith('.html')&&x!=='conversations.html')){
    assert.doesNotMatch(read('public/pages/'+page),/conversations\.css/,page);
  }
  assert.match(convHtml,/conversations\.css/);
});

test('legacy app.js and style.css remain inactive in production HTML',()=>{
  const html=[read('public/index.html'),...fs.readdirSync(new URL('../public/pages',import.meta.url)).filter(x=>x.endsWith('.html')).map(x=>read('public/pages/'+x))].join('\n');
  assert.doesNotMatch(html,/src="[^"]*\/app\.js"/);
  assert.doesNotMatch(html,/href="[^"]*\/style\.css"/);
});

test('Docker uses package-lock and npm ci',()=>{
  assert.equal(fs.existsSync(new URL('../package-lock.json',import.meta.url)),true);
  assert.match(docker,/COPY package\.json package-lock\.json/);
  assert.match(docker,/npm ci --omit=dev/);
  assert.doesNotMatch(docker,/npm install/);
});

test('graceful Railway shutdown closes listeners and DB pools',()=>{
  assert.match(server,/process\.once\('SIGTERM'/);
  assert.match(server,/server\.close/);
  assert.match(server,/pool\.end\(\)/);
});

test('API fallback error handler is after centralized API error middleware',()=>{
  assert.ok(server.indexOf('app.use(apiErrorHandler)') < server.indexOf("res.status(500).send('Internal Server Error')"));
});
