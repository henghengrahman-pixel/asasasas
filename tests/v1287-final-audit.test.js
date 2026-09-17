import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('README and package declare one current release version',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const readme=fs.readFileSync(new URL('../README.md',import.meta.url),'utf8');
  assert.equal(pkg.version,'1.31.0');
  assert.match(readme,new RegExp(`Current release: v${pkg.version.replaceAll('.','\\.')}`));
});

test('Docker install is reproducible from package-lock',()=>{
  const docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
  assert.match(docker,/COPY package\.json package-lock\.json \.\//);
  assert.match(docker,/npm ci --omit=dev --no-audit --no-fund/);
  assert.doesNotMatch(docker,/npm i --package-lock-only/);
});

test('full release gate includes browser QA',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts.verify,'npm run check && npm test && npm run audit');
  assert.match(pkg.scripts['verify:full'],/npm run browser:qa/);
});
