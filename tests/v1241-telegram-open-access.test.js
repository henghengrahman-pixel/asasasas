import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Telegram operator access defaults to all even when legacy whitelist exists', () => {
  const cfg=fs.readFileSync(new URL('../src/config.js', import.meta.url),'utf8');
  const bridge=fs.readFileSync(new URL('../src/human-bridge.js', import.meta.url),'utf8');
  assert.match(cfg,/telegramOperatorAccessMode:\s*String\(process\.env\.TELEGRAM_OPERATOR_ACCESS_MODE \|\| 'all'\)/);
  assert.match(bridge,/if\(mode!==['"]whitelist['"]\) return true;/);
});
