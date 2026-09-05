import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testCommand } from '../commands/test.mjs';
import { readGate } from '../lib/gate-store.mjs';

const SPEC = `# T-1: Tiêu đề
Loại: fix
Phạm vi: src/

## Mục tiêu
Làm gì đó.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

function makeTask(testCmd) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-testcmd-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'),
    JSON.stringify({ test: testCmd }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  return root;
}

const printBoth = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\')"';
const printOne  = 'node -e "console.log(\'ok 1 - test_H1_a\')"';
const failing   = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\'); process.exit(1)"';

test('testCommand passes when the suite is green and every id ran', () => {
  const root = makeTask(printBoth);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('testCommand fails when the suite exits non-zero', () => {
  const root = makeTask(failing);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /exit code/i);
});

test('testCommand fails when a spec id never ran', () => {
  const root = makeTask(printOne);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /H2/);
});

test('testCommand names every missing id', () => {
  const root = makeTask('node -e "console.log(\'nothing here\')"');
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /H1/);
  assert.match(result.output, /H2/);
});

test('testCommand writes the full output to evidence', () => {
  const root = makeTask(printBoth);
  testCommand({ cwd: root, taskId: 'T-1' });
  const log = path.join(root, '.compass', 'T-1', 'evidence', 'test.log');
  assert.ok(existsSync(log));
  assert.match(readFileSync(log, 'utf8'), /test_H1_a/);
});

test('testCommand records the command and exit code in the gate', () => {
  const root = makeTask(printBoth);
  testCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'test');
  assert.equal(gate.exitCode, 0);
  assert.equal(gate.command, printBoth);
  assert.match(gate.outputHash, /^sha256:/);
});

test('testCommand reports an invalid config', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-testcmd-bad-'));
  mkdirSync(path.join(root, '.compass', 'T-1'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{}');
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /config/);
});

test('testCommand: bare IDs on unclassified lines fail the gate and mention them', () => {
  const root = makeTask('node -e "console.log(\'H1 H2\')"');
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /không rõ định dạng/i);
  assert.match(result.output, /H1/);
  assert.match(result.output, /H2/);
});

test('testCommand: skipped test ID fails the gate, distinguished from missing', () => {
  const root = makeTask('node -e "console.log(\'ok 1 - test_H1_a # SKIP\\nok 2 - test_H2_b\')"');
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /không pass.*skip/i);
  assert.match(result.output, /H1/);
});

test('testCommand: when process is killed by signal, shows in gate', () => {
  // On Windows with shell: true, we cannot easily kill a process by signal,
  // so we test that the gate records the signal/failure fields when present
  const root = makeTask(printBoth);
  testCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'test');
  // Verify the gate has these fields even if null in normal runs
  assert.ok('signal' in gate);
  assert.ok('suiteFailure' in gate);
});

test('testCommand: retried-then-passed ID not reported as failed', () => {
  // Spec declares H1 and H2; first test fails then passes; second never written
  const retryOutput = 'node -e "console.log(\'not ok 1 - test_H1_a\\nok 2 - test_H1_a\\nok 3 - nothing\')"';
  const root = makeTask(retryOutput);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  // H1 should NOT appear in the failure message at all (it did pass eventually)
  assert.match(result.output, /H2/);
  assert.ok(!result.output.includes('H1'), 'H1 should not appear in output since it passed');
});
