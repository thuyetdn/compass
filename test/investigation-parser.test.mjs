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

// --- CP-45: `DAU_DONG` was a `(X)+` whose every branch could match empty, so a
// run of indentation could be split between `[>\s]*` and `\s*` in exponentially
// many ways. On a line that then failed to match, the engine tried every split:
// 14 spaces cost 1.1 s on HEAD, and each further pair of spaces multiplied that
// by roughly twelve. A list nested four deep at a 4-space indent hung
// `investigate --close` for minutes with no output.

// Thirteen prefixes measured as accepted on HEAD, and one measured as rejected.
const PREFIXES = ['', '- ', '* ', '+ ', '  - ', '1. ', '2) ', '> ', '> - ', '- [ ] ', '- [x] ', '   ', '>  1.  [ ]  '];

// A whole investigation file, with `body` dropped into the hypothesis section.
function fileWith(body) {
  return COMPLETE.replace(
    '### H1: deltaToken hết hạn\n**Cách kiểm:** gọi Graph bằng token đang lưu, xem mã trả về\n**Kết quả:** đúng — Graph trả 410 Gone',
    `### H1: deltaToken hết hạn\n${body}`,
  );
}

test('CP-45-H1 all thirteen prefixes still carry a Kết quả line', () => {
  for (const prefix of PREFIXES) {
    const doc = fileWith(`**Cách kiểm:** c\n${prefix}**Kết quả:** x`);
    const parsed = parseInvestigation(doc);
    const h1 = parsed.hypotheses.find((h) => h.id === 'H1');
    assert.equal(h1?.result, 'x', `tiền tố ${JSON.stringify(prefix)} phải bắt được "x"`);
  }
});

test('CP-45-H2 both Cách kiểm spellings parse behind a bare and a stacked prefix', () => {
  for (const keyword of ['Cách kiểm', 'Cách kiểm tra']) {
    for (const prefix of ['- ', '>  1.  [ ]  ']) {
      const doc = fileWith(`${prefix}**${keyword}:** y\n**Kết quả:** z`);
      const h1 = parseInvestigation(doc).hypotheses.find((h) => h.id === 'H1');
      assert.equal(h1?.method, 'y', `${keyword} sau ${JSON.stringify(prefix)}`);
    }
  }
});

test('CP-45-H3 a file with three-deep nested bullets parses as before', () => {
  const doc = fileWith('    - **Cách kiểm:** c\n      - **Kết quả:** r');
  const h1 = parseInvestigation(doc).hypotheses.find((h) => h.id === 'H1');
  assert.equal(h1.method, 'c');
  assert.equal(h1.result, 'r');
});

test('CP-45-V1 a template placeholder is still recognised behind every prefix', () => {
  // Chi chuoi CO THAT trong template moi tinh la chu mau: module doc chung tu
  // file chu khong doan theo hinh dang, nen mot chuoi bia ra nhu `<ket qua>`
  // la noi dung that. Doc hint tu chinh template de test khong tu bia chuan.
  const hint = readFileSync(TEMPLATE_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('**Kết quả:**'))
    .replace('**Kết quả:**', '')
    .trim();

  for (const prefix of ['', '- ', '1. ', '> ', '- [ ] ']) {
    const doc = fileWith(`**Cách kiểm:** c\n${prefix}**Kết quả:** ${hint}`);
    const report = validateForClose(parseInvestigation(doc));
    assert.equal(report.ok, false, `chữ mẫu sau ${JSON.stringify(prefix)} phải bị chặn`);
  }
});

test('CP-45-V2 text before the prefix still fails to match', () => {
  const doc = fileWith('**Cách kiểm:** c\nabc **Kết quả:** x');
  const h1 = parseInvestigation(doc).hypotheses.find((h) => h.id === 'H1');
  assert.notEqual(h1?.result, 'x', '"abc" đứng trước thì không phải dòng kết quả');
});

test('CP-45-V3 a quote marker after a bullet is still not a prefix', () => {
  const doc = fileWith('**Cách kiểm:** c\n- > **Kết quả:** x');
  const h1 = parseInvestigation(doc).hypotheses.find((h) => h.id === 'H1');
  assert.notEqual(h1?.result, 'x');
});

test('CP-45-E1 two hundred spaces alone parse quickly and do not throw', () => {
  const doc = fileWith(`**Cách kiểm:** c\n${' '.repeat(200)}\n**Kết quả:** x`);
  const started = Date.now();
  parseInvestigation(doc);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 200, `mất ${elapsed}ms, ngưỡng 200ms`);
});

