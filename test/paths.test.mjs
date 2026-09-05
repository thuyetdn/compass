import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findRoot, compassDir, taskDir, evidenceDir,
  specPath, gatePath, configPath, saltPath, validateTaskId
} from '../lib/paths.mjs';

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{}');
  return root;
}

test('findRoot finds the directory containing .compass/config.json', () => {
  const root = makeFixture();
  assert.equal(findRoot(root), root);
});

test('findRoot walks up from a nested directory', () => {
  const root = makeFixture();
  const nested = path.join(root, 'a', 'b', 'c');
  mkdirSync(nested, { recursive: true });
  assert.equal(findRoot(nested), root);
});

test('findRoot returns null when no config exists', () => {
  const orphan = mkdtempSync(path.join(tmpdir(), 'compass-orphan-'));
  assert.equal(findRoot(orphan), null);
});

test('path builders compose the expected locations', () => {
  const root = makeFixture();
  assert.equal(compassDir(root), path.join(root, '.compass'));
  assert.equal(taskDir(root, 'T-1'), path.join(root, '.compass', 'T-1'));
  assert.equal(evidenceDir(root, 'T-1'), path.join(root, '.compass', 'T-1', 'evidence'));
  assert.equal(specPath(root, 'T-1'), path.join(root, '.compass', 'T-1', 'spec.md'));
  assert.equal(gatePath(root, 'T-1'), path.join(root, '.compass', 'T-1', 'evidence', 'gate.json'));
  assert.equal(configPath(root), path.join(root, '.compass', 'config.json'));
  assert.equal(saltPath(root), path.join(root, '.compass', '.salt'));
});

test('validateTaskId accepts valid ids', () => {
  assert.ok(validateTaskId('NX-001').ok);
  assert.ok(validateTaskId('T-42').ok);
  assert.ok(validateTaskId('fix.login').ok);
});

test('validateTaskId rejects id containing ..', () => {
  const result = validateTaskId('../escape');
  assert.equal(result.ok, false);
  assert.match(result.reason, /\.\./);
});

test('validateTaskId rejects id containing /', () => {
  const result = validateTaskId('task/sub');
  assert.equal(result.ok, false);
  assert.match(result.reason, /\//);
});

test('validateTaskId rejects id containing backslash', () => {
  const result = validateTaskId('task\\sub');
  assert.equal(result.ok, false);
  assert.match(result.reason, /\\/);
});

test('validateTaskId rejects each Windows-illegal character', () => {
  const illegal = ['<', '>', ':', '"', '|', '?', '*'];
  for (const char of illegal) {
    const result = validateTaskId(`task${char}id`);
    assert.equal(result.ok, false, `should reject "${char}"`);
  }
});

test('validateTaskId rejects trailing dot', () => {
  const result = validateTaskId('task.');
  assert.equal(result.ok, false);
  assert.match(result.reason, /dấu chấm/);
});

test('validateTaskId rejects trailing space', () => {
  const result = validateTaskId('task ');
  assert.equal(result.ok, false);
  assert.match(result.reason, /khoảng trắng/);
});

test('validateTaskId rejects reserved name CON', () => {
  const result = validateTaskId('CON');
  assert.equal(result.ok, false);
  assert.match(result.reason, /dự trữ/);
});

test('validateTaskId rejects reserved name con.txt', () => {
  const result = validateTaskId('con.txt');
  assert.equal(result.ok, false);
  assert.match(result.reason, /dự trữ/);
});

test('validateTaskId rejects empty id', () => {
  const result = validateTaskId('');
  assert.equal(result.ok, false);
  assert.match(result.reason, /trống/);
});

test('validateTaskId rejects whitespace-only id', () => {
  const result = validateTaskId('   ');
  assert.equal(result.ok, false);
  assert.match(result.reason, /trống/);
});

test('validateTaskId rejects id longer than 64 characters', () => {
  const long = 'a'.repeat(65);
  const result = validateTaskId(long);
  assert.equal(result.ok, false);
  assert.match(result.reason, /64/);
});
