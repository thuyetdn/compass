import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashSource } from '../lib/source-hash.mjs';
import { initRepo } from './helpers/git-repo.mjs';
import { measureGrowth } from './helpers/growth.mjs';

// CP-117 — mã băm nguồn chỉ đọc file git biết. Bản cũ đọc mọi file trừ tám tên thư mục, bỏ qua
// `.gitignore`: một `.venv` 4,7 GB làm một lần băm quá 10 phút trên một dự án nhiều repo.

const tempDir = (prefix) => mkdtempSync(path.join(tmpdir(), prefix));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function write(root, rel, content) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}
function commitAll(root) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'work');
}

function venvRepo() {
  const root = initRepo(tempDir('compass-cp117-'));
  write(root, '.gitignore', '.venv/\n*.log\n');
  write(root, 'debug.log', 'one\n');
  write(root, 'src/a.js', 'export const a = 1;\n');
  write(root, '.venv/lib/site.py', 'x = 1\n');
  commitAll(root);
  return root;
}

test('CP-117-H1 a file inside an ignored folder does not move the hash', () => {
  const root = venvRepo();
  const before = hashSource(root);
  write(root, '.venv/lib/site.py', 'x = 2\n');
  write(root, '.venv/lib/more.py', 'y = 1\n');
  write(root, 'debug.log', 'two, longer\n');
  assert.equal(hashSource(root), before);
});

test('CP-117-H2 editing a tracked file changes the hash', () => {
  const root = venvRepo();
  const before = hashSource(root);
  write(root, 'src/a.js', 'export const a = 2;\n');
  assert.notEqual(hashSource(root), before);
});

test('CP-117-H3 a new file that is neither ignored nor committed changes the hash', () => {
  const root = venvRepo();
  const before = hashSource(root);
  write(root, 'src/new.js', 'export const n = 1;\n');
  assert.notEqual(hashSource(root), before);
});

test('CP-117-H4 a declared nested repo the root git ignores is listed with its own git', () => {
  const root = initRepo(tempDir('compass-cp117mr-'));
  // Như một gốc nhiều repo thật: gốc ignore mọi thư mục con, repo con có git và .gitignore riêng.
  write(root, '.gitignore', '/*/\n!/.compass/\n');
  write(root, '.compass/config.json', JSON.stringify({ test: 'node -e 0', repos: { 'store/backend': {} } }));
  const backend = path.join(root, 'store', 'backend');
  mkdirSync(backend, { recursive: true });
  initRepo(backend);
  write(backend, '.gitignore', 'vendor/\n');
  write(backend, 'src/api.js', 'export const api = 1;\n');
  write(backend, 'vendor/lib/x.php', '<?php 1;\n');
  commitAll(backend);

  const before = hashSource(root);
  write(backend, 'vendor/lib/x.php', '<?php 2;\n');
  assert.equal(hashSource(root), before, 'vendor của repo con bị ignore');
  write(backend, 'src/api.js', 'export const api = 2;\n');
  assert.notEqual(hashSource(root), before, 'file theo dõi của repo con vẫn được băm');
});

test('CP-117-V1 with nothing ignored, a git repo hashes like the same tree without git', () => {
  const files = {
    'src/a.js': 'export const a = 1;\n',
    'src/deep/b-c.js': 'export const b = 2;\n',
    'src.js': 'export const s = 3;\n',
    'README.md': '# hi\n',
    '.compass/T-1/spec.md': '# T-1\n',
    'node_modules/x/index.js': 'module.exports = 1;\n',
  };
  const repo = initRepo(tempDir('compass-cp117v1g-'));
  const plain = tempDir('compass-cp117v1p-');
  for (const [rel, content] of Object.entries(files)) {
    write(repo, rel, content);
    write(plain, rel, content);
  }
  git(repo, 'add', 'src/a.js', 'README.md');
  git(repo, 'commit', '-q', '-m', 'part');
  assert.equal(hashSource(repo), hashSource(plain));
});

test('CP-117-V2 tracked files under the skipped folder names stay out of the hash', () => {
  const root = venvRepo();
  write(root, '.compass/T-1/evidence/x.json', '{}\n');
  write(root, 'dist/out.js', 'out\n');
  git(root, 'add', '-f', '.compass', 'dist');
  git(root, 'commit', '-q', '-m', 'tracked skipped');
  const before = hashSource(root);
  write(root, '.compass/T-1/evidence/x.json', '{"a":1}\n');
  write(root, 'dist/out.js', 'changed\n');
  assert.equal(hashSource(root), before);

  // `.compass` khai như một repo có git riêng vẫn nằm ngoài: băm nó là mỗi gate tự làm hỏng bản ghi của mình.
  write(root, '.compass/config.json', JSON.stringify({ test: 'node -e 0', repos: { '.compass': {} } }));
  initRepo(path.join(root, '.compass'));
  const declared = hashSource(root);
  write(root, '.compass/T-1/evidence/y.json', '{}\n');
  assert.equal(hashSource(root), declared);
});

test('CP-117-E1 a folder that is not a git work tree is walked as before, .gitignore or not', () => {
  const root = tempDir('compass-cp117e1-');
  write(root, '.gitignore', 'tmp/\n');
  write(root, 'src/a.js', 'export const a = 1;\n');
  write(root, 'tmp/x.txt', 'one\n');
  const before = hashSource(root);
  write(root, 'tmp/x.txt', 'two\n');
  assert.notEqual(hashSource(root), before);
});

