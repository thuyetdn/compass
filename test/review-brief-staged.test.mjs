import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectDiff } from '../lib/review-brief.mjs';

// CP-46: the scratch index was seeded with `read-tree HEAD`, from the last
// commit rather than from the real index, and `add -N` only covered
// `ls-files --others`. A file that had been `git add`-ed was in neither set —
// not in HEAD, and no longer "other" — so it vanished from the brief. The
// reviewer then read what they were given, found nothing, and the gate went
// green over a file nobody had seen.

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// A repo with one commit. Returns its path and the base commit.
function repo(files = { 'base.js': 'goc\n' }) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-staged-'));
  git(root, 'init', '-q', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'first');
  return { root, base: git(root, 'rev-parse', 'HEAD').trim() };
}

function write(root, rel, body) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

test('CP-46-H1 a file that is git add-ed reaches the diff', () => {
  const { root, base } = repo();
  write(root, 'staged.js', 'da stage\n');
  git(root, 'add', 'staged.js');

  const r = collectDiff(root, { baseRef: base });
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('staged.js'), `files = ${JSON.stringify(r.files)}`);
  assert.match(r.diff, /staged\.js/);
});

test('CP-46-H2 a tracked edit, an untracked file and a staged file all appear', () => {
  const { root, base } = repo();
  writeFileSync(path.join(root, 'base.js'), 'goc\nsua roi\n');
  write(root, 'staged.js', 'da stage\n');
  git(root, 'add', 'staged.js');
  write(root, 'untracked.js', 'chua stage\n');

  const r = collectDiff(root, { baseRef: base });
  for (const f of ['base.js', 'staged.js', 'untracked.js']) {
    assert.ok(r.files.includes(f), `thiếu ${f} trong ${JSON.stringify(r.files)}`);
  }
});

test('CP-46-H3 work that is fully committed does not produce an empty diff', () => {
  // The hazard the old comment warned about: seed from the wrong place and
  // `diff base` compares base with itself.
  const { root, base } = repo();
  write(root, 'later.js', 'lam sau\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'second');

  const r = collectDiff(root, { baseRef: base });
  assert.ok(r.files.includes('later.js'), `files = ${JSON.stringify(r.files)}`);
});

test('CP-46-V1 a staged file with empty content still appears', () => {
  const { root, base } = repo();
  write(root, 'empty.js', '');
  git(root, 'add', 'empty.js');

  const r = collectDiff(root, { baseRef: base });
  assert.ok(r.files.includes('empty.js'), `files = ${JSON.stringify(r.files)}`);
});

test('CP-46-V2 a staged file whose name holds a space keeps its name', () => {
  const { root, base } = repo();
  write(root, 'co khoang trang.js', 'x\n');
  git(root, 'add', 'co khoang trang.js');

  const r = collectDiff(root, { baseRef: base });
  assert.ok(r.files.includes('co khoang trang.js'), `files = ${JSON.stringify(r.files)}`);
});

test('CP-46-E1 the real .git/index is untouched', () => {
  // A GIT_INDEX_FILE command that falls back to the real index corrupts the
  // repository it was only meant to read. This happened to a probe repo while
  // this bug was being measured, which is why it is a test rather than a note.
  const { root, base } = repo();
  write(root, 'staged.js', 'x\n');
  git(root, 'add', 'staged.js');

  const indexPath = path.join(root, '.git', 'index');
  const before = readFileSync(indexPath);
  collectDiff(root, { baseRef: base });
  const after = readFileSync(indexPath);

  assert.ok(before.equals(after), 'collectDiff không được ghi vào .git/index thật');
  assert.match(git(root, 'status', '--short'), /^A {2}staged\.js$/m);
});

test('CP-46-E2 a repository with no commits does not throw', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-staged-empty-'));
  git(root, 'init', '-q', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  write(root, 'a.js', 'x\n');

  const r = collectDiff(root, {});
  assert.equal(typeof r.ok, 'boolean', 'trả về đúng hình dạng, không ném');
});

test('CP-46-EC1 sixty untracked plus three staged files all appear', () => {
  const { root, base } = repo();
  for (let i = 0; i < 60; i++) write(root, `u${i}.js`, `${i}\n`);
  for (let i = 0; i < 3; i++) {
    write(root, `s${i}.js`, `${i}\n`);
    git(root, 'add', `s${i}.js`);
  }

  const r = collectDiff(root, { baseRef: base });
  assert.equal(r.files.filter((f) => /^[us]\d+\.js$/.test(f)).length, 63);
});

test('CP-46-EC2 a staged deletion stays a deletion', () => {
  const { root, base } = repo({ 'base.js': 'goc\n', 'xoa.js': 'se xoa\n' });
  git(root, 'rm', '-q', 'xoa.js');

  const r = collectDiff(root, { baseRef: base });
  assert.ok(r.files.includes('xoa.js'), `files = ${JSON.stringify(r.files)}`);
  assert.match(r.diff, /deleted file|--- a\/xoa\.js/);
});

test('CP-46-EC3 a staged file under .compass stays excluded', () => {
  const { root, base } = repo();
  // A real file alongside it: excluding every path would leave an empty diff,
  // which collectDiff reports as a misplaced review base rather than a result.
  write(root, 'that.js', 'that\n');
  git(root, 'add', 'that.js');
  write(root, '.compass/CP-46/evidence/gate.json', '{}\n');
  git(root, 'add', '-f', '.compass/CP-46/evidence/gate.json');

  const r = collectDiff(root, { baseRef: base });
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('that.js'), `files = ${JSON.stringify(r.files)}`);
  assert.equal(
    r.files.some((f) => f.startsWith('.compass/')), false,
    `bản ghi gate không được vào brief: ${JSON.stringify(r.files)}`,
  );
});

