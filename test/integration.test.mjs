import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

function compass(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

const FILLED_SPEC = `# T-1: Thêm bộ lọc
Loại: fix
Phạm vi: src/

## Mục tiêu
Lọc được theo quốc gia.

## Ràng buộc
Không đổi response shape.

## Rủi ro hồi quy
Trang Browse Members dùng chung endpoint.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Lọc một quốc gia | Trả đúng danh sách | P0 |
| H2 | Happy | Lọc nhiều quốc gia | Trả hợp các tập | P0 |
`;

const GREEN = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\')"';

test('a full happy path runs from init to done', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));

  const init = compass(cwd, ['init', 'T-1', '--type=fix']);
  assert.equal(init.status, 0, init.stdout + init.stderr);

  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T-1', 'spec.md'), FILLED_SPEC);

  const check = compass(cwd, ['check', 'T-1']);
  assert.equal(check.status, 0, check.stdout + check.stderr);

  const done = compass(cwd, ['done', 'T-1']);
  assert.equal(done.status, 0, done.stdout + done.stderr);
});

test('done refuses a task whose gates never ran', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));
  compass(cwd, ['init', 'T-1', '--type=fix']);
  writeFileSync(path.join(cwd, '.compass', 'T-1', 'spec.md'), FILLED_SPEC);

  const done = compass(cwd, ['done', 'T-1']);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /chưa chạy/);
});

test('spec gate rejects the untouched template', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));
  compass(cwd, ['init', 'T-1', '--type=fix']);

  const spec = compass(cwd, ['spec', 'T-1']);
  assert.equal(spec.status, 1);
});

test('an unknown command exits with a usage error', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));
  const result = compass(cwd, ['nonsense']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /compass init/);
});

test('done refuses after a gate record is hand-edited', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));
  compass(cwd, ['init', 'T-1', '--type=fix']);
  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T-1', 'spec.md'), FILLED_SPEC);
  compass(cwd, ['check', 'T-1']);

  const gateFile = path.join(cwd, '.compass', 'T-1', 'evidence', 'gate.json');
  const gates = JSON.parse(readFileSync(gateFile, 'utf8'));
  gates.test.durationMs = 1;
  writeFileSync(gateFile, JSON.stringify(gates, null, 2));

  const done = compass(cwd, ['done', 'T-1']);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /chữ ký/);
});
