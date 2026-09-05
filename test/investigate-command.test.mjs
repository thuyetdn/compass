import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { investigateCommand } from '../commands/investigate.mjs';
import { scriptsCommand } from '../commands/scripts.mjs';
import { statusCommand } from '../commands/status.mjs';
import { readGate } from '../lib/gate-store.mjs';
import { hashSource } from '../lib/source-hash.mjs';

function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-inv-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'true' }));
  return root;
}

const FILLED = `# INV-1: Lịch ngừng cập nhật

## Triệu chứng

Lịch 3 khách hàng đứng yên từ 2026-09-01.

## Giả thuyết

### H1: deltaToken hết hạn
**Cách kiểm:** gọi Graph bằng token đang lưu
**Kết quả:** đúng — trả 410

## Bằng chứng

GET /calendarView/delta → 410 Gone

## Kết luận

deltaToken hết hạn sau 30 ngày, syncEvents không bắt 410 nên cron chết âm thầm.

## Pitfall

**Gặp:** 2026-09-05 · INV-1
**Nguyên nhân:** deltaToken sống 30 ngày
**Phòng tránh:** bắt 410 rồi full sync lại

## Việc cần làm tiếp

Mở task BUILD sửa calendar-sync.service.ts.
`;

test('H1 opening an investigation writes the template', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(existsSync(path.join(root, '.compass', 'INV-1', 'investigation.md')));
  assert.match(result.output, /Ba luật cứng/);
});

test('the opened file carries the investigation id', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-7' });
  const doc = readFileSync(path.join(root, '.compass', 'INV-7', 'investigation.md'), 'utf8');
  assert.match(doc, /INV-7/);
  assert.ok(!doc.includes('<INV-ID>'));
});

test('E1 opening twice refuses rather than overwriting the work so far', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const file = path.join(root, '.compass', 'INV-1', 'investigation.md');
  writeFileSync(file, 'ĐÃ ĐIỀU TRA ĐƯỢC MỘT NỬA');

  const result = investigateCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(result.exitCode, 2);
  assert.equal(readFileSync(file, 'utf8'), 'ĐÃ ĐIỀU TRA ĐƯỢC MỘT NỬA');
});

test('E2 closing something never opened is a usage error', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: 'INV-9', close: true });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Chưa mở/);
});

test('EC1 closing an untouched template is refused with the gaps named', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Kết luận|Pitfall/);
});

test('H3 a filled investigation closes and records a signed entry', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), FILLED);

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 0, result.output);

  const gate = readGate(root, 'INV-1', 'investigate');
  assert.equal(gate.hypothesisCount, 1);
  assert.equal(gate.pitfallWritten, true);
  assert.ok(gate.sig.startsWith('sha256:'));
});

test('V2 closing appends the pitfall to the knowledge base', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), FILLED);
  investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

  const pitfalls = readFileSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md'), 'utf8');
  assert.match(pitfalls, /deltaToken sống 30 ngày/);
  assert.match(pitfalls, /Lịch ngừng cập nhật/);
});

test('two investigations both leave their lesson behind', () => {
  const root = makeRepo();
  for (const id of ['INV-1', 'INV-2']) {
    investigateCommand({ cwd: root, taskId: id });
    writeFileSync(path.join(root, '.compass', id, 'investigation.md'),
      FILLED.replace('INV-1', id).replace('deltaToken sống 30 ngày', `nguyên nhân của ${id}`));
    investigateCommand({ cwd: root, taskId: id, close: true });
  }
  const pitfalls = readFileSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md'), 'utf8');
  assert.match(pitfalls, /nguyên nhân của INV-1/);
  assert.match(pitfalls, /nguyên nhân của INV-2/);
});

test('V5 an invalid id creates nothing', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: 'a/b' });
  assert.equal(result.exitCode, 2);
  assert.equal(existsSync(path.join(root, '.compass', 'a')), false);
});

test('S1 an id trying to escape the directory is refused', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: '../escape' });
  assert.equal(result.exitCode, 2);
  assert.equal(existsSync(path.join(root, '..', 'escape')), false);
});

test('E3 a deleted file mid-investigation is reported, not crashed on', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  rmSync(path.join(root, '.compass', 'INV-1', 'investigation.md'));

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 2);
});