test('CP-46-EC4 scopePaths still narrows away a file outside it', () => {
  // `Soi đến` must name a commit behind HEAD. Pointed at HEAD itself the
  // narrowing deliberately switches off, so that a task at the tip of the
  // branch is still reviewed in full — that is how a file it touched but forgot
  // to declare still reaches the reviewer.
  const { root, base } = repo();
  write(root, 'src/keep.js', 'giu\n');
  write(root, 'other/drop.js', 'bo\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'second');
  const end = git(root, 'rev-parse', 'HEAD').trim();

  write(root, 'sau.js', 'viec den sau\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'third');

  const r = collectDiff(root, { baseRef: base, endRef: end, scopePaths: ['src/'] });
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.files.includes('src/keep.js'), `files = ${JSON.stringify(r.files)}`);
  assert.equal(r.files.includes('other/drop.js'), false);
});

test('CP-46-S1 a staged path holding .. in a directory name writes nothing outside the repo', () => {
  const { root, base } = repo();
  write(root, 'a..b/x.js', 'x\n');
  git(root, 'add', 'a..b/x.js');

  const outside = path.join(root, '..', 'khong-duoc-tao.js');
  const r = collectDiff(root, { baseRef: base });

  assert.ok(r.files.includes('a..b/x.js'), `files = ${JSON.stringify(r.files)}`);
  assert.throws(() => readFileSync(outside), /ENOENT/, 'không được ghi ra ngoài repo');
});

test('CP-46-P1 two hundred staged files collect in under five seconds', () => {
  const { root, base } = repo();
  for (let i = 0; i < 200; i++) write(root, `p${i}.js`, `${i}\n`);
  git(root, 'add', '-A');

  const started = Date.now();
  const r = collectDiff(root, { baseRef: base });
  const elapsed = Date.now() - started;

  assert.equal(r.files.filter((f) => /^p\d+\.js$/.test(f)).length, 200);
  assert.ok(elapsed < 5000, `mất ${elapsed}ms, ngưỡng 5000ms`);
  rmSync(root, { recursive: true, force: true });
});
