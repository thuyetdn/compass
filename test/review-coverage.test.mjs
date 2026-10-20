import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewCommand } from '../commands/review.mjs';
import { readGate } from '../lib/gate-store.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { coverageFor, writeReview, briefIdIn } from './helpers/review.mjs';

// CP-78 — `findings: []` từng qua gate dù người soi có nhìn tới bảo mật hay
// không. Giờ mỗi tiêu chí phải có kết luận, và kết luận phải khớp với finding.

const SPEC = `# T-1: Lọc theo quốc gia
Loại: feature-m
Phạm vi: src/

## Mục tiêu
Lọc danh sách theo quốc gia.

## Ràng buộc
Không đổi API.

## Rủi ro hồi quy
Trang danh sách dùng chung hàm lọc.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
`;

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo({ conventions = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cov-'));
  const put = (rel, body) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  };
  put('.compass/config.json', JSON.stringify({ test: 'true' }));
  put('.compass/T-1/spec.md', SPEC);
  put('src/filter.js', 'export const filter = (list) => list;\n');
  if (conventions !== null) put('.knowledge/decided/conventions.md', conventions);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  // Khai gốc soi là commit vừa tạo. Không khai thì repo một commit được soi từ
  // cây rỗng (CP-52), và mọi file — kể cả README, .env — thành file đã đổi.
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  put('.compass/T-1/spec.md', SPEC.replace('Phạm vi: src/', `Phạm vi: src/
Gốc soi: ${baseSha}`));
  put('src/filter.js', 'export const filter = (list, c) => list.filter((x) => x.country === c);\n');
  return root;
}

const run = (root) => reviewCommand({ cwd: root, taskId: 'T-1' });

function briefed(options) {
  const root = makeRepo(options);
  assert.equal(run(root).exitCode, 1, 'pha một phải sinh brief');
  return root;
}

const minor = (criterion, extra = {}) => ({
  severity: 'Minor', criterion, title: 'Tên biến khó hiểu', detail: 'x không nói gì', file: 'src/filter.js', line: 1, ...extra,
});

test('CP-78-H6 full coverage with no blocking finding passes and records per-verdict counts', () => {
  const root = briefed();
  writeReview(root, 'T-1', {
    coverage: coverageFor({ convention: { verdict: 'findings' }, performance: { verdict: 'insufficient', note: 'spec không nói cỡ dữ liệu' } }),
    findings: [minor('convention', { basis: 'inferred' })],
  });
  const result = run(root);
  assert.equal(result.exitCode, 0, result.output);
  const record = readGate(root, 'T-1', 'review');
  assert.deepEqual(record.coverage, { clean: 8, findings: 1, insufficient: 1 });
});

test('CP-78-H7 feature-s requires the review gate', () => {
  assert.ok(rulesFor('feature-s').gates.includes('review'));
  assert.ok(!rulesFor('bug').gates.includes('review'));
  assert.ok(!rulesFor('fix').gates.includes('review'));
});

test('CP-78-V1 coverage missing a criterion fails naming it', () => {
  const root = briefed();
  writeReview(root, 'T-1', { coverage: coverageFor({ security: null }) });
  const result = run(root);
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /security/);
  assert.equal(readGate(root, 'T-1', 'review').exitCode, 1, 'sổ phải ghi đỏ');

  // Lần soi thứ hai: không test nào chứng minh định dạng cũ — không có trường
  // coverage — bị từ chối. Đây là đường một người soi lười đi qua dễ nhất.
  const brief = briefIdIn(root, 'T-1');
  writeFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'findings.json'), JSON.stringify({ brief, findings: [] }));
  const oldShape = run(root);
  assert.equal(oldShape.exitCode, 2, oldShape.output);
  assert.match(oldShape.output, /coverage/);
});

test('CP-78-V2 an unknown key or verdict fails naming the value', () => {
  const root = briefed();
  writeReview(root, 'T-1', { coverage: { ...coverageFor(), style: { verdict: 'clean' } } });
  const unknownKey = run(root);
  assert.equal(unknownKey.exitCode, 2);
  assert.match(unknownKey.output, /style/);

  writeReview(root, 'T-1', { coverage: coverageFor({ docs: { verdict: 'ok' } }) });
  const badVerdict = run(root);
  assert.equal(badVerdict.exitCode, 2);
  assert.match(badVerdict.output, /"ok"/);
});

test('CP-78-V3 a finding without a criterion, or with an unknown one, fails naming it', () => {
  const root = briefed();
  const noCriterion = minor('spec');
  delete noCriterion.criterion;
  writeReview(root, 'T-1', { coverage: coverageFor({ spec: { verdict: 'findings' } }), findings: [noCriterion] });
  const missing = run(root);
  assert.equal(missing.exitCode, 2);
  assert.match(missing.output, /finding thứ 1/);

  writeReview(root, 'T-1', { findings: [minor('naming')] });
  const unknown = run(root);
  assert.equal(unknown.exitCode, 2);
  assert.match(unknown.output, /naming/);
});

