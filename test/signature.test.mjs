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

test('signRecord detects changes in nested object values', () => {
  const salt = 'abc';
  const a = signRecord({ gate: 'test', evidence: { exitCode: 0, log: 'clean' } }, salt);
  const b = signRecord({ gate: 'test', evidence: { exitCode: 1, log: 'FAILED' } }, salt);
  assert.notEqual(a, b);
});

test('signRecord produces stable signature regardless of nested key order', () => {
  const salt = 'abc';
  const a = signRecord({ gate: 'test', evidence: { exitCode: 0, log: 'x' } }, salt);
  const b = signRecord({ gate: 'test', evidence: { log: 'x', exitCode: 0 } }, salt);
  assert.equal(a, b);
});

test('signRecord detects changes in array contents and order', () => {
  const salt = 'abc';
  const a = signRecord({ gate: 'test', missingIds: ['EC3', 'S2'] }, salt);
  const b = signRecord({ gate: 'test', missingIds: ['EC3', 'S3'] }, salt);
  const c = signRecord({ gate: 'test', missingIds: ['S2', 'EC3'] }, salt);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('verifyRecord rejects a tampered nested value', () => {
  const salt = 'abc';
  const record = { gate: 'test', evidence: { exitCode: 0, log: 'clean' } };
  record.sig = signRecord(record, salt);
  record.evidence.exitCode = 1;
  assert.equal(verifyRecord(record, salt), false);
});
