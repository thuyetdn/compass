import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { conventionDraftCommand, conventionApproveCommand } from '../commands/convention.mjs';
import { statusCommand } from '../commands/status.mjs';

// CP-104 — phần còn lại sau lần soi thứ ba của CP-103.

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const LINK = process.platform === 'win32' ? 'junction' : 'dir';

function put(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

function initGit(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function commit(dir) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'base']);
}

// Gốc có git riêng và `.editorconfig`; repo `be` có git riêng. `missing`: thêm một repo
// khai trong config mà không có thư mục.
function workspace({ missing = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp104-'));
  initGit(root);
  put(root, '.gitignore', '/be/\n');
  put(root, '.editorconfig', 'root = true\n');
  const repos = { be: { test: 'true' }, ...(missing ? { x: { test: 'true' } } : {}) };
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos }));
  put(root, '.knowledge/decided/conventions.md', '# gốc\n');
  commit(root);
  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'src/a.ts', 'export function a() {\n  return 1;\n}\n');
  put(be, 'src/b.ts', 'export function b() {\n  return 2;\n}\n');
  commit(be);
  return root;
}

const draftPath = (root) => path.join(root, '.compass', 'conventions-draft', 'be.md');

function draftAndFill(root, answer) {
  const d = conventionDraftCommand({ cwd: root, repo: 'be' });
  assert.equal(d.exitCode, 0, d.output);
  let cur = null;
  const text = readFileSync(draftPath(root), 'utf8').split('\n').map((line) => {
    const m = /^### (\d+)\. /.exec(line);
    if (m) cur = Number(m[1]);
    else if (/^### /.test(line)) cur = null;
    if (cur !== null && line.includes('compass-fill')) return answer(cur);
    return line.replace('- [ ]', '- [x]');
  }).join('\n');
  writeFileSync(draftPath(root), text);
}

test('CP-104-H1 evidence written with the repo prefix is accepted', () => {
  const root = workspace();
  draftAndFill(root, () => 'Theo `be/src/a.ts`.');
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-104-H2 a refused approve does not pose as a gate', () => {
  const root = workspace();
  draftAndFill(root, (n) => (n === 3 ? '> Chờ điền (compass-fill).' : 'Theo `src/a.ts`.'));
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 1, r.output);
  assert.doesNotMatch(r.output, /Gate convention/);
  assert.match(r.output, /3\. Cấu trúc thư mục/);
});

test('CP-104-V1 a junction on the approved folder is named, and no outside file is offered for deletion', () => {
  const root = workspace();
  draftAndFill(root, () => 'Theo `src/a.ts`.');
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp104-out-'));
  writeFileSync(path.join(outside, 'be.md'), '# ngoài workspace\n');
  symlinkSync(outside, path.join(root, '.knowledge', 'decided', 'conventions'), LINK);
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /symlink, junction/);
  assert.doesNotMatch(r.output, /Đã có|xóa/);
  assert.equal(readFileSync(path.join(outside, 'be.md'), 'utf8'), '# ngoài workspace\n');
});

test('CP-104-E1 a prefixed path climbing out, and a workspace-level file, are not evidence', () => {
  const root = workspace();
  put(root, 'outside.txt', 'ngoài repo\n');
  draftAndFill(root, (n) => (n === 2 ? 'Xem `be/../outside.txt`.' : n === 4 ? 'Xem `.editorconfig`.' : 'Theo `be/src/a.ts`.'));
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Không có bằng chứng.*2\. Đặt tên, 4\. Phụ thuộc giữa các lớp\./);
  assert.ok(!existsSync(path.join(root, '.knowledge', 'decided', 'conventions', 'be.md')));
});

test('CP-104-EC1 the status header counts a missing repo too', () => {
  const root = workspace({ missing: true });
  const r = statusCommand({ cwd: root, taskId: undefined });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /^Repo \(2\):$/m);
});

test('CP-104-EC2 the draft says evidence paths are written from the repo', () => {
  const root = workspace();
  assert.equal(conventionDraftCommand({ cwd: root, repo: 'be' }).exitCode, 0);
  assert.match(readFileSync(draftPath(root), 'utf8'), /đường dẫn tính từ repo/);
});
