import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFindings, formatFinding, SEVERITIES, BLOCKING } from '../lib/findings.mjs';

const ONE = JSON.stringify({
  findings: [
    { severity: 'Major', title: 'Không bắt lỗi 410', detail: 'Cron chết âm thầm', file: 'a.js', line: 12 },
  ],
});

test('H3 an empty findings list parses clean', () => {
  const result = parseFindings(JSON.stringify({ findings: [] }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.blocking, []);
});

test('V5 a bare array is refused, since it cannot carry the brief id', () => {
  const result = parseFindings(JSON.stringify([
    { severity: 'Info', title: 'x', detail: 'y' },
  ]));
  assert.equal(result.findings, null);
  assert.match(result.errors[0], /brief/);
});

test('H5 a Major finding is counted as blocking', () => {
  const result = parseFindings(ONE);
  assert.equal(result.blocking.length, 1);
  assert.equal(result.findings[0].file, 'a.js');
  assert.equal(result.findings[0].line, 12);
});

test('EC1 a Critical finding is blocking', () => {
  const result = parseFindings(JSON.stringify({
    findings: [{ severity: 'Critical', title: 'x', detail: 'y' }],
  }));
  assert.equal(result.blocking.length, 1);
});

test('H4 Minor and Info findings do not block', () => {
  const result = parseFindings(JSON.stringify({
    findings: [
      { severity: 'Minor', title: 'x', detail: 'y' },
      { severity: 'Info', title: 'z', detail: 'w' },
    ],
  }));
  assert.equal(result.findings.length, 2);
  assert.equal(result.blocking.length, 0);
});

test('V1 invalid JSON is reported, not thrown', () => {
  const result = parseFindings('{ broken');
  assert.equal(result.findings, null);
  assert.match(result.errors[0], /JSON/);
});

test('V2 a finding missing severity names which one it was', () => {
  const result = parseFindings(JSON.stringify({
    findings: [{ title: 'x', detail: 'y' }],
  }));
  assert.equal(result.findings, null);
  assert.match(result.errors[0], /thứ 1/);
  assert.match(result.errors[0], /severity/);
});

test('V3 an unknown severity lists the valid ones', () => {
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
