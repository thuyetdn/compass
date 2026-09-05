import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../lib/spec-validator.mjs';

function buildSpec({ type = 'fix', regression = 'Không có', rows = [] } = {}) {
  const table = rows.length
    ? ['| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
       '|----|-----|-------|---------|---------|',
       ...rows].join('\n')
    : '';
  return `# T-001: Tiêu đề
Loại: ${type}
Phạm vi: src/

## Mục tiêu
Làm gì đó.

## Ràng buộc
Không có.

## Rủi ro hồi quy
${regression}

## Test cases
${table}
`;
}

const happy = (n) => `| H${n} | Happy | Mô tả ${n} | Kỳ vọng ${n} | P0 |`;

test('validateSpec accepts a minimal valid fix spec', () => {
  const result = validateSpec(buildSpec({ type: 'fix', rows: [happy(1), happy(2)] }));
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('validateSpec rejects an unknown task type', () => {
  const result = validateSpec(buildSpec({ type: 'huge', rows: [happy(1), happy(2)] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Loại')));
});

test('validateSpec rejects leftover TBD markers', () => {
  const spec = buildSpec({ type: 'fix', regression: 'TBD', rows: [happy(1), happy(2)] });
  const result = validateSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('TBD')));
});

test('validateSpec rejects an empty regression section', () => {
  const result = validateSpec(buildSpec({ type: 'fix', regression: '', rows: [happy(1), happy(2)] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('hồi quy')));
});

test('validateSpec rejects too few test cases', () => {
  const result = validateSpec(buildSpec({ type: 'fix', rows: [happy(1)] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('tối thiểu')));
});

test('validateSpec rejects a spec missing a required layer', () => {
  const rows = Array.from({ length: 6 }, (_, i) => happy(i + 1));
  const result = validateSpec(buildSpec({ type: 'bug', rows }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Validation')));
});

test('validateSpec rejects duplicate test case ids', () => {
  const result = validateSpec(buildSpec({ type: 'fix', rows: [happy(1), happy(1)] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('trùng')));
});

test('validateSpec rejects a test case with an empty expectation', () => {
  const rows = [happy(1), '| H2 | Happy | Có mô tả |  | P0 |'];
  const result = validateSpec(buildSpec({ type: 'fix', rows }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('H2')));
});

test('validateSpec reports every problem at once', () => {
  const result = validateSpec(buildSpec({ type: 'huge', regression: '', rows: [] }));
  assert.ok(result.errors.length >= 3);
});

test('validateSpec rejects empty test table with valid type', () => {
  const result = validateSpec(buildSpec({ type: 'fix', regression: 'Không có', rows: [] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('ít nhất 1 test case')));
});

test('validateSpec accepts spec with valid type and at least one test case', () => {
  const result = validateSpec(buildSpec({ type: 'fix', regression: 'Không có', rows: [happy(1), happy(2)] }));
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.ok(!result.errors.some((e) => e.includes('ít nhất 1 test case')));
});
