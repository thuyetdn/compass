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

test('CP-11-H1 opening an investigation writes the template', () => {
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

test('CP-11-E1 opening twice refuses rather than overwriting the work so far', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const file = path.join(root, '.compass', 'INV-1', 'investigation.md');
  writeFileSync(file, 'ĐÃ ĐIỀU TRA ĐƯỢC MỘT NỬA');

  const result = investigateCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(result.exitCode, 2);
  assert.equal(readFileSync(file, 'utf8'), 'ĐÃ ĐIỀU TRA ĐƯỢC MỘT NỬA');
});

test('CP-11-E2 closing something never opened is a usage error', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: 'INV-9', close: true });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Chưa mở/);
});

test('CP-11-EC1 closing an untouched template is refused with the gaps named', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Kết luận|Pitfall/);
});

test('CP-11-H3 a filled investigation closes and records a signed entry', () => {
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

test('CP-11-H8 closing appends the pitfall to the knowledge base', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), FILLED);
  investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

  const pitfalls = readFileSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md'), 'utf8');
  assert.match(pitfalls, /deltaToken sống 30 ngày/);
  assert.match(pitfalls, /Lịch ngừng cập nhật/);
});

test('CP-11-V2 closing with an empty pitfall is refused', () => {
  // Điều tra không để lại bài học thì người sau sập đúng hố đó. Đây là lý do
  // vòng phản hồi tồn tại, nên nó phải chặn — không phải cảnh báo rồi cho qua.
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });

  const khongPitfall = FILLED.replace(
    /## Pitfall[\s\S]*?(?=\n## |$)/,
    '## Pitfall' + '\n\n');
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), khongPitfall);

  const r = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(r.exitCode, 1, 'thiếu pitfall thì không đóng được');
  assert.match(r.output, /Pitfall/);
  assert.ok(!existsSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md')),
    'từ chối đóng thì không được ghi gì vào knowledge base');
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

test('CP-11-V5 an invalid id creates nothing', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: 'a/b' });
  assert.equal(result.exitCode, 2);
  assert.equal(existsSync(path.join(root, '.compass', 'a')), false);
});

test('CP-11-S1 an id trying to escape the directory is refused', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: '../escape' });
  assert.equal(result.exitCode, 2);
  assert.equal(existsSync(path.join(root, '..', 'escape')), false);
});

test('CP-11-E3 a deleted file mid-investigation is reported, not crashed on', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  rmSync(path.join(root, '.compass', 'INV-1', 'investigation.md'));

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 2);
});

test('CP-11-EC3 status on an investigation says it is one, not that a spec is missing', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });

  const result = statusCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(result.exitCode, 2);
  // The earlier assertion allowed /spec/, which the generic "no spec found"
  // message satisfies — it passed with no investigation handling at all.
  assert.match(result.output, /là một điều tra/);
  assert.match(result.output, /investigation\.md/);
});

test('status on a task that simply has no spec still says so plainly', () => {
  const root = makeRepo();
  const result = statusCommand({ cwd: root, taskId: 'T-KHONG-CO' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không tìm thấy spec/);
});

test('CP-11-H5 scripts --list on an empty library explains what it is for', () => {
  const root = makeRepo();
  const result = scriptsCommand({ cwd: root });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /Chưa có script/);
});

test('CP-11-H4 scripts --list shows each script and its purpose line', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'find-orphans.mjs'), '// Tìm contact không còn chủ\nconsole.log(1);\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /find-orphans\.mjs/);
  assert.match(result.output, /Tìm contact không còn chủ/);
});

test('CP-11-EC4 a script in a subdirectory is listed with its path', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts', 'db');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'orphans.sql'), '-- Đếm bản ghi mồ côi\nSELECT 1;\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /db\/orphans\.sql/);
  assert.match(result.output, /Đếm bản ghi mồ côi/);
});

test('CP-11-E4 a script with no comment header is listed, marked as undescribed', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bare.mjs'), 'console.log("không có mô tả");\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /bare\.mjs/);
  assert.match(result.output, /chưa có dòng comment/);
});

test('CP-11-S2 listing scripts never executes them', () => {
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

test('CP-11-V6 an untouched pitfall block cannot close an investigation', () => {
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

test('CP-11-V7 a title left as template text blocks closing', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const file = path.join(root, '.compass', 'INV-1', 'investigation.md');
  writeFileSync(file, FILLED.replace('# INV-1: Lịch ngừng cập nhật', '# INV-1: <triệu chứng, một câu>'));

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /tiêu đề/);
});

test('CP-11-EC5 an existing pitfalls file with no trailing newline stays readable', () => {
  const root = makeRepo();
  const pitfalls = path.join(root, '.knowledge', 'decided', 'pitfalls.md');
  mkdirSync(path.dirname(pitfalls), { recursive: true });
  writeFileSync(pitfalls, '# Bẫy đã từng sập\n\nMột đoạn cũ không xuống dòng ở cuối');

  investigateCommand({ cwd: root, taskId: 'INV-1' });
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), FILLED);
  investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

  const text = readFileSync(pitfalls, 'utf8');
  // Đo đúng chỗ nối. Khẳng định `\n## INV-1` là rỗng nghĩa: chuỗi ghép đã có
  // `\n## ` cứng sẵn, nên nó đúng kể cả khi bỏ hẳn logic thêm dấu ngắt.
  const noi = text.slice(text.indexOf('không xuống dòng ở cuối'));
  assert.match(noi, /^không xuống dòng ở cuối\n\n## INV-1/,
    `đoạn cũ và mục mới phải cách nhau một dòng trống, thấy: ${JSON.stringify(noi.slice(0, 60))}`);
});

test('CP-11-EC6 a script opening with a block comment shows the line below it', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'block.mjs'), '/**\n * Đếm bản ghi mồ côi trong DB\n */\nconsole.log(1);\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /Đếm bản ghi mồ côi trong DB/);
  assert.ok(!/^\s+\*$/m.test(result.output), 'không được lấy dấu sao làm mô tả');
});

test('CP-11-P1 listing scripts reads headers, not whole files', () => {
  // Liệt kê một thư viện không được tốn bằng đọc nó.
  //
  // Fixture phải đặt phần mô tả **sau** vùng header và không có gì cản đường:
  // `purposeOf` dừng ở dòng không-comment đầu tiên, nên một khối code lớn ở
  // giữa sẽ chặn nó bất kể đọc bao nhiêu byte — và test xanh kể cả khi giới
  // hạn header bị gỡ sạch. Bản đầu của ca này đã mắc đúng lỗi đó.
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });

  const SAU_HEADER = 'MO_TA_NAM_SAU_HEADER';
  writeFileSync(path.join(dir, 'to.mjs'), '\n'.repeat(200000) + `// ${SAU_HEADER}` + '\n');
  writeFileSync(path.join(dir, 'nho.mjs'), '// dọn thư mục tạm' + '\n');

  const result = scriptsCommand({ cwd: root });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /dọn thư mục tạm/, 'header trong tầm vẫn phải đọc được');
  assert.ok(!result.output.includes(SAU_HEADER), 'không được đọc quá vùng header');
});
