import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkCommand } from '../commands/check.mjs';
import { doneCommand } from '../commands/done.mjs';
import { statusCommand } from '../commands/status.mjs';
import { gatePath } from '../lib/paths.mjs';

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

const GREEN = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\')"';
const RED   = 'node -e "console.log(\'ok 1 - test_H1_a\'); process.exit(1)"';

function makeTask(testCmd, specText = SPEC) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-check-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: testCmd }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), specText);
  return root;
}

test('checkCommand runs every applicable gate and passes', () => {
  const root = makeTask(GREEN);
  const result = checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /spec/);
  assert.match(result.output, /test/);
});

test('checkCommand stops at the first failing gate', () => {
  const badSpec = SPEC.replace('Không có.\n\n## Test cases', '\n\n## Test cases');
  const root = makeTask(GREEN, badSpec);
  const result = checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.ok(!result.output.includes('Gate test'));
});

test('checkCommand reports gates not yet implemented as skipped', () => {
  const root = makeTask(GREEN);
  const result = checkCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(result.output, /Gate convention FAILED/);
});

test('checkCommand honours --only', () => {
  const root = makeTask(RED);
  const result = checkCommand({ cwd: root, taskId: 'T-1', only: 'spec' });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, /Gate test/);
});

test('doneCommand passes after a clean check', () => {
  const root = makeTask(GREEN);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('doneCommand fails when a required gate never ran', () => {
  const root = makeTask(GREEN);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /chưa chạy/);
});

test('doneCommand fails when a gate exited non-zero', () => {
  const root = makeTask(RED);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
});

test('doneCommand detects a hand-edited gate record', () => {
  const root = makeTask(RED);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.test.exitCode = 0;
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /chữ ký/);
});

test('doneCommand detects a spec edited after the test gate ran', () => {
  const root = makeTask(GREEN);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const spec = path.join(root, '.compass', 'T-1', 'spec.md');
  writeFileSync(spec, SPEC + '\n<!-- sửa sau khi test đã chạy -->\n');
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Spec đã thay đổi/);
});

test('statusCommand lists gate state', () => {
  const root = makeTask(GREEN);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /spec/);
  assert.match(result.output, /test/);
});
