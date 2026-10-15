import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectDiff } from '../lib/review-brief.mjs';
import { reviewCommand } from '../commands/review.mjs';
import { secretsCommand } from '../commands/secrets.mjs';
import { initRepo } from './helpers/git-repo.mjs';
import { withinBudget } from './helpers/timing.mjs';

// CP-52: `resolveBase` lùi về commit đầu repo khi không có nhánh chính để rẽ, nhưng
// bỏ đường lùi đó khi commit đầu CHÍNH LÀ HEAD và trả về chuỗi `'HEAD'`. Repo một
// commit — thứ người ta có lần đầu thử Compass trên một `git init` mới — vì thế diff
// HEAD với chính nó: commit đầu không bao giờ tới tay `review`, cũng không tới tay
// `secrets`, nơi lý do 3 xanh trên một dòng đọc `.env` chưa khai.

const SPEC = `# T-1: Thêm bộ lọc quốc gia
Loại: fix
Phạm vi: src/

## Mục tiêu
Lọc danh sách theo quốc gia.

## Ràng buộc
Không đổi API.

## Rủi ro hồi quy
Trang Browse dùng chung endpoint.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

const dirs = [];
test.after(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function write(root, rel, body) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

// Hỏi git cây rỗng của chính repo đó, như code phải làm — không chép sha cứng.
function emptyTree(root) {
  return execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], {
    cwd: root, encoding: 'utf8', input: '',
  }).trim();
}

// Repo đúng một commit. `files` vào commit; config và spec của Compass nằm ngoài
// commit trừ khi `files` mang chúng. `init` đổi được để dựng repo SHA-256.
function oneCommit(files = { 'src/a.js': 'export const a = 1;\n' }, { init = ['init', '-q'] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-first-'));
  dirs.push(root);
  git(root, ...init);
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  git(root, 'add', '-A', '--force');
  git(root, 'commit', '-qm', 'first');
  return { root, head: git(root, 'rev-parse', 'HEAD').trim() };
}

// Config và spec cho các lệnh. Ghi SAU commit: `.compass/` không vào diff nên cây
// làm việc vẫn "sạch" dưới mắt gate.
function compass(root, { header = [] } = {}) {
  write(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
  const lines = SPEC.split('\n');
  lines.splice(3, 0, ...header);
  write(root, '.compass/T-1/spec.md', lines.join('\n'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
}

const briefOf = (root) => readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');

test('CP-52-H1 a one-commit repo with a clean tree diffs its first commit against the empty tree', () => {
  const { root } = oneCommit();
  const r = collectDiff(root);
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('src/a.js'), `files = ${JSON.stringify(r.files)}`);
  assert.notEqual(r.base, 'HEAD');
  assert.equal(r.base, emptyTree(root));
  assert.match(r.base, /^[0-9a-f]{40}$/);
  assert.match(r.diff, /^\+export const a = 1;$/m);
});

test('CP-52-H2 an edit and an untracked file on top of the first commit are both in the diff', () => {
  const { root } = oneCommit();
  writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 2; // DA_SUA\n');
  write(root, 'src/b.js', 'export const b = 1;\n');

  const r = collectDiff(root);
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('src/a.js'), `files = ${JSON.stringify(r.files)}`);
  assert.ok(r.files.includes('src/b.js'), `files = ${JSON.stringify(r.files)}`);
  // Từ cây rỗng, bản đã sửa là dòng thêm — không có dòng `-` của bản cũ.
  assert.match(r.diff, /^\+export const a = 2; \/\/ DA_SUA$/m);
  assert.doesNotMatch(r.diff, /^-export const a = 1;$/m);
});

test('CP-52-H3 a two-commit repo still diffs from its root commit', () => {
  const { root, head: rootCommit } = oneCommit();
  write(root, 'src/b.js', 'export const b = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'second');

  const r = collectDiff(root);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.base, rootCommit);
  assert.deepEqual(r.files, ['src/b.js']);
  assert.equal(r.fromEmptyTree ?? false, false);
});

test('CP-52-H4 an initRepo fixture with an empty first commit gets the same diff as before', () => {
  const root = initRepo(mkdtempSync(path.join(tmpdir(), 'compass-first-init-')));
  dirs.push(root);
  write(root, 'src/new.js', 'export const moi = 1;\n');

  const r = collectDiff(root);
  assert.equal(r.ok, true, r.reason);
  // Giá trị tuyệt đối trước.
  assert.deepEqual(r.files, ['src/new.js']);
  assert.match(r.diff, /^new file mode /m);
  assert.match(r.diff, /^\+export const moi = 1;$/m);
  // Rồi so với đường cũ: trên f94ebdd base là `HEAD`, tức commit rỗng duy nhất. Gốc
  // khai bằng chính commit đó đi đúng lệnh diff ấy qua nhánh khai báo không đổi.
  const before = collectDiff(root, { baseRef: 'HEAD' });
  assert.equal(before.ok, true, before.reason);
  assert.deepEqual(r.files, before.files);
  assert.equal(r.diff, before.diff);
});

test('CP-52-H5 review on a one-commit repo writes a brief that names the empty tree', () => {
  const { root } = oneCommit();
  compass(root);
  const r = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  assert.ok(existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')));
  const brief = briefOf(root);
  assert.match(brief, /^- src\/a\.js$/m);
  assert.match(brief, /Compass tự lần ra, vì không ai khai gốc soi\./);
  assert.match(brief, /cây rỗng/);
  assert.match(brief, /một commit/);
});

test('CP-52-V1 a declared base equal to the only commit says to remove the Gốc soi line', () => {
  const { root, head } = oneCommit();
  compass(root, { header: [`Gốc soi: ${head}`] });
  const r = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /một commit/);
  assert.match(r.output, /dòng `Gốc soi:`/);
  assert.match(r.output, /cây rỗng/);
  assert.doesNotMatch(r.output, /Trỏ nó vào commit ngay TRƯỚC/);
  assert.ok(!existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')));
});

test('CP-52-V2 a declared base equal to the only commit is still honoured', () => {
  const { root, head } = oneCommit();
  write(root, 'src/b.js', 'export const b = 1;\n');

  const r = collectDiff(root, { baseRef: head, baseFrom: 'spec' });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.files, ['src/b.js']);
  assert.equal(r.base, head);

  // Cùng chuyện qua lệnh: spec khai thì brief chỉ có src/b.js.
  compass(root, { header: [`Gốc soi: ${head}`] });
  const out = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(out.exitCode, 1, out.output);
  const brief = briefOf(root);
  assert.match(brief, /^- src\/b\.js$/m);
  assert.doesNotMatch(brief, /^- src\/a\.js$/m);
  assert.doesNotMatch(brief, /cây rỗng/);
});

test('CP-52-V3 a first commit holding only Compass files leaves nothing to review', () => {
  const { root } = oneCommit({
    '.compass/config.json': JSON.stringify({ test: 'true' }),
    '.compass/T-1/spec.md': SPEC,
  });
  const r = collectDiff(root);
  assert.equal(r.ok, false);
  assert.equal(r.ly_do, 'empty');
  assert.match(r.reason, /Không có thay đổi nào để soi/);

  const out = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(out.exitCode, 2, out.output);
  assert.ok(!existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')));
});

test('CP-52-E1 secrets sees an undeclared .env read committed in the first commit', () => {
  const { root } = oneCommit({
    'src/cfg.js': "import { readFileSync } from 'node:fs';\nconst raw = readFileSync('.env', 'utf8');\n",
  });
  compass(root);
  const r = secretsCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /src\/cfg\.js:2\b/);
});

test('CP-52-E2 a repo with no commits is refused exactly as before', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-first-none-'));
  dirs.push(root);
  git(root, 'init', '-q');
  write(root, 'src/a.js', 'export const a = 1;\n');
  compass(root);

  const r = collectDiff(root);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Repo chưa có commit nào/);

  const review = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(review.exitCode, 2, review.output);
  assert.match(review.output, /Repo chưa có commit nào/);

  const secrets = secretsCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(secrets.exitCode, 1, secrets.output);
  assert.match(secrets.output, /Repo chưa có commit nào/);
});

test('CP-52-E3 an ignored .env on disk does not enter the diff from the empty tree', () => {
  const { root } = oneCommit({
    '.gitignore': '.env\n',
    'src/a.js': 'export const a = 1;\n',
  });
  write(root, '.env', 'KHOA=bi-mat\n');
  compass(root);

  const r = collectDiff(root);
  assert.equal(r.ok, true, r.reason);
  assert.ok(!r.files.includes('.env'), `files = ${JSON.stringify(r.files)}`);
  assert.ok(r.files.includes('src/a.js'), 'diff phải đến từ cây rỗng, không phải rỗng');

  const out = secretsCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(out.exitCode, 0, out.output);
});

test('CP-52-EC1 a SHA-256 repository gets its own empty tree id', () => {
  const { root } = oneCommit(undefined, { init: ['init', '-q', '--object-format=sha256'] });
  const r = collectDiff(root);
  assert.equal(r.ok, true, r.reason);
  assert.match(r.base, /^[0-9a-f]{64}$/);
  assert.ok(r.base.startsWith('6ef19b41'), r.base);
  assert.equal(r.base, emptyTree(root));
  assert.ok(r.files.includes('src/a.js'), `files = ${JSON.stringify(r.files)}`);
});

test('CP-52-EC2 a huge first commit is refused with a way out, and declaring it restores the old scope', () => {
  // 3MB văn bản sinh ra: 60k dòng, mỗi dòng 50 byte.
  const big = Array.from({ length: 60_000 }, (_, i) => `dong ${String(i).padStart(8, '0')} ${'x'.repeat(34)}`).join('\n') + '\n';
  const { root, head } = oneCommit({ 'data/big.txt': big, 'src/a.js': 'export const a = 1;\n' });
  write(root, 'src/b.js', 'export const b = 1;\n');
  compass(root);

  const review = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(review.exitCode, 2, review.output);
  assert.match(review.output, /Diff quá lớn/);
  assert.match(review.output, /Gốc soi/);

  const secrets = secretsCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(secrets.exitCode, 1, secrets.output);
  assert.match(secrets.output, /Diff quá lớn/);

  compass(root, { header: [`Gốc soi: ${head}`] });
  const r = collectDiff(root, { baseRef: head, baseFrom: 'spec' });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.files, ['src/b.js']);
  const after = secretsCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(after.exitCode, 0, after.output);
});

test('CP-52-EC3 Soi đến: HEAD in a one-commit repo is treated as no end declared', () => {
  const { root } = oneCommit();
  write(root, 'src/b.js', 'export const b = 1;\n');
  const r = collectDiff(root, { endRef: 'HEAD', endFrom: 'spec', scopePaths: ['src'] });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.endAtHead, true);
  assert.equal(r.end, null);
  assert.ok(r.files.includes('src/a.js'), `files = ${JSON.stringify(r.files)}`);
  assert.ok(r.files.includes('src/b.js'), `files = ${JSON.stringify(r.files)}`);
  assert.equal(r.base, emptyTree(root));
});

test('CP-52-EC4 Compass files carried by the first commit stay out of the diff', () => {
  const { root } = oneCommit({
    '.compass/config.json': JSON.stringify({ test: 'true' }),
    '.compass/T-1/spec.md': SPEC,
    'src/a.js': 'export const a = 1;\n',
  });
  const r = collectDiff(root);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.files, ['src/a.js']);
  assert.doesNotMatch(r.diff, /\.compass\//);
});

test('CP-52-EC5 a staged deletion of a first-commit file is not resurrected', () => {
  const { root } = oneCommit({ 'src/a.js': 'export const a = 1;\n', 'src/c.js': 'export const c = 1;\n' });
  git(root, 'rm', '-q', 'src/c.js');
  const r = collectDiff(root);
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('src/a.js'), `files = ${JSON.stringify(r.files)}`);
  assert.ok(!r.files.includes('src/c.js'), `files = ${JSON.stringify(r.files)}`);
  assert.doesNotMatch(r.diff, /src\/c\.js/);
});

test('CP-52-S1 the real index is byte-identical after collectDiff on a one-commit repo', () => {
  const { root } = oneCommit();
  writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 2;\n');
  write(root, 'src/b.js', 'export const b = 1;\n');
  const indexPath = path.join(root, '.git', 'index');
  const before = readFileSync(indexPath);
  const r = collectDiff(root);
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('src/b.js'));
  assert.ok(Buffer.compare(before, readFileSync(indexPath)) === 0, '.git/index đã bị đổi');
});

test('CP-52-P1 a first commit of 2000 small files is collected in under 5 s', () => {
  const files = {};
  for (let i = 0; i < 2000; i++) files[`src/m${Math.floor(i / 100)}/f${i}.js`] = `export const v${i} = ${i};\n`;
  const { root } = oneCommit(files);
  const { value: r } = withinBudget({ run: () => collectDiff(root), budgetMs: 5000, label: 'collectDiff' });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.files.length, 2000);
});
