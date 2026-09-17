import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const poller=fs.readFileSync(new URL('../src/poller.js',import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');

test('v1.18 inbox is never destructively reconciled from the fast partial page',()=>{
  const hidePos=poller.indexOf('hideAllInboxConversations');
  assert.equal(hidePos,-1);
  const fastStart=poller.indexOf('export async function syncOnce');
  const fastEnd=poller.indexOf('async function mapBounded');
  const fast=poller.slice(fastStart,fastEnd);
  assert.doesNotMatch(fast,/reconcileInboxVisibilityAuthoritative/);
  assert.match(poller,/if\(data\?\._inventoryComplete!==true\)/);
  assert.match(poller,/reconcileInboxVisibilityAuthoritative\(activeIds\)/);
});

test('v1.18 DB keeps last-seen grace so one incomplete provider list cannot erase inbox',()=>{
  assert.match(db,/inbox_last_seen_at TIMESTAMPTZ/);
  assert.match(db,/export async function reconcileInboxVisibility/);
  assert.match(db,/COALESCE\(inbox_last_seen_at,updated_at\) < now\(\)/);
});

test('v1.18 dashboard only rerenders chat list when actual data changes',()=>{
  assert.match(ui,/chatListFingerprint/);
  assert.match(ui,/if\(fingerprint===chatListFingerprint\)return/);
  assert.match(ui,/oldScroll=list\.scrollTop/);
  assert.match(ui,/list\.scrollTop=oldScroll/);
  assert.match(ui,/classList\.toggle\('active',x===el\)/);
});

test('v1.18 end chat closes LiveChat and local conversation state',()=>{
  assert.match(server,/\/api\/conversations\/:id\/end/);
  assert.match(server,/lc\.endChat\(req\.params\.id\)/);
  assert.match(server,/markConversationEnded\(req\.params\.id\)/);
  assert.match(db,/ended_at=now\(\)/);
  assert.match(db,/human_bridge_tickets SET status='CANCELLED'/);
});

test('v1.18 recently ended chats are not immediately resurrected by a stale poll',()=>{
  assert.match(db,/conversations\.status='closed'.*conversations\.ended_at.*interval '2 minutes'/s);
});
