import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hashPassword,verifyPassword,generateRecoveryCodes,hashRecoveryCode} from '../src/auth.js';

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../src/human-bridge.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const env=fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8');

test('production password hashing uses scrypt and rejects wrong password',()=>{
  process.env.SESSION_SECRET ||= 'test-session-secret-that-is-long-enough-123456';
  const h=hashPassword('CorrectHorseBatteryStaple');
  assert.match(h,/^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword('CorrectHorseBatteryStaple',h),true);
  assert.equal(verifyPassword('wrong-password',h),false);
});

test('2FA recovery codes are unique-looking and one-way hashable',()=>{
  const codes=generateRecoveryCodes(8);
  assert.equal(codes.length,8);
  assert.equal(new Set(codes).size,8);
  assert.ok(codes.every(x=>/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(x)));
  assert.equal(hashRecoveryCode(codes[0]).length,64);
});

test('persistent login throttle and configurable CTA schema exist',()=>{
  assert.match(db,/CREATE TABLE IF NOT EXISTS auth_login_failures/);
  assert.match(db,/CREATE TABLE IF NOT EXISTS telegram_cta_configs/);
  assert.match(db,/UNIQUE\(category,action_key\)/);
  for(const state of ['NEW','WAITING_MEMBER_DATA','READY_FOR_CS','SENT_TO_TELEGRAM','WAITING_CS','RESOLVED','CLOSED']) assert.match(db,new RegExp(state));
  assert.match(db,/INVALID_CASE_TRANSITION/);
  assert.match(db,/setBridgeTicketTimeout/);
  assert.match(server,/LOGIN_TEMPORARILY_BLOCKED/);
});

test('telegram configurable CTA remains case-specific and disables completed buttons',()=>{
  assert.match(bridge,/callback_data:`hb:\$\{ticket\.id\}:CFG_\$\{x\.id\}`/);
  assert.match(bridge,/getTelegramCtaConfig/);
  assert.match(bridge,/editMessageText/);
  assert.match(bridge,/markConversationEnded/);
});

test('knowledge center supports metadata and CRUD UI',()=>{
  assert.match(db,/examples JSONB/);
  assert.match(db,/tags JSONB/);
  assert.match(db,/priority INT/);
  assert.match(server,/app\.put\('\/api\/knowledge\/:id'/);
  assert.match(html,/Knowledge Center/);
  assert.match(html,/kbExamples/);
});

test('dashboard includes required production operations menus',()=>{
  for(const label of ['Conversations','Knowledge','Canned Responses','Workflows','Telegram CTA','Telegram Settings','AI Settings','Learning','Logs','Health','Security']) assert.match(html,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('Railway env exposes password hash and graceful shutdown is wired',()=>{
  assert.match(env,/^ADMIN_PASSWORD_HASH=/m);
  assert.match(server,/process\.once\('SIGTERM'/);
  assert.match(server,/pool\.end\(\)/);
});
