import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Dockerfile does not depend on hidden npmrc file',()=>{
  const docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
  assert.match(docker,/COPY package\.json package-lock\.json \.\//);
  assert.doesNotMatch(docker,/COPY package\.json \.npmrc/);
  assert.match(docker,/npm ci --omit=dev --no-audit --no-fund/);
});

test('Docker runtime entrypoint is server.js on Node 22 alpine',()=>{
  const docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
  assert.match(docker,/FROM node:22-alpine/);
  assert.match(docker,/CMD \["node", "src\/server\.js"\]/);
});