test('EC3 status on an investigation directory says so instead of crashing', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const result = statusCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /spec|điều tra/i);
});

test('H5 scripts --list on an empty library explains what it is for', () => {
  const root = makeRepo();
  const result = scriptsCommand({ cwd: root });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /Chưa có script/);
});

test('H4 scripts --list shows each script and its purpose line', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'find-orphans.mjs'), '// Tìm contact không còn chủ\nconsole.log(1);\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /find-orphans\.mjs/);
  assert.match(result.output, /Tìm contact không còn chủ/);
});

test('EC4 a script in a subdirectory is listed with its path', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts', 'db');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'orphans.sql'), '-- Đếm bản ghi mồ côi\nSELECT 1;\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /db\/orphans\.sql/);
  assert.match(result.output, /Đếm bản ghi mồ côi/);
});

test('E4 a script with no comment header is listed, marked as undescribed', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bare.mjs'), 'console.log("không có mô tả");\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /bare\.mjs/);
  assert.match(result.output, /chưa có dòng comment/);
});

test('S2 listing scripts never executes them', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  const marker = path.join(root, 'ĐÃ-CHẠY.txt');
  writeFileSync(path.join(dir, 'evil.mjs'),
    `// Script này không được chạy\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);

  scriptsCommand({ cwd: root });
  assert.equal(existsSync(marker), false, 'scripts --list không được thực thi script');
});

test('opening an investigation does not disturb the source hash', () => {
  const root = makeRepo();
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  const before = hashSource(root);

  investigateCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(hashSource(root), before);
});

test('V6 an untouched pitfall block cannot close an investigation', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const file = path.join(root, '.compass', 'INV-1', 'investigation.md');

  // Fill everything except the Pitfall block, left exactly as the template
  // wrote it — labelled placeholders that once read as real content.
  const filled = readFileSync(file, 'utf8')
    .replace('# INV-1: <triệu chứng, một câu>', '# INV-1: Lịch ngừng cập nhật')
    .replace('<Người dùng thấy gì. Số liệu nếu có: bao nhiêu ca, từ khi nào, tần suất.>', 'Lịch 3 khách hàng đứng yên.')
    .replace('### H1: <giả thuyết>', '### H1: token hết hạn')
    .replace('**Cách kiểm:** <lệnh, script, hay phép đo cụ thể — làm gì thì biết đúng hay sai>', '**Cách kiểm:** gọi API bằng token cũ')
    .replace('**Kết quả:** <chưa kiểm | đúng | sai — kèm số liệu>', '**Kết quả:** đúng — trả 410')
    .replace('<Output thật, số đo thật. Dán vào, đừng kể lại.>', 'GET /delta → 410')
    .replace('<Nguyên nhân gốc. Phải dẫn được về bằng chứng ở trên, không phải suy luận.>', 'Token sống 30 ngày.')
    .replace('<Task BUILD nào cần mở để sửa. Ghi "không cần" nếu điều tra kết luận là không phải lỗi.>', 'không cần');
  writeFileSync(file, filled);

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /Pitfall/);
  assert.equal(existsSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md')), false,
    'không được ghi chữ mẫu vào kho pitfall');
});

test('V7 a title left as template text blocks closing', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const file = path.join(root, '.compass', 'INV-1', 'investigation.md');
  writeFileSync(file, FILLED.replace('# INV-1: Lịch ngừng cập nhật', '# INV-1: <triệu chứng, một câu>'));

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /tiêu đề/);
});

test('EC5 an existing pitfalls file with no trailing newline stays readable', () => {
  const root = makeRepo();
  const pitfalls = path.join(root, '.knowledge', 'decided', 'pitfalls.md');
  mkdirSync(path.dirname(pitfalls), { recursive: true });
  writeFileSync(pitfalls, '# Bẫy đã từng sập\n\nMột đoạn cũ không xuống dòng ở cuối');

  investigateCommand({ cwd: root, taskId: 'INV-1' });
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), FILLED);
  investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

  const text = readFileSync(pitfalls, 'utf8');
  assert.match(text, /không xuống dòng ở cuối\n/, 'đoạn cũ phải giữ nguyên và được tách dòng');
  assert.match(text, /\n## INV-1/);
});
