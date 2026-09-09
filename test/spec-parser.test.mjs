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


const MINIMAL = [
  '# T-1: Tiêu đề',
  'Loại: fix',
  'Phạm vi: src/',
  '',
  '## Test cases',
  '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
  '|----|-----|-------|---------|---------|',
  '| H1 | Happy | a | b | P0 |',
].join('\n');

const SPEC_WITH_COMMAND = MINIMAL.replace(
  'Phạm vi: src/', 'Phạm vi: src/' + '\n' + 'Lệnh test: npm run test:deep');

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

test('parseSpec records 4-cell row in malformedRows', () => {
  const spec = parseSpec(`# T-001: Test
Loại: fix

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng |
|----|-----|-------|---------|
| H1 | Happy | a | b |
`);
  assert.equal(spec.testCases.length, 0);
  assert.equal(spec.malformedRows.length, 1);
  assert.equal(spec.malformedRows[0].cellCount, 4);
  assert.match(spec.malformedRows[0].text, /H1/);
});

test('parseSpec records 6-cell row in malformedRows', () => {
  const spec = parseSpec(`# T-001: Test
Loại: fix

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | a | b | P0 | x |
`);
  assert.equal(spec.testCases.length, 0);
  assert.equal(spec.malformedRows.length, 1);
  assert.equal(spec.malformedRows[0].cellCount, 6);
});

test('parseSpec records row with pipe in cell as malformed', () => {
  const spec = parseSpec(`# T-001: Test
Loại: fix

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | a|b | c | P0 |
`);
  assert.equal(spec.testCases.length, 0);
  assert.equal(spec.malformedRows.length, 1);
  assert.ok(!spec.testCases.some((c) => c.priority === 'c'));
});

test('parseSpec returns empty malformedRows for well-formed table', () => {
  const spec = parseSpec(SAMPLE);
  assert.deepEqual(spec.malformedRows, []);
});

test('parseSpec reads Loại and Phạm vi after ## heading', () => {
  const spec = parseSpec(`# T-001: Test

## Mục tiêu
Làm gì đó.

Loại: bug
Phạm vi: src/lib

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | a | b | P0 |
`);
  assert.equal(spec.type, 'bug');
  assert.equal(spec.scope, 'src/lib');
});

test('parseSpec takes first Loại and Phạm vi when duplicated', () => {
  const spec = parseSpec(`# T-001: Test
Loại: fix
Phạm vi: src/first

## Mục tiêu
Loại: bug
Phạm vi: src/second

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | a | b | P0 |
`);
  assert.equal(spec.type, 'fix');
  assert.equal(spec.scope, 'src/first');
});

test('CP-19-H1 a spec can declare the test command it needs', () => {
  // Compass có hai suite: nhanh và sâu. Task nào cần suite sâu mà gate chạy
  // suite nhanh thì nó báo thiếu test cho những ca đang xanh.
  const spec = parseSpec(SPEC_WITH_COMMAND);
  assert.equal(spec.testCommand, 'npm run test:deep');
});

test('CP-19-H2 a spec without the field leaves the command to config', () => {
  assert.equal(parseSpec(MINIMAL).testCommand, null, 'không khai thì để config quyết');
});

test('CP-19-V1 an empty command line counts as not declared', () => {
  const spec = parseSpec(SPEC_WITH_COMMAND.replace('npm run test:deep', '   '));
  assert.equal(spec.testCommand, null, 'khai rỗng không được thành lệnh rỗng');
});

// ---- CP-34: mỗi task khai gốc soi của chính nó ----

function withLine(line) {
  return MINIMAL.replace('Phạm vi: src/', `Phạm vi: src/\n${line}`);
}

test('CP-34-H1 parseSpec reads a declared review base', () => {
  const s = parseSpec(withLine('Gốc soi: a509f50'));
  assert.equal(s.reviewBase, 'a509f50');
});

