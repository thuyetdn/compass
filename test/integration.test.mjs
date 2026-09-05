import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

function compass(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

// Mỗi test dựng một thư mục tạm riêng. Ghi lại để dọn sau khi cả file chạy xong —
// dọn ngay trong test sẽ xóa mất thư mục khi assertion còn đang đọc file trong đó.
const workspaces = [];

function makeWorkspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));
  workspaces.push(dir);
  return dir;
}

function cleanupWorkspaces() {
  while (workspaces.length) {
    rmSync(workspaces.pop(), { recursive: true, force: true });
  }
}

after(cleanupWorkspaces);

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
  const cwd = makeWorkspace();

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
  const cwd = makeWorkspace();
  compass(cwd, ['init', 'T-1', '--type=fix']);
  writeFileSync(path.join(cwd, '.compass', 'T-1', 'spec.md'), FILLED_SPEC);

  const done = compass(cwd, ['done', 'T-1']);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /chưa chạy/);
});

test('spec gate rejects the untouched template', () => {
  const cwd = makeWorkspace();
  compass(cwd, ['init', 'T-1', '--type=fix']);

  const spec = compass(cwd, ['spec', 'T-1']);
  assert.equal(spec.status, 1);
});

test('an unknown command exits with a usage error', () => {
  const cwd = makeWorkspace();
  const result = compass(cwd, ['nonsense']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /compass init/);
});

test('done refuses after a gate record is hand-edited', () => {
  const cwd = makeWorkspace();
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

test('test_H1_the workspace helper removes its directory afterwards', () => {
  const created = makeWorkspace();
  assert.ok(existsSync(created), 'thư mục phải tồn tại khi vừa tạo');
  cleanupWorkspaces();
  assert.ok(!existsSync(created), 'thư mục phải bị xóa sau khi dọn');
});

test('test_H2_every workspace created in one run is removed together', () => {
  const dirs = [makeWorkspace(), makeWorkspace(), makeWorkspace()];
  for (const d of dirs) assert.ok(existsSync(d));
  cleanupWorkspaces();
  for (const d of dirs) assert.ok(!existsSync(d), `còn sót: ${d}`);
});

// C1 — a signed record copied onto a different gate's key must not be accepted.
test('C1: a signed spec record copied onto the test key is rejected, not accepted', () => {
  const cwd = makeWorkspace();
  compass(cwd, ['init', 'T5', '--type=fix']);
  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T5', 'spec.md'), FILLED_SPEC.replace('T-1', 'T5'));

  const spec = compass(cwd, ['spec', 'T5']);
  assert.equal(spec.status, 0, spec.stdout + spec.stderr);

  const gateFile = path.join(cwd, '.compass', 'T5', 'evidence', 'gate.json');
  const gates = JSON.parse(readFileSync(gateFile, 'utf8'));
  gates.test = gates.spec; // copy the genuinely-signed "spec" record onto the "test" key
  writeFileSync(gateFile, JSON.stringify(gates, null, 2));

  const done = compass(cwd, ['done', 'T5']);
  assert.notEqual(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /không thuộc slot này|gian lận/);
});

// C2 — a whole gate.json copied from one task to another must not validate.
test('C2: a gate.json copied from another task is rejected as belonging to a different task', () => {
  const cwd = makeWorkspace();
  compass(cwd, ['init', 'T3', '--type=fix']);
  compass(cwd, ['init', 'T6', '--type=fix']);
  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T3', 'spec.md'), FILLED_SPEC.replace('T-1', 'T3'));
  writeFileSync(path.join(cwd, '.compass', 'T6', 'spec.md'), FILLED_SPEC.replace('T-1', 'T6'));

  const check = compass(cwd, ['check', 'T3']);
  assert.equal(check.status, 0, check.stdout + check.stderr);

  const src = path.join(cwd, '.compass', 'T3', 'evidence', 'gate.json');
  const dst = path.join(cwd, '.compass', 'T6', 'evidence', 'gate.json');
  mkdirSync(path.dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(src, 'utf8'));

  const done = compass(cwd, ['done', 'T6']);
  assert.notEqual(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /thuộc task khác|bị copy sang task/);
});

// C3 — a gate record's evidence must not outlive a change to the test command it ran under.
test('C3: done rejects test-gate evidence after the test command in config.json changed', () => {
  const cwd = makeWorkspace();
  compass(cwd, ['init', 'T7', '--type=fix']);
  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T7', 'spec.md'), FILLED_SPEC.replace('T-1', 'T7'));

  const check = compass(cwd, ['check', 'T7']);
  assert.equal(check.status, 0, check.stdout + check.stderr);

  // Config changes after the gate ran — evidence no longer describes what would run now.
  const differentCmd = 'node -e "console.log(\'ok 1 - test_H1_x\'); console.log(\'ok 2 - test_H2_y\')"';
  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: differentCmd }));

  const done = compass(cwd, ['done', 'T7']);
  assert.notEqual(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /Lệnh test đã đổi/);
});

