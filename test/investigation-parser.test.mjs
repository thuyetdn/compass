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

test('CP-11-H2 a complete investigation parses into its parts', () => {
  const parsed = parseInvestigation(COMPLETE);
  assert.match(parsed.symptom, /3 khách hàng/);
  assert.match(parsed.evidence, /410 Gone/);
  assert.match(parsed.conclusion, /deltaToken sống 30 ngày/);
  assert.match(parsed.pitfall, /Phòng tránh/);
});

test('CP-11-H6 each hypothesis keeps its method and result together', () => {
  const { hypotheses } = parseInvestigation(COMPLETE);
  assert.equal(hypotheses.length, 2);
  assert.equal(hypotheses[0].id, 'H1');
  assert.match(hypotheses[0].method, /gọi Graph/);
  assert.match(hypotheses[0].result, /đúng/);
  assert.match(hypotheses[1].result, /sai/);
});

test('CP-11-H7 a complete investigation is allowed to close', () => {
  const result = validateForClose(parseInvestigation(COMPLETE));
  assert.equal(result.ok, true, result.errors.join(' · '));
});

test('CP-11-EC2 a disproved hypothesis does not block closing', () => {
  // H2 came back false. That is a result, not a gap.
  const { hypotheses } = parseInvestigation(COMPLETE);
  assert.match(hypotheses[1].result, /sai/);
  assert.equal(validateForClose(parseInvestigation(COMPLETE)).ok, true);
});

test('CP-11-V1 closing without a conclusion is refused', () => {
  const source = COMPLETE.replace(/## Kết luận\n\n[\s\S]*?\n\n## Pitfall/, '## Kết luận\n\n\n## Pitfall');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Kết luận')));
});

test('CP-11-V10 closing without a pitfall is refused', () => {
  const source = COMPLETE.replace(/## Pitfall\n\n[\s\S]*?\n\n## Việc cần làm tiếp/, '## Pitfall\n\n\n## Việc cần làm tiếp');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Pitfall')));
});

test('CP-11-V3 a hypothesis with no stated test method is refused, by id', () => {
  const source = COMPLETE.replace('**Cách kiểm:** gọi Graph bằng token đang lưu, xem mã trả về', '**Cách kiểm:**');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('H1') && e.includes('cách kiểm')));
});