test('CP-45-E2 a line of prefix characters with no keyword matches nothing', () => {
  const doc = fileWith('**Cách kiểm:** c\n>  - [ ]  \n**Kết quả:** x');
  const h1 = parseInvestigation(doc).hypotheses.find((h) => h.id === 'H1');
  assert.equal(h1.result, 'x', 'dòng chỉ có ký tự tiền tố không nuốt dòng kết quả thật');
});

test('CP-45-EC1 an empty Kết quả value still captures the empty string', () => {
  const doc = fileWith('**Cách kiểm:** c\n**Kết quả:**');
  const h1 = parseInvestigation(doc).hypotheses.find((h) => h.id === 'H1');
  assert.equal(h1.result, '');
});

test('CP-45-EC2 sixteen spaces of indent parse and capture', () => {
  const doc = fileWith(`**Cách kiểm:** c\n${' '.repeat(16)}**Kết quả:** x`);
  const h1 = parseInvestigation(doc).hypotheses.find((h) => h.id === 'H1');
  assert.equal(h1.result, 'x');
});

test('CP-45-EC3 a tab as indentation still parses', () => {
  const doc = fileWith('**Cách kiểm:** c\n\t- **Kết quả:** x');
  const h1 = parseInvestigation(doc).hypotheses.find((h) => h.id === 'H1');
  assert.equal(h1.result, 'x');
});

test('CP-45-EC4 real content shaped like a hint is not a placeholder', () => {
  // `<SaveButton />` is an answer, not a template hint. CP-11 got this wrong in
  // both directions before the hints were read from the template itself.
  const doc = COMPLETE.replace(
    '**Vùng ảnh hưởng:** src/modules/outlook/calendar-sync.service.ts',
    '**Vùng ảnh hưởng:** <SaveButton />',
  );
  const report = validateForClose(parseInvestigation(doc));
  assert.equal(report.ok, true, 'nội dung thật không được đọc thành chữ mẫu');
});

test('CP-45-S1 forty spaces before a non-matching line cost almost nothing', () => {
  // The shape that costs minutes today: deep indent, then a line the pattern
  // ultimately rejects, so the engine explores every way to split the spaces.
  const doc = fileWith(`**Cách kiểm:** c\n${' '.repeat(40)}Kết quả không có dấu sao\n**Kết quả:** x`);
  const started = Date.now();
  parseInvestigation(doc);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 50, `mất ${elapsed}ms, ngưỡng 50ms`);
});

test('CP-45-P1 a file whose hypothesis lines carry 16-space indents parses fast', () => {
  const pad = ' '.repeat(16);
  const doc = fileWith(`${pad}- **Cách kiểm:** c\n${pad}- **Kết quả:** x`);
  const started = Date.now();
  const parsed = parseInvestigation(doc);
  const elapsed = Date.now() - started;

  assert.equal(parsed.hypotheses.find((h) => h.id === 'H1').result, 'x');
  assert.ok(elapsed < 500, `mất ${elapsed}ms, ngưỡng 500ms`);
});

// ---- CP-53: dòng `## ` trong khối code không phải ranh giới mục ----

const F3 = String.fromCharCode(96).repeat(3);

// Thay thân một mục của COMPLETE. COMPLETE không có dòng `## ` nào trong khối
// code, nên tìm theo chuỗi ở đây không vấp đúng cái bug đang đo.
function cp53WithSection(doc, heading, body) {
  const start = doc.indexOf(`\n## ${heading}\n`);
  const next = doc.indexOf('\n## ', start + 1);
  return doc.slice(0, start) + `\n## ${heading}\n\n${body}\n` + (next === -1 ? '' : doc.slice(next));
}

function cp53Pitfall(open, close = open) {
  return [
    'Đừng tin heading.',
    '',
    open,
    '## Đây là ví dụ, không phải mục',
    close,
    '',
    'Bài học: dòng ## trong code block không phải ranh giới.',
  ].join('\n');
}

test('CP-53-H1 a backtick fence holding a ## line stays inside the Pitfall', () => {
  const pitfall = cp53Pitfall(F3 + 'md', F3);
  const parsed = parseInvestigation(cp53WithSection(COMPLETE, 'Pitfall', pitfall));

  assert.equal(parsed.pitfall, pitfall, 'cả khối, kể cả dấu fence và đoạn bài học phía sau');
  const report = validateForClose(parsed);
  assert.equal(report.ok, true, report.errors.join('\n'));
});

test('CP-53-H2 a tilde fence holding a ## line stays inside the Pitfall', () => {
  const parsed = parseInvestigation(cp53WithSection(COMPLETE, 'Pitfall', cp53Pitfall('~~~')));

  assert.ok(parsed.pitfall.endsWith('không phải ranh giới.'), parsed.pitfall);
  assert.equal(parsed.pitfall.split('\n').filter((l) => l === '~~~').length, 2);
});

