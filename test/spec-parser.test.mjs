import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../lib/spec-parser.mjs';

const SAMPLE = `# T-001: Thêm bộ lọc theo quốc gia
Loại: feature-s
Phạm vi: nexus-app-backend/src/modules/mastercontact

## Mục tiêu
Người dùng lọc contact theo quốc gia.

## Ràng buộc
Không đổi shape của response hiện tại.

## Rủi ro hồi quy
Trang Browse Members dùng chung endpoint này.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Lọc theo 1 quốc gia | Trả đúng danh sách | P0 |
| H2 | Happy | Lọc theo nhiều quốc gia | Trả hợp của các tập | P0 |
| V1 | Validation | Mã quốc gia không tồn tại | 400 kèm thông báo | P1 |
`;

test('parseSpec reads the task id and title', () => {
  const spec = parseSpec(SAMPLE);
  assert.equal(spec.taskId, 'T-001');
  assert.equal(spec.title, 'Thêm bộ lọc theo quốc gia');
});

test('parseSpec reads the task type', () => {
  assert.equal(parseSpec(SAMPLE).type, 'feature-s');
});

test('parseSpec reads the scope', () => {
  assert.equal(parseSpec(SAMPLE).scope, 'nexus-app-backend/src/modules/mastercontact');
});

test('parseSpec collects named sections', () => {
  const spec = parseSpec(SAMPLE);
  assert.match(spec.sections.get('Mục tiêu'), /lọc contact theo quốc gia/);
  assert.match(spec.sections.get('Rủi ro hồi quy'), /Browse Members/);
});

test('parseSpec extracts every test case row', () => {
  const cases = parseSpec(SAMPLE).testCases;
  assert.equal(cases.length, 3);
  assert.deepEqual(cases.map((c) => c.id), ['H1', 'H2', 'V1']);
});

test('parseSpec keeps each test case field', () => {
  const first = parseSpec(SAMPLE).testCases[0];
  assert.equal(first.id, 'H1');
  assert.equal(first.layer, 'Happy');
  assert.equal(first.description, 'Lọc theo 1 quốc gia');
  assert.equal(first.expected, 'Trả đúng danh sách');
  assert.equal(first.priority, 'P0');
});

test('parseSpec ignores the table separator row', () => {
  const ids = parseSpec(SAMPLE).testCases.map((c) => c.id);
  assert.ok(!ids.some((id) => id.startsWith('--')));
});

test('parseSpec returns empty test cases when the table is absent', () => {
  const spec = parseSpec('# T-002: Không có bảng\nLoại: fix\n');
  assert.deepEqual(spec.testCases, []);
});
