import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { secretsCommand } from '../commands/secrets.mjs';

// CP-96 — config.json hỏng JSON thì không biết repo con nào có git riêng. `secrets` từng
// quét mỗi git gốc rồi xanh, nên `.env` đã commit trong repo con không ai nhìn tới.

const SECRET = 'SECRET_VALUE_96';
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

const SPEC = `# T-1: việc nhỏ
Loại: fix
Phạm vi: fe/a.js

## Mục tiêu
Đổi fe.

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

const GOOD = JSON.stringify({
  repos: { be: { test: 'true' }, fe: { test: 'true' } },
  secretsPublic: ['be/.env'],
});

// Bố cục issue #3: gốc chỉ theo dõi `.compass/`; `be` có git riêng và đã commit `.env`.
function workspace(config) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp96-'));
  put(root, '.compass/config.json', config);
  put(root, '.compass/T-1/spec.md', SPEC);
  initGit(root);
  put(root, '.gitignore', '/*\n!/.compass/\n!/.gitignore\n');
  commit(root, 'workspace');

  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'b.js', 'export const b = 1\n');
  put(be, '.env', `K=${SECRET}\n`);
  commit(be, 'be');

  const fe = path.join(root, 'fe');
  initGit(fe);
  put(fe, 'a.js', 'export const a = 1\n');
  commit(fe, 'fe');
  put(fe, 'a.js', 'export const a = 2\n');
  return root;
}

const secrets = (root) => secretsCommand({ cwd: root, taskId: 'T-1' });
const gateFile = (root) => path.join(root, '.compass', 'T-1', 'evidence', 'gate.json');

function refuses(r) {
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /config\.json không phải JSON hợp lệ/);
  assert.match(r.output, /repo con/);
  assert.match(r.output, /secretsPublic/);
  assert.doesNotMatch(r.output, /PASSED/);
}

test('CP-96-H1 a broken config.json stops secrets instead of passing on the root git alone', () => {
  const root = workspace('{ "secretsPublic": [');
  refuses(secrets(root));
  assert.ok(!existsSync(gateFile(root)) || !/"secrets"/.test(readFileSync(gateFile(root), 'utf8')), 'không được ghi bản ghi secrets');
});

test('CP-96-H2 a valid config without "test" still reads secretsPublic', () => {
  const r = secrets(workspace(GOOD));
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(r.output.split('\n').filter((l) => l.startsWith('ℹ') && l.includes('không quét be/.env')).length, 1, r.output);
});

test('CP-96-V1 an empty config.json is refused the same way', () => {
  refuses(secrets(workspace('')));
});

test('CP-96-E1 the refusal does not quote config.json', () => {
  // Trình đọc JSON trích khoảng mười ký tự quanh chỗ hỏng vào lời báo lỗi; giá trị dán
  // nhầm không có ngoặc kép đứng đúng chỗ đó.
  const r = secrets(workspace('{"repos": {"be": {"test": "true"}}, "token": sk96 }'));
  refuses(r);
  assert.doesNotMatch(r.output, /sk96/);
});

test('CP-96-EC1 a single-git project with a broken config is refused too', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp96-one-'));
  initGit(root);
  put(root, 'src/a.js', 'export const a = 1\n');
  put(root, '.compass/config.json', '{ "test": "true", }');
  put(root, '.compass/T-1/spec.md', SPEC.replace('fe/a.js', 'src/a.js'));
  commit(root, 'base');
  put(root, 'src/a.js', 'export const a = 2\n');
  refuses(secrets(root));
});

test('CP-96-EC2 a refusal leaves the stored green record untouched', () => {
  const root = workspace(GOOD);
  assert.equal(secrets(root).exitCode, 0);
  const before = readFileSync(gateFile(root));
  put(root, '.compass/config.json', GOOD.slice(0, -1));
  refuses(secrets(root));
  assert.ok(readFileSync(gateFile(root)).equals(before), 'gate.json không được đổi');
});
