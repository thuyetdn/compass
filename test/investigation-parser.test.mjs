import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInvestigation, validateForClose } from '../lib/investigation-parser.mjs';

const TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'investigation.md',
);

const COMPLETE = `# INV-1: Lịch ngừng cập nhật

**Mở:** 2026-09-05
**Vùng nghi:** outlook sync

## Triệu chứng

Lịch của 3 khách hàng ngừng cập nhật từ 2026-09-01. Cron vẫn chạy, không log lỗi.

## Giả thuyết

### H1: deltaToken hết hạn
**Cách kiểm:** gọi Graph bằng token đang lưu, xem mã trả về
**Kết quả:** đúng — Graph trả 410 Gone

### H2: cron bị tắt
**Cách kiểm:** đọc log scheduler 7 ngày gần nhất
**Kết quả:** sai — cron chạy đủ 672 lần

## Bằng chứng

\`\`\`
GET /me/calendarView/delta → 410 Gone
{"error":{"code":"resyncRequired"}}
\`\`\`

## Kết luận

deltaToken sống 30 ngày. Hết hạn thì Graph trả 410, mà syncEvents không bắt mã này nên throw,
cron chết âm thầm.

## Pitfall

**Gặp:** 2026-09-05 · INV-1
**Triệu chứng:** cron chạy nhưng dữ liệu đứng yên, không log lỗi
**Nguyên nhân:** deltaToken hết hạn sau 30 ngày
**Vùng ảnh hưởng:** src/modules/outlook/calendar-sync.service.ts
**Phòng tránh:** bắt 410 → xóa token → full sync lại

## Việc cần làm tiếp

Mở task BUILD sửa calendar-sync.service.ts.
`;

test('H2 a complete investigation parses into its parts', () => {
  const parsed = parseInvestigation(COMPLETE);
  assert.match(parsed.symptom, /3 khách hàng/);
  assert.match(parsed.evidence, /410 Gone/);
  assert.match(parsed.conclusion, /deltaToken sống 30 ngày/);
  assert.match(parsed.pitfall, /Phòng tránh/);
});

test('H6 each hypothesis keeps its method and result together', () => {
  const { hypotheses } = parseInvestigation(COMPLETE);
  assert.equal(hypotheses.length, 2);
  assert.equal(hypotheses[0].id, 'H1');
  assert.match(hypotheses[0].method, /gọi Graph/);
  assert.match(hypotheses[0].result, /đúng/);
  assert.match(hypotheses[1].result, /sai/);
});

test('H3 a complete investigation is allowed to close', () => {
  const result = validateForClose(parseInvestigation(COMPLETE));
  assert.equal(result.ok, true, result.errors.join(' · '));
});

test('EC2 a disproved hypothesis does not block closing', () => {
  // H2 came back false. That is a result, not a gap.
  const { hypotheses } = parseInvestigation(COMPLETE);
  assert.match(hypotheses[1].result, /sai/);
  assert.equal(validateForClose(parseInvestigation(COMPLETE)).ok, true);
});

test('V1 closing without a conclusion is refused', () => {
  const source = COMPLETE.replace(/## Kết luận\n\n[\s\S]*?\n\n## Pitfall/, '## Kết luận\n\n\n## Pitfall');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Kết luận')));
});

test('V2 closing without a pitfall is refused', () => {
  const source = COMPLETE.replace(/## Pitfall\n\n[\s\S]*?\n\n## Việc cần làm tiếp/, '## Pitfall\n\n\n## Việc cần làm tiếp');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Pitfall')));
});

test('V3 a hypothesis with no stated test method is refused, by id', () => {
  const source = COMPLETE.replace('**Cách kiểm:** gọi Graph bằng token đang lưu, xem mã trả về', '**Cách kiểm:**');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('H1') && e.includes('cách kiểm')));
});

test('V4 a conclusion with no evidence behind it is refused', () => {
  const source = COMPLETE.replace(/## Bằng chứng\n\n[\s\S]*?\n\n## Kết luận/, '## Bằng chứng\n\n\n## Kết luận');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Bằng chứng')));
});

test('a hypothesis still marked unchecked blocks closing', () => {
  const source = COMPLETE.replace('**Kết quả:** đúng — Graph trả 410 Gone', '**Kết quả:** chưa kiểm');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('H1')));
});

test('EC1 an untouched template counts as empty everywhere', () => {
  // Read the real template, not a paraphrase: a hand-copied fixture once left
  // out the five "**Nhãn:** <...>" lines that made the bug possible, so the
  // test passed while an untouched Pitfall block closed an investigation.
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const result = validateForClose(parseInvestigation(template));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Pitfall')),
    'template chưa điền thì mục Pitfall phải bị coi là trống');
  assert.ok(result.errors.length >= 5, `phải bắt nhiều mục trống, thấy: ${result.errors.length}`);
});

test('an investigation with no hypotheses at all is refused', () => {
  const source = COMPLETE.replace(/## Giả thuyết\n\n[\s\S]*?\n## Bằng chứng/, '## Giả thuyết\n\n## Bằng chứng');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('giả thuyết')));
});

test('every gap is reported at once, not one per run', () => {
  const source = COMPLETE
    .replace(/## Kết luận\n\n[\s\S]*?\n\n## Pitfall/, '## Kết luận\n\n\n## Pitfall')
    .replace(/## Pitfall\n\n[\s\S]*?\n\n## Việc cần làm tiếp/, '## Pitfall\n\n\n## Việc cần làm tiếp');
  const result = validateForClose(parseInvestigation(source));
  assert.ok(result.errors.length >= 2);
});