test('CP-117-E2 a .git file pointing at a missing folder falls back to the walk without throwing', () => {
  const root = tempDir('compass-cp117e2-');
  write(root, '.git', 'gitdir: ./nowhere\n');
  write(root, '.gitignore', 'tmp/\n');
  write(root, 'tmp/x.txt', 'one\n');
  const before = hashSource(root);
  write(root, 'tmp/x.txt', 'two\n');
  assert.notEqual(hashSource(root), before);

  // Repo lồng có `.git` là thư mục rỗng: git bỏ nó và đi lên git cha, nơi thư mục này bị ignore.
  // Liệt kê theo git cha là mất hết file của nó; phải đi cây.
  const parent = initRepo(tempDir('compass-cp117e2b-'));
  write(parent, '.gitignore', '/*/\n!/.compass/\n');
  write(parent, '.compass/config.json', JSON.stringify({ test: 'node -e 0', repos: { api: {} } }));
  mkdirSync(path.join(parent, 'api', '.git'), { recursive: true });
  write(parent, 'api/src/x.js', 'export const x = 1;\n');
  const nestedBefore = hashSource(parent);
  write(parent, 'api/src/x.js', 'export const x = 2;\n');
  assert.notEqual(hashSource(parent), nestedBefore);
});

test('CP-117-E3 a tracked file deleted from disk changes the hash and nothing throws', () => {
  const root = venvRepo();
  const before = hashSource(root);
  rmSync(path.join(root, 'src', 'a.js'));
  assert.notEqual(hashSource(root), before);
});

test('CP-117-EC1 an ignored .env still counts by its size only', () => {
  const root = venvRepo();
  write(root, '.gitignore', '.venv/\n.env\n');
  write(root, '.env', 'A=1\n');
  commitAll(root);
  const before = hashSource(root);
  write(root, '.env', 'A=2\n');
  assert.equal(hashSource(root), before, 'cùng độ dài thì không đổi');
  write(root, '.env', 'A=10\n');
  assert.notEqual(hashSource(root), before, 'đổi độ dài thì đổi');
});

test('CP-117-EC2 a linked worktree inside the repo stays out of the hash', () => {
  const root = venvRepo();
  const before = hashSource(root);
  const wt = path.join(root, '.worktrees', 'agent');
  git(root, 'worktree', 'add', '-q', '-b', 'agent', wt.split(path.sep).join('/'));
  write(wt, 'src/a.js', 'export const a = 99;\n');
  assert.equal(hashSource(root), before);
});

test('CP-117-EC3 file names with spaces and Vietnamese letters are hashed', () => {
  const root = venvRepo();
  write(root, 'src/tên có dấu.js', 'export const t = 1;\n');
  commitAll(root);
  const before = hashSource(root);
  write(root, 'src/tên có dấu.js', 'export const t = 2;\n');
  assert.notEqual(hashSource(root), before);
});

test('CP-117-EC4 a Compass root inside a bigger git repo only hashes its own folder', () => {
  const outer = initRepo(tempDir('compass-cp117ec4-'));
  write(outer, 'other.js', 'export const o = 1;\n');
  write(outer, 'app/a.js', 'export const a = 1;\n');
  commitAll(outer);
  const root = path.join(outer, 'app');
  const before = hashSource(root);
  write(outer, 'other.js', 'export const o = 2;\n');
  assert.equal(hashSource(root), before, 'file ngoài gốc');
  write(root, 'a.js', 'export const a = 2;\n');
  assert.notEqual(hashSource(root), before, 'file trong gốc');
});

test('CP-117-S1 a tracked symlink to a file outside the root is never read', (t) => {
  const root = venvRepo();
  const outside = tempDir('compass-cp117s1-');
  const target = path.join(outside, 'secret.txt');
  writeFileSync(target, 'one\n');
  try {
    symlinkSync(target, path.join(root, 'src', 'link.txt'), 'file');
  } catch (err) {
    if (err.code !== 'EPERM') throw err;
    t.diagnostic('không tạo được symlink file (EPERM); case này chỉ đo được ở Linux, macOS hoặc Windows có quyền');
    return;
  }
  commitAll(root);
  const before = hashSource(root);
  writeFileSync(target, 'two, longer\n');
  assert.equal(hashSource(root), before);
});

test('CP-117-P1 an ignored folder of 5,000 files costs at most a fifth of walking it', () => {
  const build = (root) => {
    for (let i = 0; i < 50; i++) write(root, `src/f${i}.js`, `export const f${i} = ${i};\n`);
    const blob = 'x'.repeat(4096);
    for (let i = 0; i < 5000; i++) write(root, `ignored/d${i % 50}/f${i}.txt`, blob);
    write(root, '.gitignore', 'ignored/\n');
  };
  const repo = initRepo(tempDir('compass-cp117p1g-'));
  build(repo);
  commitAll(repo);
  const plain = tempDir('compass-cp117p1p-');
  build(plain);

  // Nhãn cỡ 1 là bản git, 4 là bản đi cây: tỉ số đo được là thời gian đi cây chia thời gian git.
  const result = measureGrowth({ run: (n) => hashSource(n === 1 ? repo : plain), small: 1, large: 4, pairs: 3, warmup: 1 });
  assert.ok(result.ratio >= 5, `đi cây chỉ chậm hơn ${result.ratio.toFixed(1)}× (các cặp ${result.ratios.map((r) => r.toFixed(1)).join(' · ')})`);
});