// C4 — check --only=<unknown or unimplemented> must never exit 0 having run nothing.
test('C4: check --only with an unknown gate name exits non-zero, not 0', () => {
  const cwd = makeWorkspace();
  compass(cwd, ['init', 'T-1', '--type=fix']);
  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T-1', 'spec.md'), FILLED_SPEC);

  const result = compass(cwd, ['check', 'T-1', '--only=bogus']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /không áp dụng/);
  assert.match(result.stdout, /spec/);
  assert.match(result.stdout, /test/);
});

test('C4: check --only with a gate applicable but not yet implemented exits non-zero, not 0', () => {
  const cwd = makeWorkspace();
  compass(cwd, ['init', 'T-UI', '--type=feature-s']);
  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T-UI', 'spec.md'),
    FILLED_SPEC.replace('T-1', 'T-UI').replace('Loại: fix', 'Loại: feature-s'));

  const result = compass(cwd, ['check', 'T-UI', '--only=ui']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /chưa được xây dựng/);
});

// I2 — one pass line naming several spec IDs must not satisfy all of them.
test('I2: one shared pass line covering two spec IDs blocks done for both', () => {
  const cwd = makeWorkspace();
  compass(cwd, ['init', 'T-1', '--type=fix']);
  const sharedLine = 'node -e "console.log(\'ok 1 - test covers H1 and H2 together\')"';
  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: sharedLine }));
  writeFileSync(path.join(cwd, '.compass', 'T-1', 'spec.md'), FILLED_SPEC);

  const check = compass(cwd, ['check', 'T-1']);
  assert.notEqual(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /không tách được ai chạy ai|mỗi ca cần một test riêng/);
  assert.match(check.stdout, /H1/);
  assert.match(check.stdout, /H2/);

  const done = compass(cwd, ['done', 'T-1']);
  assert.notEqual(done.status, 0);
});

// A legitimate full run must still pass end to end after all the above fixes.
test('a full happy path still runs green from init to done after the C1-C4/I2 fixes', () => {
  const cwd = makeWorkspace();
  const init = compass(cwd, ['init', 'T-OK', '--type=fix']);
  assert.equal(init.status, 0, init.stdout + init.stderr);

  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T-OK', 'spec.md'), FILLED_SPEC.replace('T-1', 'T-OK'));

  const check = compass(cwd, ['check', 'T-OK']);
  assert.equal(check.status, 0, check.stdout + check.stderr);

  const done = compass(cwd, ['done', 'T-OK']);
  assert.equal(done.status, 0, done.stdout + done.stderr);

  const status = compass(cwd, ['status', 'T-OK']);
  assert.equal(status.status, 0, status.stdout + status.stderr);
  assert.doesNotMatch(status.stdout, /⚠/);
});
