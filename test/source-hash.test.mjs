import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashSource } from '../lib/source-hash.mjs';

function makeTree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-src-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const TREE = {
  'src/a.js': 'export const a = 1;\n',
  'src/deep/b.js': 'export const b = 2;\n',
  'README.md': '# hello\n',
};

test('CP-7-H1 hashing an unchanged tree twice gives the same answer', () => {
  const root = makeTree(TREE);
  assert.equal(hashSource(root), hashSource(root));
});

test('CP-7-H2 editing a file changes the hash', () => {
  const root = makeTree(TREE);
  const before = hashSource(root);
  writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 999;\n');
  assert.notEqual(hashSource(root), before);
});

test('CP-7-H3 adding a file changes the hash', () => {
  const root = makeTree(TREE);
  const before = hashSource(root);
  writeFileSync(path.join(root, 'src', 'c.js'), 'export const c = 3;\n');
  assert.notEqual(hashSource(root), before);
});

test('CP-7-H4 deleting a file changes the hash', () => {
  const root = makeTree(TREE);
  const before = hashSource(root);
  rmSync(path.join(root, 'src', 'deep', 'b.js'));
  assert.notEqual(hashSource(root), before);
});

test('CP-7-EC1 writing into .compass leaves the hash alone', () => {
  const root = makeTree(TREE);
  const before = hashSource(root);
  // Every gate writes here on every run. Counting it would make each gate
  // invalidate its own evidence.
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'gate.json'), '{"test":1}');
  writeFileSync(path.join(root, '.compass', 'config.json'), '{"test":"x"}');
  assert.equal(hashSource(root), before);
});

test('CP-7-EC2 renaming a file changes the hash even though content is identical', () => {
  const root = makeTree(TREE);
  const before = hashSource(root);
  renameSync(path.join(root, 'src', 'a.js'), path.join(root, 'src', 'renamed.js'));
  assert.notEqual(hashSource(root), before);
});

test('CP-7-EC3 changes under node_modules do not count', () => {
  const root = makeTree(TREE);
  mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'v1\n');
  const before = hashSource(root);
  writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'v2\n');
  assert.equal(hashSource(root), before);
});

test('dist, build, coverage and .git are skipped too', () => {
  const root = makeTree(TREE);
  const before = hashSource(root);
  for (const dir of ['dist', 'build', 'coverage', '.git']) {
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, 'x.js'), 'noise\n');
  }
  assert.equal(hashSource(root), before);
});

test('CP-7-V3 a directory with no source files still hashes to something stable', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-src-'));
  const hash = hashSource(root);
  assert.match(hash, /^sha256:/);
  assert.equal(hashSource(root), hash);
});

test('two trees with the same content hash the same', () => {
  assert.equal(hashSource(makeTree(TREE)), hashSource(makeTree(TREE)));
});

test('moving a file between directories changes the hash', () => {
  const root = makeTree(TREE);
  const before = hashSource(root);
  mkdirSync(path.join(root, 'lib'), { recursive: true });
  renameSync(path.join(root, 'src', 'a.js'), path.join(root, 'lib', 'a.js'));
  assert.notEqual(hashSource(root), before);
});

test('CP-7-E1 an unreadable file does not crash the walk', () => {
  const root = makeTree(TREE);
  // A directory where a file is expected is the portable way to make a read
  // fail on Windows, where chmod does not stop the owner.
  mkdirSync(path.join(root, 'src', 'weird.js'), { recursive: true });
  const hash = hashSource(root);
  assert.match(hash, /^sha256:/);
});
