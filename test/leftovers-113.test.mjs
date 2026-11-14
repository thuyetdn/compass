import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preflightCommand } from '../commands/preflight.mjs';
import { mutationCommand } from '../commands/mutation.mjs';
import { reviewCommand } from '../commands/review.mjs';
import { prCommand } from '../commands/pr.mjs';

// CP-113 — bốn lỗi người soi để lại ở CP-108, CP-110 và CP-111.

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function initGit(dir, branch = 'main') {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', branch]);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'core.autocrlf', 'false']);
}

const put = (root, rel, body) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};

function commit(dir, msg) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

const LAYER = { H: 'Happy', V: 'Validation', E: 'Error', EC: 'Edge', S: 'Security', P: 'Performance' };
const CASES = ['H1', 'H2', 'H3', 'V1', 'V2', 'E1', 'E2', 'EC1', 'EC2', 'S1', 'S2', 'H4', 'H5'];
const SPEC = ({ base, type = 'fix', goal = 'Dọn code.' }) => `# T-1: Dọn
Loại: ${type}
Gốc soi: ${base}
Phạm vi: lib/

## Mục tiêu
${goal}

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
${CASES.map((id) => `| ${id} | ${LAYER[id.replace(/\d+$/, '')]} | a | b | P0 |`).join('\n')}
`;

function makeRepo({ goal, type, config = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp113-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: 'node -e "0"', ...config }));
  put(root, 'lib/old.js', 'export const old = 1;\n');
  put(root, 'lib/keep.js', 'export const keep = 1;\n');
  const base = commit(root, 'base');
  put(root, '.compass/T-1/spec.md', SPEC({ base, goal, type }));
  return root;
}

const pre = (root, taskId = 'T-1') => preflightCommand({ cwd: root, taskId });

// ---------------------------------------------------------------- Happy

test('CP-113-H1 a spec naming a file the task deletes or renames away is not judged', () => {
  const deleted = makeRepo({ goal: 'Gỡ `lib/old.js`.' });
  git(deleted, ['rm', '-q', 'lib/old.js']);
  let r = pre(deleted);
  assert.equal(r.exitCode, 0, r.output);

  const renamed = makeRepo({ goal: 'Đổi `lib/old.js` thành `lib/new.js`.' });
  git(renamed, ['mv', 'lib/old.js', 'lib/new.js']);
  r = pre(renamed);
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-113-H2 valid reviewLenses keys behave as before', () => {
  const root = makeRepo({ type: 'feature-s', config: { reviewLenses: { 'feature-s': ['matrix', 'deploy'] } } });
  put(root, 'lib/keep.js', 'export const keep = 2;\n');
  const r = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8'), /evidence\/findings\/deploy\.json/);
});

// ---------------------------------------------------------------- Validation

test('CP-113-V1 a reviewLenses key that is not a task type is refused naming it', () => {
  const root = makeRepo({ type: 'feature-s', config: { reviewLenses: { feature_m: ['matrix'] } } });
  put(root, 'lib/keep.js', 'export const keep = 2;\n');
  const r = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /"reviewLenses\.feature_m": "feature_m" không phải loại task\. Loại hợp lệ: fix, bug, feature-s, feature-m, feature-l/);
  assert.ok(!existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')));
});

test('CP-113-V2 preflight and mutation refuse a task id that leaves .compass and write nothing', () => {
  const root = makeRepo();
  const outside = path.join(root, 'x');
  for (const run of [preflightCommand, mutationCommand]) {
    const r = run({ cwd: root, taskId: '../x' });
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, /Task ID/i);
  }
  assert.ok(!existsSync(outside), 'evidence written outside .compass');
  assert.deepEqual(readdirSync(path.join(root, '.compass')).sort(), ['T-1', 'config.json']);
});

// ---------------------------------------------------------------- Error

function makePr() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp113-pr-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: 'node -e "0"' }));
  put(root, 'src/a.js', 'export const a = 1;\n');
  const before = commit(root, 'base 1');
  put(root, 'src/b.js', 'export const b = 1;\n');
  const fork = commit(root, 'base 2');
  git(root, ['checkout', '-q', '-b', 'feature']);
  put(root, 'src/c.js', 'export const c = 1;\n');
  commit(root, 'feat: c');
  git(root, ['checkout', '-q', 'main']);
  return { root, before, fork };
}
const prDir = (root) => path.join(path.resolve(root, git(root, ['rev-parse', '--git-common-dir'])), 'compass', 'pr', 'feature');

test('CP-113-E1 --since before the fork point is refused naming the SHA and the fork point', () => {
  const { root, before, fork } = makePr();
  const r = prCommand({ cwd: root, ref: 'feature', since: before });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, new RegExp(`--since=${before}: ${before.slice(0, 7)} nằm trước điểm rẽ ${fork.slice(0, 7)} của feature`));
  assert.ok(!existsSync(path.join(prDir(root), 'review-brief.md')));
});

test('CP-113-E2 a path that never existed is still red while the task deletes another file', () => {
  const root = makeRepo({ goal: 'Gỡ `lib/old.js`, xem `lib/never.js`.' });
  git(root, ['rm', '-q', 'lib/old.js']);
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /`lib\/never\.js` — không có file hay thư mục này/);
  assert.doesNotMatch(r.output, /`lib\/old\.js`/);
});

// ---------------------------------------------------------------- Edge

test('CP-113-EC1 --since at the fork point is the whole PR', () => {
  const { root, fork } = makePr();
  const r = prCommand({ cwd: root, ref: 'feature', since: fork });
  assert.equal(r.exitCode, 1, r.output);
  const brief = readFileSync(path.join(prDir(root), 'review-brief.md'), 'utf8');
  const diff = brief.slice(brief.lastIndexOf('## Diff'));
  assert.match(diff, /src\/c\.js/);
  assert.doesNotMatch(diff, /src\/b\.js/);
});

test('CP-113-EC2 a removed file named with a line suffix is not judged', () => {
  const root = makeRepo({ goal: 'Gỡ hàm ở `lib/old.js:12`.' });
  git(root, ['rm', '-q', 'lib/old.js']);
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
});
