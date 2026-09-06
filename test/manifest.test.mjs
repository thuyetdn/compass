import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildManifest, compareManifest } from '../lib/manifest.mjs';

function makeTree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-man-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const TREE = { 'src/a.jsx': 'const a = 1;\n', 'src/b.jsx': 'const b = 2;\n' };

test('CP-10-H3 a manifest carries one hash per scanned file', () => {
  const root = makeTree(TREE);
  const manifest = buildManifest(root, ['src/a.jsx', 'src/b.jsx']);

  assert.deepEqual(Object.keys(manifest.sources).sort(), ['src/a.jsx', 'src/b.jsx']);
  assert.match(manifest.sources['src/a.jsx'], /^sha256:/);
  assert.notEqual(manifest.sources['src/a.jsx'], manifest.sources['src/b.jsx']);
  assert.match(manifest.generatedAt, /^\d{4}-/);
});

test('CP-10-H4 nothing changed means nothing to report', () => {
  const root = makeTree(TREE);
  const manifest = buildManifest(root, ['src/a.jsx', 'src/b.jsx']);
  const result = compareManifest(root, manifest, ['src/a.jsx', 'src/b.jsx']);

  assert.equal(result.stale, false);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.added, []);
});

test('CP-10-H7 an edited file is reported by name', () => {
  const root = makeTree(TREE);
  const manifest = buildManifest(root, ['src/a.jsx', 'src/b.jsx']);
  writeFileSync(path.join(root, 'src', 'a.jsx'), 'const a = 999;\n');

  const result = compareManifest(root, manifest, ['src/a.jsx', 'src/b.jsx']);
  assert.equal(result.stale, true);
  assert.deepEqual(result.changed, ['src/a.jsx']);
});

test('CP-10-E4 a deleted file is reported as missing', () => {
  const root = makeTree(TREE);
  const manifest = buildManifest(root, ['src/a.jsx', 'src/b.jsx']);
  rmSync(path.join(root, 'src', 'b.jsx'));

  const result = compareManifest(root, manifest, ['src/a.jsx']);
  assert.equal(result.stale, true);
  assert.deepEqual(result.missing, ['src/b.jsx']);
});

test('CP-10-EC14 a file added after generation is reported', () => {
  const root = makeTree(TREE);
  const manifest = buildManifest(root, ['src/a.jsx', 'src/b.jsx']);
  writeFileSync(path.join(root, 'src', 'c.jsx'), 'const c = 3;\n');

  const result = compareManifest(root, manifest, ['src/a.jsx', 'src/b.jsx', 'src/c.jsx']);
  assert.equal(result.stale, true);
  assert.deepEqual(result.added, ['src/c.jsx']);
});

test('CP-10-V8 a manifest with no sources map counts as stale rather than crashing', () => {
  const root = makeTree(TREE);
  const result = compareManifest(root, { generatedAt: 'x' }, ['src/a.jsx']);
  assert.equal(result.stale, true);
  assert.match(result.reason, /manifest/i);
});

test('CP-10-V7 a null manifest counts as never generated', () => {
  const root = makeTree(TREE);
  const result = compareManifest(root, null, ['src/a.jsx']);
  assert.equal(result.stale, true);
  assert.match(result.reason, /chưa sinh|manifest/i);
});

test('every kind of change is reported at once, not one at a time', () => {
  const root = makeTree(TREE);
  const manifest = buildManifest(root, ['src/a.jsx', 'src/b.jsx']);
  writeFileSync(path.join(root, 'src', 'a.jsx'), 'đổi\n');
  rmSync(path.join(root, 'src', 'b.jsx'));
  writeFileSync(path.join(root, 'src', 'c.jsx'), 'mới\n');

  const result = compareManifest(root, manifest, ['src/a.jsx', 'src/c.jsx']);
  assert.deepEqual(result.changed, ['src/a.jsx']);
  assert.deepEqual(result.missing, ['src/b.jsx']);
  assert.deepEqual(result.added, ['src/c.jsx']);
});

test('an unreadable file counts as changed', () => {
  const root = makeTree(TREE);
  const manifest = buildManifest(root, ['src/a.jsx']);
  rmSync(path.join(root, 'src', 'a.jsx'));
  mkdirSync(path.join(root, 'src', 'a.jsx'));

  const result = compareManifest(root, manifest, ['src/a.jsx']);
  assert.equal(result.stale, true);
});
