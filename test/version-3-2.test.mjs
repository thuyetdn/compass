import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CP-97 — bản 3.2.1 (CP-83 dựng test này cho 3.1.0, CP-94 chuyển sang 3.2.0): mọi chỗ
// khai phiên bản nói cùng một số, và đó là số người dùng thấy khi gõ `compass --version`.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

test('CP-97-H1 every manifest and the page say 3.2.1', () => {
  assert.equal(json('package.json').version, '3.2.1');
  assert.equal(json('.claude-plugin/plugin.json').version, '3.2.1');
  assert.equal(json('.claude-plugin/marketplace.json').plugins[0].version, '3.2.1');
  assert.equal(json('.codex-plugin/plugin.json').version, '3.2.1');
  const page = readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.match(page, /Compass 3\.2\.1/);
  assert.match(page, /<span>v3\.2\.1<\/span>/);
  assert.doesNotMatch(page, /3\.2\.0|3\.1\.\d|3\.0\.0/);
});

test('CP-97-H2 compass --version prints 3.2.1', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '3.2.1');
});
