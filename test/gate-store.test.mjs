import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeGate, readGates, readGate, verifyAllGates } from '../lib/gate-store.mjs';
import { gatePath } from '../lib/paths.mjs';
import { getSalt, signRecord } from '../lib/signature.mjs';

function makeTask() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-gate-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{"test":"npm test"}');
  return root;
}

test('writeGate stores a signed record', () => {
  const root = makeTask();
  const record = writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  assert.match(record.sig, /^sha256:[0-9a-f]{64}$/);
});

test('readGate returns a stored record', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  assert.equal(readGate(root, 'T-1', 'test').exitCode, 0);
});

test('readGate returns null for an unknown gate', () => {
  const root = makeTask();
  assert.equal(readGate(root, 'T-1', 'never-ran'), null);
});

test('readGates returns an empty object before any gate runs', () => {
  const root = makeTask();
  assert.deepEqual(readGates(root, 'T-1'), {});
});

test('writeGate keeps records for other gates', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'spec', exitCode: 0 });
  writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  const gates = readGates(root, 'T-1');
  assert.deepEqual(Object.keys(gates).sort(), ['spec', 'test']);
});

test('writeGate overwrites a rerun of the same gate', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'test', exitCode: 1 });
  writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  assert.equal(readGate(root, 'T-1', 'test').exitCode, 0);
});

test('verifyAllGates passes for untouched records', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'spec', exitCode: 0 });
  writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  assert.deepEqual(verifyAllGates(root, 'T-1'), {
    ok: true, tampered: [], misslotted: [], wrongTask: [], outdated: [],
  });
});

test('verifyAllGates detects a hand-edited exitCode', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'test', exitCode: 1 });
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.test.exitCode = 0;
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = verifyAllGates(root, 'T-1');
  assert.equal(result.ok, false);
  assert.deepEqual(result.tampered, ['test']);
});

test('readGates returns empty object when file does not exist', () => {
  const root = makeTask();
  assert.deepEqual(readGates(root, 'T-1'), {});
});

test('readGates throws when gate.json exists but contains invalid JSON', () => {
  const root = makeTask();
  const file = gatePath(root, 'T-1');
  writeFileSync(file, '{ khong phai json');
  assert.throws(() => readGates(root, 'T-1'), /gate.json hỏng/);
});

test('verifyAllGates returns ok: false for corrupt gate.json', () => {
  const root = makeTask();
  const file = gatePath(root, 'T-1');
  writeFileSync(file, '{ khong phai json');
  const result = verifyAllGates(root, 'T-1');
  assert.equal(result.ok, false);
  assert(result.tampered.length > 0);
  assert.deepEqual(result.tampered, ['<gate.json hỏng>']);
});

test('readGate throws for corrupt gate.json', () => {
  const root = makeTask();
  const file = gatePath(root, 'T-1');
  writeFileSync(file, '{ khong phai json');
  assert.throws(() => readGate(root, 'T-1', 'test'), /gate.json hỏng/);
});

test('verifyAllGates reports corruption after writing a gate and corrupting the file', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  const file = gatePath(root, 'T-1');
  writeFileSync(file, '{ khong phai json');
  const result = verifyAllGates(root, 'T-1');
  assert.equal(result.ok, false);
  assert.deepEqual(result.tampered, ['<gate.json hỏng>']);
});

test('writeGate stamps the record with the given taskId', () => {
  const root = makeTask();
  const record = writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  assert.equal(record.taskId, 'T-1');
});

// C1 — a genuinely-signed record moved onto a different gate's key must be caught.
test('verifyAllGates detects a record copied onto a different gate key (misslotted)', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'spec', exitCode: 0 });
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.test = data.spec; // still signed correctly, but its own "gate" field says "spec"
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = verifyAllGates(root, 'T-1');
  assert.equal(result.ok, false);
  assert.deepEqual(result.misslotted, ['test']);
  assert.deepEqual(result.tampered, []);
});

// C2 — a record signed for a different task must be caught even though its signature verifies.
test('verifyAllGates detects a record belonging to a different taskId (wrongTask)', () => {
  const root = makeTask();
  writeGate(root, 'T-OTHER', { gate: 'test', exitCode: 0 });
  const otherFile = gatePath(root, 'T-OTHER');
  const otherRecord = JSON.parse(readFileSync(otherFile, 'utf8')).test;

  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(gatePath(root, 'T-1'), JSON.stringify({ test: otherRecord }, null, 2));

  const result = verifyAllGates(root, 'T-1');
  assert.equal(result.ok, false);
  assert.deepEqual(result.wrongTask, ['test']);
  assert.deepEqual(result.tampered, []);
});

test('verifyAllGates flags a genuinely-signed record with no taskId as outdated, not tampered', () => {
  const root = makeTask();
  // Simulate evidence written by a version before taskId existed: sign a record
  // that never had the field, so the signature is genuinely valid for its content.
  const salt = getSalt(root);
  const oldStyleRecord = { gate: 'test', exitCode: 0 };
  const signed = { ...oldStyleRecord, sig: signRecord(oldStyleRecord, salt) };
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(gatePath(root, 'T-1'), JSON.stringify({ test: signed }, null, 2));

  const result = verifyAllGates(root, 'T-1');
  assert.equal(result.ok, false);
  assert.deepEqual(result.tampered, []);
  assert.deepEqual(result.outdated, ['test']);
});

test('readGates throws with COMPASS_GATE_CORRUPT code for unparseable JSON', () => {
  const root = makeTask();
  const file = gatePath(root, 'T-1');
  writeFileSync(file, '{ not valid json');
  let error;
  try {
    readGates(root, 'T-1');
  } catch (err) {
    error = err;
  }
  assert(error, 'should throw');
  assert.equal(error.code, 'COMPASS_GATE_CORRUPT');
  assert.match(error.message, /gate.json hỏng/);
  assert(error.cause, 'should have cause property');
});

test('readGates throws for directory at gate.json path with non-corrupt code', () => {
  const root = makeTask();
  const file = gatePath(root, 'T-1');
  mkdirSync(file);
  let error;
  try {
    readGates(root, 'T-1');
  } catch (err) {
    error = err;
  }
  assert(error, 'should throw');
  assert.notEqual(error.code, 'COMPASS_GATE_CORRUPT');
  assert(error.code, 'should have a code');
  // On Windows, code is EISDIR; on Unix as well
  assert.match(error.code, /EISDIR|EACCES|EPERM/);
});

test('readGates corruption error carries the original error as cause', () => {
  const root = makeTask();
  const file = gatePath(root, 'T-1');
  writeFileSync(file, 'not json');
  let error;
  try {
    readGates(root, 'T-1');
  } catch (err) {
    error = err;
  }
  assert(error.cause, 'cause should exist');
  assert(error.cause instanceof SyntaxError, 'cause should be SyntaxError from JSON.parse');
});
