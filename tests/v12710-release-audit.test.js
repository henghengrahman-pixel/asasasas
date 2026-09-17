
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('runtime env example documents current config variables',()=>{
  const env=fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8');
  assert.match(env,/^PORT=8080$/m);
  assert.match(env,/^LIVECHAT_CANNED_API_BASE=https:\/\/api\.livechatinc\.com\/v3\.5\/configuration\/action$/m);
  assert.match(env,/^TELEGRAM_BRIDGE_SLA_MINUTES=5$/m);
  assert.doesNotMatch(env,/AI_TAKEOVER_ON_ENABLE/);
});

test('production dependencies are top-level pinned',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.dependencies.express,'5.1.0');
  assert.equal(pkg.dependencies.pg,'8.16.3');
  assert.equal(pkg.scripts.verify,'npm run check && npm test && npm run audit');
});

test('debug scratch file is not shipped',()=>{
  assert.equal(fs.existsSync(new URL('../tmpcheck.mjs',import.meta.url)),false);
});

test('docker install is production only and non-interactive',()=>{
  const docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
  assert.match(docker,/npm ci --omit=dev --no-audit --no-fund/);
  assert.match(docker,/COPY package\.json package-lock\.json/);
});

test('SLA default and runtime escalation are configuration-driven',()=>{
  const config=fs.readFileSync(new URL('../src/config.js',import.meta.url),'utf8');
  const db=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.match(config,/TELEGRAM_BRIDGE_SLA_MINUTES, 5/);
  assert.match(db,/sla_due_at-created_at/);
  assert.match(db,/due_stage/);
});
