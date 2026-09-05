import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getSalt, signRecord, verifyRecord } from '../lib/signature.mjs';

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-sig-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{}');
  return root;
}

test('getSalt creates a salt file when absent', () => {
  const root = makeRoot();
  const salt = getSalt(root);
  assert.match(salt, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(path.join(root, '.compass', '.salt'), 'utf8'), salt);
});

test('getSalt reuses the existing salt', () => {
  const root = makeRoot();
  assert.equal(getSalt(root), getSalt(root));
});

test('signRecord produces a stable signature regardless of key order', () => {
  const salt = 'abc';
  const a = signRecord({ gate: 'test', exitCode: 0 }, salt);
  const b = signRecord({ exitCode: 0, gate: 'test' }, salt);
  assert.equal(a, b);
});

test('verifyRecord accepts an untouched record', () => {
  const salt = 'abc';
  const record = { gate: 'test', exitCode: 0 };
  record.sig = signRecord(record, salt);
  assert.equal(verifyRecord(record, salt), true);
});

test('verifyRecord rejects a tampered exitCode', () => {
  const salt = 'abc';
  const record = { gate: 'test', exitCode: 1 };
  record.sig = signRecord(record, salt);
  record.exitCode = 0;
  assert.equal(verifyRecord(record, salt), false);
});

test('verifyRecord rejects a record signed with a different salt', () => {
  const record = { gate: 'test', exitCode: 0 };
  record.sig = signRecord(record, 'salt-one');
  assert.equal(verifyRecord(record, 'salt-two'), false);
});

test('verifyRecord rejects a record without a signature', () => {
  assert.equal(verifyRecord({ gate: 'test' }, 'abc'), false);
});
