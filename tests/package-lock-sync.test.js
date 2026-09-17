import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('package-lock contains complete npm-ci inventory for pinned production dependencies', () => {
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
  assert.equal(lock.lockfileVersion,3);
  assert.ok(lock.packages?.['']);
  for(const [name,version] of Object.entries(pkg.dependencies||{})){
    assert.equal(lock.packages[''].dependencies?.[name],version,`root lock mismatch for ${name}`);
    assert.equal(lock.packages?.[`node_modules/${name}`]?.version,version,`missing or mismatched lock entry for ${name}`);
  }
  const count=Object.keys(lock.packages||{}).filter(k=>k.startsWith('node_modules/')).length;
  assert.ok(count>=20,`dependency inventory unexpectedly small: ${count}`);
});