test('CP-78-V4 a verdict that disagrees with the findings fails naming the criterion', () => {
  const root = briefed();
  writeReview(root, 'T-1', { coverage: coverageFor({ reuse: { verdict: 'findings' } }) });
  const noFinding = run(root);
  assert.equal(noFinding.exitCode, 2);
  assert.match(noFinding.output, /reuse/);

  writeReview(root, 'T-1', { findings: [minor('errors')] });
  const cleanWithFinding = run(root);
  assert.equal(cleanWithFinding.exitCode, 2);
  assert.match(cleanWithFinding.output, /errors/);
});

test('CP-78-V5 insufficient needs a note, and spec or tests can never be insufficient', () => {
  const root = briefed();
  writeReview(root, 'T-1', { coverage: coverageFor({ docs: { verdict: 'insufficient' } }) });
  const noNote = run(root);
  assert.equal(noNote.exitCode, 2);
  assert.match(noNote.output, /docs/);

  for (const key of ['spec', 'tests']) {
    writeReview(root, 'T-1', { coverage: coverageFor({ [key]: { verdict: 'insufficient', note: 'không đọc kịp' } }) });
    const result = run(root);
    assert.equal(result.exitCode, 2, `${key} insufficient phải đỏ`);
    assert.match(result.output, new RegExp(key));
  }
});

test('CP-78-E3 a context-only change reopens the gate, says so, and the old findings stop answering', () => {
  // Ngữ cảnh chỉ đổi riêng khi diff bị chốt. Không khai `Soi đến:` thì diff đi
  // tới cây làm việc, nên sửa conventions.md cũng là đổi diff. Ở đây việc của
  // task nằm trong một commit, `Soi đến:` chốt ở commit đó, và conventions.md
  // đổi sau — ngoài khoảng soi.
  const root = makeRepo({ conventions: '# Quy ước\n\nMột luật.\n' });
  git(root, ['add', 'src/filter.js']);
  git(root, ['commit', '-q', '-m', 'task work']);
  const end = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  // Một commit sau việc của task: `Soi đến:` trùng HEAD thì gate soi như không
  // khai, đi tới cây làm việc (CP-36), và ngữ cảnh lại thành một phần của diff.
  writeFileSync(path.join(root, 'NOTES.txt'), 'việc khác\n');
  git(root, ['add', 'NOTES.txt']);
  git(root, ['commit', '-q', '-m', 'unrelated']);
  const specFile = path.join(root, '.compass', 'T-1', 'spec.md');
  const spec = readFileSync(specFile, 'utf8');
  writeFileSync(specFile, spec.replace(/(Gốc soi: \w+)/, `$1\nSoi đến: ${end}`));
  assert.equal(run(root).exitCode, 1, 'pha một phải sinh brief');

  const oldId = briefIdIn(root, 'T-1');
  writeReview(root, 'T-1');
  assert.equal(run(root).exitCode, 0, 'trước khi đổi ngữ cảnh gate phải xanh');

  writeFileSync(path.join(root, '.knowledge', 'decided', 'conventions.md'), '# Quy ước\n\nMột luật.\n\nThêm luật thứ hai.\n');
  const reopened = run(root);
  assert.equal(reopened.exitCode, 1);
  assert.match(reopened.output, /ngữ cảnh/i);
  assert.ok(!/Code hoặc spec đã đổi/.test(reopened.output), 'không được bảo là code đổi');
  assert.notEqual(briefIdIn(root, 'T-1'), oldId, 'brief mới phải mang id mới');

  const again = run(root);
  assert.equal(again.exitCode, 1, 'findings cũ không được trả lời brief mới');

  // Pha một cũng phải nói đúng: chưa ai nộp findings, rồi ngữ cảnh đổi. Lần soi
  // đầu của CP-78 bắt được pha một vẫn báo "code hoặc spec đã đổi" ở đây.
  rmSync(path.join(root, '.compass', 'T-1', 'evidence', 'findings.json'));
  assert.equal(run(root).exitCode, 1);
  writeFileSync(path.join(root, '.knowledge', 'decided', 'conventions.md'), '# Quy ước\n\nBa luật.\n');
  const phaseOne = run(root);
  assert.equal(phaseOne.exitCode, 1);
  assert.match(phaseOne.output, /ngữ cảnh/i);
  assert.ok(!/Code hoặc spec đã đổi/.test(phaseOne.output), 'pha một không được bảo là code đổi');
});

test('CP-78-EC3 insufficient verdicts do not block and are listed with their notes', () => {
  const root = briefed();
  writeReview(root, 'T-1', {
    coverage: coverageFor({
      performance: { verdict: 'insufficient', note: 'spec không nói cỡ dữ liệu' },
      impact: { verdict: 'insufficient', note: 'repo dùng PHP, máy không dò được nơi gọi' },
    }),
  });
  const result = run(root);
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /performance.*spec không nói cỡ dữ liệu/);
  assert.match(result.output, /impact.*máy không dò được nơi gọi/);
});
