import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewCommand } from '../commands/review.mjs';
import { secretsCommand } from '../commands/secrets.mjs';

// CP-89 — repo khai trong `repos` là junction tới một thư mục KHÔNG phải git nằm ngoài
// gốc. Trước đây git không thấy repo nào ở đó, rồi bước dò `.git` đi ngược lên gặp
// `.git` của gốc, và mọi task đỏ với lời "git không đọc được (safe.directory)".

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

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
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
}

const SPEC = ({ scope, head = '' }) => `# T-1: việc trong be
Loại: fix
Phạm vi: ${scope}
${head}
## Mục tiêu
Đổi be.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

// Gốc có git (không ignore gì), `be` là repo của task với một thay đổi chưa commit.
function workspace({ repos = { be: {}, vendor: {} }, scope = 'be/a.js', head = '', rootGit = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp89-'));
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: Object.fromEntries(Object.entries(repos).map(([k, v]) => [k, { test: 'true', ...v }])) }));
  put(root, '.compass/T-1/spec.md', SPEC({ scope, head }));
  if (rootGit) {
    initGit(root);
    commit(root, 'workspace');
  }
  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'a.js', 'export const a = 1\n');
  commit(be, 'be');
  put(be, 'a.js', 'export const a = 2\n');
  return root;
}

// Junction tới một thư mục thường (không git) nằm ngoài gốc.
function outsideFolder(at, files = { 'v.js': 'export const V = 1\n' }) {
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp89-out-'));
  for (const [f, body] of Object.entries(files)) put(outside, f, body);
  mkdirSync(path.dirname(at), { recursive: true });
  symlinkSync(outside, at, process.platform === 'win32' ? 'junction' : 'dir');
  return outside;
}

const review = (root) => reviewCommand({ cwd: root, taskId: 'T-1' });
const secrets = (root) => secretsCommand({ cwd: root, taskId: 'T-1' });
const briefOf = (root) => readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
const SKIP = /Bỏ qua repo "vendor": thư mục của nó nằm ngoài gốc Compass/;
const REFUSE = /Repo "vendor" có thư mục nằm ngoài gốc Compass/;

test('CP-89-H1 a junction to an outside non-git folder, outside Phạm vi, is skipped with one note', () => {
  const root = workspace();
  outsideFolder(path.join(root, 'vendor'));
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.equal(r.output.match(/Bỏ qua repo "vendor"/g)?.length, 1, r.output);
  assert.match(r.output, SKIP);
  const s = secrets(root);
  assert.equal(s.exitCode, 0, s.output);
  assert.equal(s.output.match(/Bỏ qua repo "vendor"/g)?.length, 1, s.output);
});

test('CP-89-H2 the same folder in Phạm vi is refused', () => {
  const root = workspace({ scope: 'be/a.js, vendor/v.js' });
  outsideFolder(path.join(root, 'vendor'));
  for (const r of [review(root), secrets(root)]) {
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, REFUSE);
  }
});

test('CP-89-H3 README and the guide say a skipped outside repo is not scanned', () => {
  for (const rel of ['README.md', 'docs/huong-dan.md']) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\n\s*/g, ' ');
    assert.doesNotMatch(text, /`secrets` quét git của mọi repo,/, rel);
    assert.match(text, /`secrets` quét git của mọi repo trừ repo nằm ngoài gốc Compass bị bỏ qua/, rel);
  }
});

test('CP-89-V1 the messages name the outside folder and never blame .git', () => {
  const root = workspace();
  const outside = outsideFolder(path.join(root, 'vendor'));
  const r = review(root);
  const s = secrets(root);
  for (const out of [r.output, s.output]) {
    assert.doesNotMatch(out, /\.git nhưng|safe\.directory/);
    assert.ok(out.includes(path.basename(outside)), out);
  }
});

test('CP-89-V2 Gốc soi for the outside folder says why it is not reviewed', () => {
  const root = workspace({ head: 'Gốc soi (vendor): HEAD\n' });
  outsideFolder(path.join(root, 'vendor'));
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /`Gốc soi \(vendor\):` — repo "vendor" có thư mục nằm ngoài gốc Compass/);
});

test('CP-89-E1 a broken gitfile inside the root is still reported as unreadable', () => {
  const root = workspace();
  rmSync(path.join(root, 'be', '.git'), { recursive: true, force: true });
  writeFileSync(path.join(root, 'be', '.git'), 'gitdir: ../khong-co-thu-muc-nay\n');
  const r = secrets(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Repo "be" có \.git nhưng git không đọc được nó/);
});

test('CP-89-E2 a root with no git whose only repo is the outside folder never passes secrets', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp89-nogit-'));
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { vendor: { test: 'true' } } }));
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'x.js' }));
  put(root, 'x.js', "require('fs').readFileSync('.env')\n");
  outsideFolder(path.join(root, 'vendor'));
  const s = secrets(root);
  assert.notEqual(s.exitCode, 0, s.output);
});

test('CP-89-EC1 the outside folder nested inside a sub-repo leaks nothing into its diff', () => {
  const root = workspace({ repos: { be: {}, vendor: { path: 'be/vendor' } }, scope: 'be/' });
  outsideFolder(path.join(root, 'be', 'vendor'), { 'v.js': 'export const NESTED_V = 1\n', '.env': 'SECRET-NESTED-89\n' });
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, SKIP);
  const s = secrets(root);
  assert.equal(s.exitCode, 0, s.output);
  assert.doesNotMatch(`${r.output}\n${s.output}\n${briefOf(root)}`, /NESTED_V|SECRET-NESTED-89|vendor\/\.env/);
});

test('CP-89-EC2 a repo declared by path under another name is skipped by that name', () => {
  const root = workspace({ repos: { be: {}, thuvien: { path: 'libs/vendor' } } });
  outsideFolder(path.join(root, 'libs', 'vendor'), { 'lib.js': 'export const LIB_89 = 1\n' });
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Bỏ qua repo "thuvien": thư mục của nó nằm ngoài gốc Compass/);
  assert.doesNotMatch(briefOf(root), /LIB_89/);
});

test('CP-89-EC3 tests that depend on the file system skip instead of passing', () => {
  const text = readFileSync(path.join(ROOT, 'test', 'workspace-git-scope.test.mjs'), 'utf8');
  assert.doesNotMatch(text, /\) return; \/\/|if \(!fsFoldsCase\(root\)\) return;|if \(!parent\) return;/);
  for (const id of ['S7', 'V4', 'S9', 'EC5']) {
    const start = text.indexOf(`test('CP-88-${id} `);
    assert.ok(start >= 0, id);
    const block = text.slice(start, text.indexOf('\n});', start));
    assert.match(block, /^test\('CP-88-[A-Z0-9]+ (?:[^'\\]|\\.)*', \(t\) => \{/, id);
    assert.match(block, /t\.skip\('[^']+'\)/, id);
  }
});

