import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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

test('doneCommand for feature-m reports unimplemented gates on pass', () => {
  // Build a feature-m spec with 21 test cases spanning all 6 layers
  // Counts: Happy 4, Validation 4, Error 4, Edge 4, Security 3, Performance 2 = 21
  const rows = [
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
    '| H1 | Happy | Case 1 | Pass | P0 |',
    '| H2 | Happy | Case 2 | Pass | P0 |',
    '| H3 | Happy | Case 3 | Pass | P0 |',
    '| H4 | Happy | Case 4 | Pass | P0 |',
    '| V1 | Validation | Case 5 | Pass | P0 |',
    '| V2 | Validation | Case 6 | Pass | P0 |',
    '| V3 | Validation | Case 7 | Pass | P0 |',
    '| V4 | Validation | Case 8 | Pass | P0 |',
    '| E1 | Error | Case 9 | Pass | P0 |',
    '| E2 | Error | Case 10 | Pass | P0 |',
    '| E3 | Error | Case 11 | Pass | P0 |',
    '| E4 | Error | Case 12 | Pass | P0 |',
    '| X1 | Edge | Case 13 | Pass | P0 |',
    '| X2 | Edge | Case 14 | Pass | P0 |',
    '| X3 | Edge | Case 15 | Pass | P0 |',
    '| X4 | Edge | Case 16 | Pass | P0 |',
    '| S1 | Security | Case 17 | Pass | P0 |',
    '| S2 | Security | Case 18 | Pass | P0 |',
    '| S3 | Security | Case 19 | Pass | P0 |',
    '| P1 | Performance | Case 20 | Pass | P0 |',
    '| P2 | Performance | Case 21 | Pass | P0 |',
  ];

  const featureMSpec = `# T-FM: Feature trung bình
Loại: feature-m
Phạm vi: src/

## Mục tiêu
Làm gì đó lớn.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
${rows.join('\n')}
`;

  const testLines = [
    'ok 1 - test_H1_a', 'ok 2 - test_H2_a', 'ok 3 - test_H3_a', 'ok 4 - test_H4_a',
    'ok 5 - test_V1_a', 'ok 6 - test_V2_a', 'ok 7 - test_V3_a', 'ok 8 - test_V4_a',
    'ok 9 - test_E1_a', 'ok 10 - test_E2_a', 'ok 11 - test_E3_a', 'ok 12 - test_E4_a',
    'ok 13 - test_X1_a', 'ok 14 - test_X2_a', 'ok 15 - test_X3_a', 'ok 16 - test_X4_a',
    'ok 17 - test_S1_a', 'ok 18 - test_S2_a', 'ok 19 - test_S3_a',
    'ok 20 - test_P1_a', 'ok 21 - test_P2_a'
  ];
  const greenForFeatureM = 'node -e "' + testLines.map(line => `console.log('${line}')`).join('; ') + '"';

  const root = mkdtempSync(path.join(tmpdir(), 'compass-check-'));
  mkdirSync(path.join(root, '.compass', 'T-FM', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: greenForFeatureM }));
  writeFileSync(path.join(root, '.compass', 'T-FM', 'spec.md'), featureMSpec);

  checkCommand({ cwd: root, taskId: 'T-FM' });
  const result = doneCommand({ cwd: root, taskId: 'T-FM' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /convention, review/);
  assert.match(result.output, /chưa xây dựng/);

  rmSync(root, { recursive: true });
});

test('doneCommand for fix task does NOT report unimplemented gates on pass', () => {
  const root = makeTask(GREEN);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, /chưa xây dựng/);
});

test('doneCommand for feature-m reports unimplemented gates on fail', () => {
  // Build a feature-m spec with 21 test cases spanning all 6 layers
  // Counts: Happy 4, Validation 4, Error 4, Edge 4, Security 3, Performance 2 = 21
  const layers = ['Happy', 'Validation', 'Error', 'Edge', 'Security', 'Performance'];
  const rows = [
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
  ];
  let id = 1;
  for (const layer of layers) {
    let count;
    if (layer === 'Happy') count = 4;
    else if (layer === 'Validation') count = 4;
    else if (layer === 'Error') count = 4;
    else if (layer === 'Edge') count = 4;
    else if (layer === 'Security') count = 3;
    else count = 2; // Performance

    for (let i = 0; i < count; i++) {
      const testId = `${layer.substring(0, 2)}_${id}`;
      rows.push(`| ${testId} | ${layer} | Case ${id} | Pass | P0 |`);
      id++;
    }
  }

  const featureMSpec = `# T-FM2: Feature trung bình
Loại: feature-m
Phạm vi: src/

## Mục tiêu
Làm gì đó lớn.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
${rows.join('\n')}
`;

  const root = mkdtempSync(path.join(tmpdir(), 'compass-check-'));
  mkdirSync(path.join(root, '.compass', 'T-FM2', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: RED }));
  writeFileSync(path.join(root, '.compass', 'T-FM2', 'spec.md'), featureMSpec);

  checkCommand({ cwd: root, taskId: 'T-FM2' });
  const result = doneCommand({ cwd: root, taskId: 'T-FM2' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /convention, review/);
  assert.match(result.output, /chưa xây dựng/);

  rmSync(root, { recursive: true });
});

test('doneCommand with corrupt gate.json returns exit 2 with clean message', () => {
  const root = makeTask(GREEN);
  checkCommand({ cwd: root, taskId: 'T-1' });

  const gateFile = gatePath(root, 'T-1');
  writeFileSync(gateFile, 'not valid json {');

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không thể đọc ledger gate/);
  assert.doesNotMatch(result.output, /at readGates/);
});

test('statusCommand with corrupt gate.json returns exit 2 with clean message', () => {
  const root = makeTask(GREEN);
  checkCommand({ cwd: root, taskId: 'T-1' });

  const gateFile = gatePath(root, 'T-1');
  writeFileSync(gateFile, 'not valid json {');

  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không thể đọc ledger gate/);
  assert.doesNotMatch(result.output, /at readGates/);
});