test('CP-34-V1 an empty declaration is ignored, like an empty Lệnh test', () => {
  const s = parseSpec(withLine('Gốc soi:   '));
  assert.equal(s.reviewBase, null, 'khai rỗng thì coi như không khai, để config lo');
});

test('CP-34-V2 the first declaration wins when the line appears twice', () => {
  const s = parseSpec(withLine('Gốc soi: aaaaaaa\nGốc soi: bbbbbbb'));
  assert.equal(s.reviewBase, 'aaaaaaa');
});

test('CP-34-V3 surrounding whitespace is trimmed', () => {
  const s = parseSpec(withLine('Gốc soi:    a509f50   '));
  assert.equal(s.reviewBase, 'a509f50');
});

test('CP-34-EC2 a CRLF spec yields a ref with no trailing CR', () => {
  const s = parseSpec(withLine('Gốc soi: a509f50').replace(/\n/g, '\r\n'));
  assert.equal(s.reviewBase, 'a509f50', 'CR lọt vào ref thì git không phân giải được');
});


test('CP-34-H3 a spec declaring nothing parses exactly as before', () => {
  const s = parseSpec(MINIMAL);
  assert.equal(s.reviewBase, null);
  // Trường mới không được đẩy hay che các trường cũ.
  assert.equal(s.type, 'fix');
  assert.equal(s.scope, 'src/');
  assert.equal(s.testCases.length, 1);
});

test('CP-34-EC4 examples under headings are ignored even when they come first', () => {
  // Spec hướng dẫn cách dùng phải trích chính dòng khai, nên ví dụ và lời khai
  // thật cùng nằm trong một file. Lời khai thật ở vùng đầu; ví dụ ở dưới heading.
  const s = parseSpec([
    // Ví dụ ĐỨNG TRƯỚC trong file, nên first-wins một mình sẽ chọn nó. Chỉ luật
    // vị trí mới cho ra kết quả đúng — đặt lời khai thật lên trước thì ca này
    // trùng V2 và không canh được gì.
    '# T-1: x', 'Loại: fix', 'Phạm vi: src/', '',
    '## Cách dùng', '```', 'Gốc soi: trong-vi-du', '```', '',
    '## Ghi chú', 'Gốc soi: cung-trong-tai-lieu', '',
    '## Test cases',
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
    '| H1 | Happy | a | b | P0 |',
  ].join('\n'));
  assert.equal(s.reviewBase, null, 'không lời khai nào ở vùng đầu thì để config lo');
});

test('CP-34-EC6 a declaration below the first heading is not a declaration', () => {
  // Vị trí đo được; "dòng này có phải ví dụ không" thì không. Bốn lần thử đọc
  // fence cho đúng đều sập — lần tệ nhất là phạm vi soi lấy từ một dòng trong
  // tài liệu. Luật vị trí không có cửa đó, và cũng không cần fence nào cả.
  const s = parseSpec([
    '# T-1: x', 'Loại: fix', 'Phạm vi: src/', '',
    '## Mục tiêu', '```', 'quen dong fence', '',
    '## Cách dùng', '```', 'Gốc soi: trong-vi-du', '```', '',
    '## Test cases',
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
    '| H1 | Happy | a | b | P0 |',
  ].join('\n'));
  assert.equal(s.reviewBase, null, 'không lời khai nào ở vùng đầu thì để config lo');
});

test('CP-34-EC7 fence lines stay in the section text they belong to', () => {
  // Không đụng tới nội dung section. Một bản trước đã bỏ qua dòng ``` và làm
  // lệch cách đọc ba spec đang chạy: section chỉ có khối code đọc ra rỗng.
  const s = parseSpec([
    '# T-1: x', 'Loại: fix', 'Phạm vi: src/', '',
    '## Ràng buộc', '```json', '{ "a": 1 }', '```', '',
    '## Test cases',
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
    '| H1 | Happy | a | b | P0 |',
  ].join('\n'));
  const rb = s.sections.get('Ràng buộc');
  assert.match(rb, /```json/, 'dòng fence là nội dung của section, không được xoá');
  assert.match(rb, /"a": 1/);
});
