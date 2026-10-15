// CP-64 — lời nhắc "đưa spec cho người duyệt" chỉ thuộc về `compass spec`.
//
// `check` chạy gate spec bằng chính `specCommand`, nên trước task này lời nhắc
// rơi vào giữa mọi lần `check` — lúc spec đã duyệt từ lâu và code đã viết xong.
// `spec` vẫn in y như cũ; `check` xin bỏ lời nhắc qua một tuỳ chọn, chứ không
// lọc câu tiếng Việt khỏi output sau khi nhận về.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRepo } from './helpers/git-repo.mjs';
import { specCommand } from '../commands/spec.mjs';
import { readGate } from '../lib/gate-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CLI = path.join(ROOT, 'cli.mjs');

const PASS_LINE = '✓ Gate spec PASSED';
const REVIEW_HINT = '→ Đưa spec cho người duyệt. Duyệt xong mới bắt đầu code.';

const SPEC = `# X-1: Tiêu đề
Loại: fix
Phạm vi: src/

## Mục tiêu
Làm gì đó.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có vùng nào bị ảnh hưởng.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

// Spec chỉ còn một case — dưới mức tối thiểu của `fix`.
const SHORT_SPEC = SPEC.replace('| H2 | Happy | Case hai | Đúng | P0 |\n', '');

const GREEN = 'node -e "console.log(\'ok 1 - X-1-H1 a\'); console.log(\'ok 2 - X-1-H2 b\')"';

function makeTask(specText = SPEC) {
  const root = initRepo(mkdtempSync(path.join(tmpdir(), 'compass-spechint-')));
  mkdirSync(path.join(root, '.compass', 'X-1'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(root, '.compass', 'X-1', 'spec.md'), specText);
  return root;
}

function compass(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { exitCode: r.status, output: (r.stdout ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '') };
}

test('CP-64-H1 compass spec still ends a pass with the review hint', () => {
  const root = makeTask();
  const r = compass(root, 'spec', 'X-1');
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(r.output, [PASS_LINE, '', REVIEW_HINT].join('\n'));
});

test('CP-64-H2 compass check runs the spec gate without the review hint', () => {
  const root = makeTask();
  const r = compass(root, 'check', 'X-1');
  assert.equal(r.exitCode, 0, r.output);
  assert.ok(!r.output.includes('Duyệt xong mới bắt đầu code'), r.output);
  const lines = r.output.split('\n');
  const at = lines.indexOf(PASS_LINE);
  assert.notEqual(at, -1, r.output);
  assert.ok(lines[at + 1].startsWith('✓ Gate knowledge PASSED'), `dòng sau gate spec: ${JSON.stringify(lines[at + 1])}`);
});

test('CP-64-H3 compass check --only=spec prints only the pass line', () => {
  const root = makeTask();
  const r = compass(root, 'check', 'X-1', '--only=spec');
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(r.output, PASS_LINE);
});

test('CP-64-H4 compass done after check never prints the hint', () => {
  const root = makeTask();
  const check = compass(root, 'check', 'X-1');
  assert.equal(check.exitCode, 0, check.output);
  const r = compass(root, 'done', 'X-1');
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /4 gate đã pass/);
  assert.ok(!r.output.includes('Duyệt xong'), r.output);
});

test('CP-64-H5 the re-recorded demo shows the hint on spec only', () => {
  const t = JSON.parse(readFileSync(path.join(ROOT, 'docs', 'demo', 'transcript.json'), 'utf8'));
  const runs = t.steps.filter((s) => s.kind === 'run');
  const checks = runs.filter((s) => /^compass check /.test(s.command));
  assert.ok(checks.length > 0, 'transcript không có bước compass check nào');
  for (const s of checks) {
    assert.ok(!s.stdout.includes('Duyệt xong mới bắt đầu code'), `bước "${s.command}" (exit ${s.exitCode}) vẫn có lời nhắc duyệt`);
  }
  const spec = runs.find((s) => s.command === 'compass spec TD-002');
  assert.ok(spec, 'transcript không có bước compass spec TD-002');
  assert.ok(spec.stdout.includes('Duyệt xong mới bắt đầu code'), spec.stdout);
  assert.notEqual(t.compassCommit, 'c50b51b', 'transcript chưa được ghi lại');
});

test('CP-64-H6 spec and check write the same spec record', () => {
  const root = makeTask();
  assert.equal(compass(root, 'spec', 'X-1').exitCode, 0);
  const fromSpec = readGate(root, 'X-1', 'spec');
  const check = compass(root, 'check', 'X-1');
  assert.equal(check.exitCode, 0, check.output);
  const fromCheck = readGate(root, 'X-1', 'spec');

  assert.deepEqual(Object.keys(fromCheck).sort(), Object.keys(fromSpec).sort());
  for (const rec of [fromSpec, fromCheck]) {
    assert.equal(rec.exitCode, 0);
    assert.equal(rec.errorCount, 0);
  }
  assert.equal(fromCheck.specHash, fromSpec.specHash);
});

test('CP-64-E1 a failing spec inside check keeps the fix-the-spec advice', () => {
  const root = makeTask(SHORT_SPEC);
  const r = compass(root, 'check', 'X-1');
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /✗ Gate spec FAILED/);
  assert.ok(r.output.includes('Sửa spec rồi chạy lại: compass spec X-1'), r.output);
});

test('CP-64-EC1 specCommand with no option keeps the review hint', () => {
  const root = makeTask();
  const result = specCommand({ cwd: root, taskId: 'X-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(result.output.endsWith(REVIEW_HINT), result.output);
});
