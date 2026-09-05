import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { specCommand } from '../commands/spec.mjs';
import { readGate } from '../lib/gate-store.mjs';

const VALID_SPEC = `# T-1: Tiêu đề
Loại: fix
Phạm vi: src/

## Mục tiêu
Làm gì đó.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có vùng nào bị ảnh hưởng.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Trường hợp chính | Trả về đúng | P0 |
| H2 | Happy | Trường hợp chính 2 | Trả về đúng | P0 |
`;

function makeTask(specText) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-speccmd-'));
  mkdirSync(path.join(root, '.compass', 'T-1'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{"test":"npm test"}');
  if (specText !== null) {
    writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), specText);
  }
  return root;
}

test('specCommand passes a valid spec', () => {
  const root = makeTask(VALID_SPEC);
  const result = specCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /✓/);
});

test('specCommand records a signed gate on pass', () => {
  const root = makeTask(VALID_SPEC);
  specCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'spec');
  assert.equal(gate.exitCode, 0);
  assert.match(gate.specHash, /^sha256:/);
});

test('specCommand fails an invalid spec and lists reasons', () => {
  const root = makeTask(VALID_SPEC.replace('Không có vùng nào bị ảnh hưởng.', ''));
  const result = specCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /hồi quy/);
});

test('specCommand records the failure too', () => {
  const root = makeTask(VALID_SPEC.replace('| H2 | Happy | Trường hợp chính 2 | Trả về đúng | P0 |', ''));
  specCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(readGate(root, 'T-1', 'spec').exitCode, 1);
});

test('specCommand reports a missing spec file', () => {
  const root = makeTask(null);
  const result = specCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không tìm thấy spec/);
});

test('specCommand reports a missing task id', () => {
  const root = makeTask(VALID_SPEC);
  const result = specCommand({ cwd: root, taskId: undefined });
  assert.equal(result.exitCode, 2);
});