test('CP-89-S1 nothing of the outside folder reaches outputs, brief or context', () => {
  const root = workspace();
  outsideFolder(path.join(root, 'vendor'), { 'v.js': "import { a } from '../be/a.js'\nexport const VENDOR_89 = a\n", '.env': 'SECRET-VENDOR-89\n' });
  const r = review(root);
  const s = secrets(root);
  const all = `${r.output}\n${s.output}\n${briefOf(root)}`;
  assert.doesNotMatch(all, /SECRET-VENDOR-89|VENDOR_89|vendor\/v\.js|vendor\/\.env/);
});

test('CP-89-S2 Phạm vi written as ./vendor/x.js refuses the folder', () => {
  const root = workspace({ scope: 'be/a.js, ./vendor/v.js' });
  outsideFolder(path.join(root, 'vendor'));
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, REFUSE);
});

test('CP-89-S3 a .env the root git tracks under the junction is still caught', () => {
  const root = workspace({ head: 'Gốc soi: HEAD\n' });
  outsideFolder(path.join(root, 'vendor'), { '.env': 'X=1\n' });
  git(root, ['add', '-f', 'vendor/.env']);
  commit(root, 'lỡ commit');
  const s = secrets(root);
  assert.equal(s.exitCode, 1, s.output);
  assert.match(s.output, /vendor\/\.env/);
});

// CP-90 — hai lỗi nhỏ lần soi của CP-89 để lại.

test('CP-90-H3 SKILL.md names the exception for a repo skipped outside the root', () => {
  const text = readFileSync(path.join(ROOT, 'skills', 'compass', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const row = text.split('\n').find((l) => l.startsWith('| `secrets` | Quét index'));
  assert.ok(row);
  assert.match(row, /\*\*mọi\*\* repo trừ repo nằm ngoài gốc Compass bị bỏ qua/);
  const para = text.slice(text.indexOf('Repo có `.git` mà git không đọc được'), text.indexOf('Hai giới hạn:'));
  assert.match(para.replace(/\n/g, ' '), /trừ khi repo đó nằm ngoài gốc Compass và ngoài `Phạm vi`/i);
});

test('CP-90-H4 an outside folder with an unreadable .git is called a git in the skip note', () => {
  const root = workspace();
  const outside = outsideFolder(path.join(root, 'vendor'));
  writeFileSync(path.join(outside, '.git'), 'gitdir: ../khong-co-thu-muc-nay\n');
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Bỏ qua repo "vendor": git của nó nằm ngoài gốc Compass/);
  assert.doesNotMatch(r.output, /thư mục của nó/);
});
