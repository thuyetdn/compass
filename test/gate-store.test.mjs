import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeGate, readGates, readGate, verifyAllGates } from '../lib/gate-store.mjs';
import { gatePath } from '../lib/paths.mjs';

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
  assert.deepEqual(verifyAllGates(root, 'T-1'), { ok: true, tampered: [] });
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
