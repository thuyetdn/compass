import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256, hashFile, hashFiles } from '../lib/hash.mjs';

test('sha256 returns a prefixed hex digest', () => {
  const result = sha256('hello');
  assert.match(result, /^sha256:[0-9a-f]{64}$/);
});

test('sha256 is deterministic', () => {
  assert.equal(sha256('same input'), sha256('same input'));
});

test('sha256 differs for different input', () => {
  assert.notEqual(sha256('a'), sha256('b'));
});

test('hashFile hashes file content', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-hash-'));
  const file = path.join(dir, 'a.txt');
  writeFileSync(file, 'content');
  assert.equal(hashFile(file), sha256('content'));
});

test('hashFile returns a missing marker for absent files', () => {
  assert.equal(hashFile('/definitely/not/here.txt'), 'sha256:missing');
});

test('hashFiles is independent of input order', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-hash-'));
  const a = path.join(dir, 'a.txt');
  const b = path.join(dir, 'b.txt');
  writeFileSync(a, 'aaa');
  writeFileSync(b, 'bbb');
  assert.equal(hashFiles([a, b]), hashFiles([b, a]));
});

test('hashFiles changes when any file changes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-hash-'));
  const a = path.join(dir, 'a.txt');
  writeFileSync(a, 'first');
  const before = hashFiles([a]);
  writeFileSync(a, 'second');
  assert.notEqual(hashFiles([a]), before);
});
