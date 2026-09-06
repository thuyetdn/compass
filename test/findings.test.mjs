import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFindings, formatFinding, SEVERITIES, BLOCKING } from '../lib/findings.mjs';

const ONE = JSON.stringify({
  findings: [
    { severity: 'Major', title: 'Không bắt lỗi 410', detail: 'Cron chết âm thầm', file: 'a.js', line: 12 },
  ],
});

test('CP-6-H3 an empty findings list parses clean', () => {
  const result = parseFindings(JSON.stringify({ findings: [] }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.blocking, []);
});

test('CP-6-V5 a bare array is refused, since it cannot carry the brief id', () => {
  const result = parseFindings(JSON.stringify([
    { severity: 'Info', title: 'x', detail: 'y' },
  ]));
  assert.equal(result.findings, null);
  assert.match(result.errors[0], /brief/);
});

test('CP-6-H5 a Major finding is counted as blocking', () => {
  const result = parseFindings(ONE);
  assert.equal(result.blocking.length, 1);
  assert.equal(result.findings[0].file, 'a.js');
  assert.equal(result.findings[0].line, 12);
});

test('CP-6-EC1 a Critical finding is blocking', () => {
  const result = parseFindings(JSON.stringify({
    findings: [{ severity: 'Critical', title: 'x', detail: 'y' }],
  }));
  assert.equal(result.blocking.length, 1);
});

test('CP-6-H4 Minor and Info findings do not block', () => {
  const result = parseFindings(JSON.stringify({
    findings: [
      { severity: 'Minor', title: 'x', detail: 'y' },
      { severity: 'Info', title: 'z', detail: 'w' },
    ],
  }));
  assert.equal(result.findings.length, 2);
  assert.equal(result.blocking.length, 0);
});

test('CP-6-V1 invalid JSON is reported, not thrown', () => {
  const result = parseFindings('{ broken');
  assert.equal(result.findings, null);
  assert.match(result.errors[0], /JSON/);
});

test('CP-6-V2 a finding missing severity names which one it was', () => {
  const result = parseFindings(JSON.stringify({
    findings: [{ title: 'x', detail: 'y' }],
  }));
  assert.equal(result.findings, null);
  assert.match(result.errors[0], /thứ 1/);
  assert.match(result.errors[0], /severity/);
});

test('CP-6-V3 an unknown severity lists the valid ones', () => {
  const result = parseFindings(JSON.stringify({
    findings: [{ severity: 'Catastrophic', title: 'x', detail: 'y' }],
  }));
  assert.equal(result.findings, null);
  assert.match(result.errors[0], /Critical/);
});

test('something that is not a list at all is reported', () => {
  const result = parseFindings(JSON.stringify({ findings: 'nhiều lắm' }));
  assert.equal(result.findings, null);
  assert.match(result.errors[0], /mảng/);
});

test('a finding with no file still formats readably', () => {
  const text = formatFinding({ severity: 'Info', title: 'x', detail: 'y', file: null, line: null });
  assert.match(text, /không nêu vị trí/);
});

test('the blocking severities are exactly Critical and Major', () => {
  assert.deepEqual(BLOCKING, ['Critical', 'Major']);
  assert.deepEqual(SEVERITIES, ['Critical', 'Major', 'Minor', 'Info']);
});

test('CP-6-V8 a finding missing its title is refused, naming the field', () => {
  // Không có `title` thì báo cáo in `[Major] undefined` — người đọc không biết
  // finding nói về cái gì, và gate vẫn chặn nên họ không sửa được.
  const r = parseFindings(JSON.stringify({
    brief: 'abc123',
    findings: [{ severity: 'Major', detail: 'có gì đó sai' }],
  }));
  assert.ok(r.errors.length > 0, 'phải có lỗi');
  assert.ok(r.errors.some((e) => /title/.test(e)), `phải nêu tên trường, thấy: ${r.errors.join(' | ')}`);
});

test('CP-6-V9 a field holding only whitespace counts as missing', () => {
  const r = parseFindings(JSON.stringify({
    brief: 'abc123',
    findings: [{ severity: 'Major', title: '   ', detail: 'x' }],
  }));
  assert.ok(r.errors.length > 0, 'khoảng trắng không phải nội dung');
});

test('CP-6-V10 a finding that is not an object is refused', () => {
  for (const rac of ['chuỗi trần', 42, null, ['mảng']]) {
    const r = parseFindings(JSON.stringify({ brief: 'abc123', findings: [rac] }));
    assert.ok(r.errors.length > 0, `${JSON.stringify(rac)} không phải finding`);
  }
});

test('CP-6-V11 a non-string file field is dropped, not carried through', () => {
  // `file` là tuỳ chọn, nhưng nhận bừa kiểu thì báo cáo in ra một đường dẫn
  // không tồn tại — người đọc đi tìm file không có.
  const r = parseFindings(JSON.stringify({
    brief: 'abc123',
    findings: [{ severity: 'Info', title: 'x', detail: 'y', file: { a: 1 } }],
  }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.findings[0].file, null, 'kiểu sai thì bỏ, không mang theo');
});