test('CP-11-V4 a conclusion with no evidence behind it is refused', () => {
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

test('CP-11-EC9 an untouched template counts as empty everywhere', () => {
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

test('CP-11-V8 a half-filled pitfall block is refused, naming the untouched lines', () => {
  // The block is copied verbatim into the pitfall library, so one real line
  // among four placeholders would file template text there for good.
  const source = COMPLETE.replace(
    /## Pitfall\n\n[\s\S]*?\n\n## Việc cần làm tiếp/,
    `## Pitfall

**Gặp:** <ngày · id · bối cảnh>
**Triệu chứng:** <nhận ra bằng dấu hiệu gì>
**Nguyên nhân:** <vì sao>
**Vùng ảnh hưởng:** <file / module>
**Phòng tránh:** bắt 410 rồi full sync lại

## Việc cần làm tiếp`);

  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Gặp')), result.errors.join(' · '));
  assert.ok(result.errors.some((e) => e.includes('Nguyên nhân')));
  assert.ok(!result.errors.some((e) => e.includes('Phòng tránh')), 'dòng đã điền không được kêu');
});

test('a fully filled pitfall block passes', () => {
  assert.equal(validateForClose(parseInvestigation(COMPLETE)).ok, true);
});

test('CP-11-EC7 a JSX tag in the pitfall is content, not a leftover hint', () => {
  // "<SaveButton />" is a real answer to "which area is affected". Refusing it
  // tells the author they left a field blank when they filled it in.
  for (const answer of ['<SaveButton />', '<Modal />', '<select>']) {
    const source = COMPLETE.replace(
      '**Vùng ảnh hưởng:** src/modules/outlook/calendar-sync.service.ts',
      `**Vùng ảnh hưởng:** ${answer}`);
    const result = validateForClose(parseInvestigation(source));
    assert.equal(result.ok, true, `${answer} bị chặn oan: ${result.errors.join(' · ')}`);
  }
});

test('a template hint with separators is still caught', () => {
  for (const hint of ['<ngày · id · bối cảnh>', '<file / module>', '<vì sao>']) {
    const source = COMPLETE.replace('**Nguyên nhân:** deltaToken hết hạn sau 30 ngày',
      `**Nguyên nhân:** ${hint}`);
    const result = validateForClose(parseInvestigation(source));
    assert.equal(result.ok, false, `${hint} phải bị coi là chưa điền`);
  }
});

test('CP-11-V9 every hint the template ships is recognised, however short', () => {
  // Guessing by shape let one-word hints through: `<ngày>`, `<vì sao>`, `<...>`
  // all lack the whitespace an earlier rule looked for. Drive the check off
  // every hint in the real template rather than off a heuristic.
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const hints = [...new Set(template.match(/<[^>]*>/g) ?? [])];
  assert.ok(hints.length >= 10, `template phải có nhiều gợi ý, thấy ${hints.length}`);

  for (const hint of hints) {
    if (hint === '<INV-ID>') continue; // replaced at creation, never left behind
    const source = COMPLETE.replace('**Nguyên nhân:** deltaToken hết hạn sau 30 ngày',
      `**Nguyên nhân:** ${hint}`);
    const result = validateForClose(parseInvestigation(source));
    assert.equal(result.ok, false, `gợi ý ${hint} phải bị coi là chưa điền`);
  }
});

test('CP-11-V11 a hypothesis whose method is the template hint is caught', () => {
  // The rule "state how you will test before you test" was going unenforced
  // whenever the author left the shorter of the two template hints in place.
  const source = COMPLETE.replace('**Cách kiểm:** đọc log scheduler 7 ngày gần nhất',
    '**Cách kiểm:** <...>');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('H2') && e.includes('cách kiểm')),
    result.errors.join(' · '));
});

test('CP-11-EC8 an investigation saved with CRLF reads the same as one with LF', () => {
  // Windows editors write CRLF, and this repo has core.autocrlf on. A trailing
  // CR defeated every end-of-line anchor: the hypotheses disappeared and the
  // gate insisted none were written, which is a lie about a filled-in file.
  const lf = COMPLETE.replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');

  const fromLf = parseInvestigation(lf);
  const fromCrlf = parseInvestigation(crlf);

  assert.equal(fromCrlf.hypotheses.length, fromLf.hypotheses.length);
  assert.deepEqual(fromCrlf.hypotheses.map((h) => h.id), fromLf.hypotheses.map((h) => h.id));
  assert.equal(validateForClose(fromCrlf).ok, validateForClose(fromLf).ok);
  assert.equal(validateForClose(fromCrlf).ok, true);
});

test('CRLF does not hide a genuinely unfilled section either', () => {
  // The fix must not make the parser lenient — an empty conclusion still blocks.
  const source = COMPLETE
    .replace(/## Kết luận\n\n[\s\S]*?\n\n## Pitfall/, '## Kết luận\n\n\n## Pitfall')
    .replace(/\n/g, '\r\n');
  const result = validateForClose(parseInvestigation(source));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Kết luận')));
});

test('CP-11-V12 a bullet-listed placeholder is still a placeholder', () => {
  // Bullet-hoá một danh sách năm dòng là thói quen markdown bình thường. Không
  // nhận ra thì cả năm dòng chữ mẫu được chép nguyên vào knowledge base — đúng
  // thứ V6/V8 sinh ra để chặn.
  const hoSo = COMPLETE.replace(
    /## Pitfall[\s\S]*?(?=\n## |$)/,
    ['## Pitfall',
     '',
     '- **Gặp:** <ngày · id · bối cảnh>',
     '- **Triệu chứng:** <thấy gì>',
     '- **Nguyên nhân:** <vì sao>',
     '- **Vùng ảnh hưởng:** <file nào>',
     '- **Phòng tránh:** <lần sau làm gì>',
     ''].join('\n'));

  const r = validateForClose(parseInvestigation(hoSo));
  assert.equal(r.ok, false, 'chữ mẫu có dấu đầu dòng vẫn là chữ mẫu');
  assert.ok(r.errors.some((e) => /Gặp/.test(e)), `phải nêu tên dòng, thấy: ${r.errors.join(' | ')}`);
});

test('CP-11-V13 every markdown list prefix still counts as a placeholder', () => {
  // Lần trước chỉ thêm `[-*+]` vì "bullet-hoá là thói quen bình thường". Đánh số,
  // blockquote, checkbox cũng vậy — và cả ba vẫn lọt. Vá một trong bốn cách viết
  // không phải là vá.
  for (const dau of ['', '- ', '* ', '1. ', '2) ', '> ', '- [ ] ', '> - ']) {
    const hoSo = COMPLETE.replace(
      /## Pitfall[\s\S]*?(?=\n## |$)/,
      ['## Pitfall', '',
       `${dau}**Gặp:** <ngày · id · bối cảnh>`,
       `${dau}**Triệu chứng:** <thấy gì>`,
       ''].join('\n'));
    const r = validateForClose(parseInvestigation(hoSo));
    assert.equal(r.ok, false, `tiền tố ${JSON.stringify(dau)} vẫn là chữ mẫu`);
  }
});

test('CP-11-V14 real content with a list prefix is not mistaken for a placeholder', () => {
  // Mặt còn lại: nới ra không được nuốt nội dung thật.
  const hoSo = COMPLETE.replace(
    /## Pitfall[\s\S]*?(?=\n## |$)/,
    ['## Pitfall', '',
     '- **Gặp:** 2026-09-06 · INV-1 · gate đỏ chập chờn',
     '- **Triệu chứng:** hai gate liên tiếp tranh cổng',
     '- **Nguyên nhân:** shell thoát trước tiến trình con',
     '- **Vùng ảnh hưởng:** lib/dev-server.mjs',
     '- **Phòng tránh:** giết theo cây rồi đợi nó chết',
     ''].join('\n'));
  const r = validateForClose(parseInvestigation(hoSo));
  assert.equal(r.ok, true, `nội dung thật có bullet vẫn hợp lệ: ${r.errors.join(' | ')}`);
});

test('CP-11-V15 a bulleted method line is read, not reported as blank', () => {
  // `parseHypotheses` neo cứng `^**Cách kiểm:**` trong khi `PLACEHOLDER` vừa được
  // dạy rằng bullet là bình thường. Không nhận thì gate bảo người viết bỏ trống
  // ô họ vừa điền.
  const s = [
    '# INV-1: x', '', '## Giả thuyết', '',
    '### H1: một giả thuyết',
    '- **Cách kiểm:** gọi Graph bằng token đang lưu',
    '**Kết quả:** đúng',
  ].join('\n');
  const p = parseInvestigation(s);
  assert.equal(p.hypotheses[0].method, 'gọi Graph bằng token đang lưu');
});

test('CP-11-V16 a ticked checkbox in either case is still a list prefix', () => {
  // GitHub sinh `[X]` hoa khi người ta tick ô trên giao diện. Chỉ nhận `x`
  // thường thì đúng cách người dùng thật hay tạo ra lại lọt.
  for (const dau of ['- [ ] ', '- [x] ', '- [X] ', '* [X] ', '1. [x] ']) {
    const hoSo = COMPLETE.replace(
      /## Pitfall[\s\S]*?(?=\n## |$)/,
      ['## Pitfall', '', `${dau}**Gặp:** <ngày · id · bối cảnh>`, ''].join('\n'));
    assert.equal(validateForClose(parseInvestigation(hoSo)).ok, false,
      `checkbox ${JSON.stringify(dau)} vẫn là tiền tố danh sách`);
  }
});

test('CP-11-V17 both hypothesis lines accept a list prefix, not just one', () => {
  // Vá một dòng mà bỏ dòng kia còn tệ hơn không vá: hồ sơ bullet-hoá cả hai —
  // cách viết markdown tự nhiên nhất — parse được `Cách kiểm` mà mất `Kết quả`,
  // rồi gate báo "chưa có kết quả kiểm" cho ô người ta vừa điền.
  for (const dau of ['', '- ', '1. ', '> ', '  ']) {
    const s = [
      '# INV-1: x', '', '## Giả thuyết', '',
      '### H1: một giả thuyết',
      `${dau}**Cách kiểm:** gọi Graph bằng token đang lưu`,
      `${dau}**Kết quả:** đúng như dự đoán`,
    ].join('\n');
    const gt = parseInvestigation(s).hypotheses[0];
    assert.equal(gt.method, 'gọi Graph bằng token đang lưu', `method với ${JSON.stringify(dau)}`);
    assert.equal(gt.result, 'đúng như dự đoán', `result với ${JSON.stringify(dau)}`);
  }
});

// CP-39 — `**Cách kiểm:**` gains the full-word form `**Cách kiểm tra:**`.
// INV-1 and INV-2 on disk use the old form and must keep parsing.

const HYP = (method, result = '**Kết quả:** đúng — 1 dòng') => `# INV-9: Một triệu chứng

## Triệu chứng

Có.

## Giả thuyết

### H1: một giả thuyết
${method}
${result}
`;

test('CP-39-H3 `**Cách kiểm tra:**` fills the hypothesis method', () => {
  const parsed = parseInvestigation(HYP('**Cách kiểm tra:** run X'));
  assert.equal(parsed.hypotheses[0].method, 'run X');
});

test('CP-39-H4 the old `**Cách kiểm:**` still fills the method', () => {
  const parsed = parseInvestigation(HYP('**Cách kiểm:** run X'));
  assert.equal(parsed.hypotheses[0].method, 'run X');
});

test('CP-39-H5 a result of `chưa kiểm tra` is still a placeholder', () => {
  const parsed = parseInvestigation(HYP('**Cách kiểm tra:** run X', '**Kết quả:** chưa kiểm tra'));
  const { errors } = validateForClose(parsed);
  assert.ok(errors.some((e) => e === 'Giả thuyết H1 chưa có kết quả kiểm tra'), errors.join('\n'));
});

test('CP-39-V3 a hypothesis with neither method form names the missing check in full words', () => {
  const parsed = parseInvestigation(HYP(''));
  const { errors } = validateForClose(parsed);
  assert.ok(errors.includes('Giả thuyết H1 không nêu cách kiểm tra'), errors.join('\n'));
  assert.ok(!errors.some((e) => /cách kiểm$/.test(e)), 'không còn dạng rút gọn');
});

test('CP-39-EC5 the two tracked investigations on disk report no missing method', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.compass');
  for (const id of ['INV-1', 'INV-2']) {
    const parsed = parseInvestigation(readFileSync(path.join(root, id, 'investigation.md'), 'utf8'));
    assert.ok(parsed.hypotheses.length > 0, `${id} phải có giả thuyết`);
    const errors = validateForClose(parsed).errors.filter((e) => /không nêu cách kiểm/.test(e));
    assert.deepEqual(errors, [], `${id}: ${errors.join('; ')}`);
  }
});