test('CP-53-H4 a fenced ## line between method and result does not end the hypothesis', () => {
  const doc = cp53WithSection(COMPLETE, 'Giả thuyết', [
    '### H1: deltaToken hết hạn',
    '**Cách kiểm:** đếm dòng log sau 410',
    F3,
    '## log line',
    F3,
    '**Kết quả:** đúng — 3 dòng',
  ].join('\n'));
  const parsed = parseInvestigation(doc);

  assert.equal(parsed.hypotheses[0].result, 'đúng — 3 dòng');
  assert.ok(
    !validateForClose(parsed).errors.includes('Giả thuyết H1 chưa có kết quả kiểm tra'),
    'ô kết quả đã điền',
  );
});

test('CP-53-V1 a fenced sample holding ## Pitfall is evidence, not the Pitfall section', () => {
  const sample = [F3, '## Pitfall', 'chữ mẫu trong ví dụ', F3].join('\n');
  // Pitfall trước: thay Bằng chứng trước thì chính helper tìm theo chuỗi vấp
  // vào `## Pitfall` của mẫu.
  let doc = cp53WithSection(COMPLETE, 'Pitfall', '**Phòng tránh:** Z.');
  doc = cp53WithSection(doc, 'Bằng chứng', `Mẫu đã dán:\n\n${sample}`);
  const parsed = parseInvestigation(doc);

  assert.ok(parsed.evidence.includes(sample), parsed.evidence);
  assert.equal(parsed.pitfall, '**Phòng tránh:** Z.');
});

test('CP-53-V2 only a matching closer ends a fence, and four spaces is not a fence', () => {
  // Mỗi ca có đúng một dòng `## X` ngay sau một dấu nằm giữa khối. Dấu đó mà
  // bị đọc thành dấu đóng thì `## X` thành ranh giới và mục Pitfall bị cắt.
  const trong = {
    'a: ``` mở, ~~~ ở giữa': [F3, '~~~', '## X', F3],
    'b: bốn backtick mở, ba ở giữa': [F3 + '`', F3, '## X', F3 + '`'],
    'c: ``` mở, ```js ở giữa': [F3, F3 + 'js', '## X', F3],
  };
  for (const [ca, khoi] of Object.entries(trong)) {
    const body = ['Trước.', ...khoi, 'Sau.'].join('\n');
    const parsed = parseInvestigation(cp53WithSection(COMPLETE, 'Pitfall', body));
    assert.equal(parsed.pitfall, body, `${ca}: dòng ## X vẫn nằm trong khối`);
  }

  // Dòng KHÔNG phải dấu mở thì `## X` là mục mới. Khối ```js…``` phía sau để
  // cả hai cách đọc cùng kết thúc với mọi khối đã đóng: đọc nhầm dòng kia thành
  // dấu mở thì ```js là chữ trong khối và ``` đóng nó. Thiếu khối đó thì cách
  // đọc nhầm để lại một khối mở, parser quay về cách đọc không fence, và ra
  // đúng kết quả của cách đọc đúng — test xanh dù luật sai.
  const khongPhaiDauMo = {
    'd: dấu thụt bốn dấu cách': '    ' + F3,
    'e: info string có backtick': F3 + 'a`b',
  };
  for (const [ca, dong] of Object.entries(khongPhaiDauMo)) {
    const body = ['Trước.', dong, '## X', F3 + 'js', 'y', F3, 'Sau.'].join('\n');
    const parsed = parseInvestigation(cp53WithSection(COMPLETE, 'Pitfall', body));
    assert.equal(parsed.pitfall, 'Trước.\n' + dong, `${ca}: không phải fence, ## X là mục mới`);
    assert.equal(parsed.unclosedFence, null, `${ca}: không có khối nào còn mở`);
  }
});

test('CP-53-EC5 a fenced ### line does not create a hypothesis', () => {
  const doc = cp53WithSection(COMPLETE, 'Giả thuyết', [
    '### H1: deltaToken hết hạn',
    '**Cách kiểm:** gọi Graph bằng token đang lưu',
    '**Kết quả:** đúng — trả 410',
    '',
    F3,
    '### H9: giả',
    '**Cách kiểm:** không có',
    '**Kết quả:** chữ trong ví dụ',
    F3,
  ].join('\n'));
  const parsed = parseInvestigation(doc);

  assert.equal(parsed.hypotheses.length, 1, JSON.stringify(parsed.hypotheses));
  assert.equal(parsed.hypotheses[0].id, 'H1');
  assert.equal(parsed.hypotheses[0].result, 'đúng — trả 410', 'dòng trong khối không ghi đè kết quả thật');
});
