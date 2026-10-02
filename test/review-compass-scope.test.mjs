import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectDiff } from '../lib/review-brief.mjs';
import { reviewCommand } from '../commands/review.mjs';

// CP-48: `.compass/**` is excluded from every review diff, so a task whose code lives in
// `.compass/scripts/` could never be reviewed. A `.compass/` path the task declares in `Phạm vi:`
// now reaches the brief — except gate records, findings, briefs and the signing salt.

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function write(root, rel, body) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function repo(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp48-'));
  git(root, 'init', '-q', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  write(root, 'src/app.js', 'goc\n');
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'first');
  return { root, base: git(root, 'rev-parse', 'HEAD').trim() };
}

test('CP-48-H1 a committed change to a declared .compass file reaches the diff', () => {
  const { root, base } = repo({ '.compass/scripts/tool.mjs': 'v1\n' });
  write(root, '.compass/scripts/tool.mjs', 'v2\n');
  git(root, 'commit', '-qam', 'tool v2');
  const r = collectDiff(root, { baseRef: base, compassPaths: ['.compass/scripts/tool.mjs'] });
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('.compass/scripts/tool.mjs'), JSON.stringify(r.files));
  assert.match(r.diff, /\+v2/);
});

test('CP-48-H2 an untracked declared .compass file reaches the diff, and the real index is untouched', () => {
  const { root, base } = repo();
  write(root, '.compass/scripts/new.mjs', 'brand new\n');
  const before = readFileSync(path.join(root, '.git', 'index'));
  const r = collectDiff(root, { baseRef: base, compassPaths: ['.compass/scripts/new.mjs'] });
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('.compass/scripts/new.mjs'), JSON.stringify(r.files));
  assert.match(r.diff, /brand new/);
  assert.deepEqual(readFileSync(path.join(root, '.git', 'index')), before);
});

test('CP-48-H3 the review command briefs a task whose only change is a declared .compass file', () => {
  const { root, base } = repo();
  write(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
  write(root, '.compass/T-1/spec.md', `# T-1: Build a tool
Loại: fix
Gốc soi: ${base}
Phạm vi: .compass/scripts/tool.mjs (mới)

## Mục tiêu
A tool.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | One | Ok | P0 |
| H2 | Happy | Two | Ok | P0 |
`);
  write(root, '.compass/scripts/tool.mjs', 'export const tool = 1;\n');
  const r = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(r.output, /0 file/, r.output);
  const briefFile = path.join(root, '.compass', 'T-1', 'review-brief.md');
  assert.ok(existsSync(briefFile), r.output);
  assert.match(readFileSync(briefFile, 'utf8'), /\.compass\/scripts\/tool\.mjs/);
});

test('CP-48-V1 an undeclared .compass file stays out', () => {
  const { root, base } = repo({ '.compass/scripts/other.mjs': 'v1\n' });
  write(root, '.compass/scripts/other.mjs', 'v2\n');
  write(root, 'src/app.js', 'goc\nsua\n');
  const r = collectDiff(root, { baseRef: base, compassPaths: ['.compass/scripts/tool.mjs'] });
  assert.equal(r.ok, true, r.reason);
  assert.ok(!r.files.some((f) => f.startsWith('.compass/')), JSON.stringify(r.files));
});

test('CP-48-V2 gate records, review files, briefs and the salt never enter, even when declared', () => {
  const own = ['.compass/T-1/evidence/gate.json', '.compass/T-1/review/round1.json', '.compass/T-1/review-brief.md', '.compass/.salt'];
  const { root, base } = repo(Object.fromEntries(own.map((p) => [p, 'v1\n'])));
  for (const p of own) write(root, p, 'v2 secret-salt-value\n');
  write(root, 'src/app.js', 'goc\nsua\n');
  const r = collectDiff(root, { baseRef: base, compassPaths: own });
  assert.equal(r.ok, true, r.reason);
  assert.ok(!r.files.some((f) => f.startsWith('.compass/')), JSON.stringify(r.files));
  assert.doesNotMatch(r.diff, /secret-salt-value/);
});

test('CP-48-E1 a declared .compass file that does not exist changes nothing', () => {
  const { root, base } = repo();
  write(root, 'src/app.js', 'goc\nsua\n');
  const without = collectDiff(root, { baseRef: base });
  const withMissing = collectDiff(root, { baseRef: base, compassPaths: ['.compass/scripts/missing.mjs'] });
  assert.equal(withMissing.ok, true, withMissing.reason);
  assert.equal(withMissing.diff, without.diff);
  assert.deepEqual(withMissing.files, without.files);
});

test('CP-48-EC1 a declared .compass file changed inside a Soi đến range is in the diff', () => {
  const { root, base } = repo({ '.compass/scripts/tool.mjs': 'v1\n' });
  write(root, '.compass/scripts/tool.mjs', 'v2\n');
  git(root, 'commit', '-qam', 'tool v2');
  const end = git(root, 'rev-parse', 'HEAD').trim();
  write(root, 'src/app.js', 'later work\n');
  git(root, 'commit', '-qam', 'later');
  const r = collectDiff(root, { baseRef: base, endRef: end, scopePaths: ['.compass/scripts/tool.mjs'], compassPaths: ['.compass/scripts/tool.mjs'] });
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('.compass/scripts/tool.mjs'), JSON.stringify(r.files));
});

test('CP-48-EC2 with no .compass path declared the diff is byte-identical', () => {
  const { root, base } = repo({ '.compass/scripts/tool.mjs': 'v1\n' });
  write(root, '.compass/scripts/tool.mjs', 'v2\n');
  write(root, 'src/app.js', 'goc\nsua\n');
  write(root, 'src/new.js', 'moi\n');
  const a = collectDiff(root, { baseRef: base });
  const b = collectDiff(root, { baseRef: base, compassPaths: [] });
  const c = collectDiff(root, { baseRef: base, compassPaths: ['src/app.js'] });
  assert.equal(b.diff, a.diff);
  assert.deepEqual(b.files, a.files);
  assert.equal(c.diff, a.diff, 'đường dẫn ngoài .compass không đổi gì');
});
