import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preflightCommand } from '../commands/preflight.mjs';
import { checkCommand } from '../commands/check.mjs';
import { doneCommand } from '../commands/done.mjs';
import { reviewCommand } from '../commands/review.mjs';
import { statusCommand } from '../commands/status.mjs';
import { validateSpec } from '../lib/spec-validator.mjs';
import { buildBrief, buildVerifyBrief } from '../lib/review-brief.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { withinBudget } from './helpers/timing.mjs';

// CP-108 — issue #7, đợt 2: gate preflight (lệnh khai trong config, kiểm tra migration đã
// áp bị sửa), và sự thật môi trường trong spec và brief.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function initGit(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'core.autocrlf', 'false']);
}

const put = (root, rel, body) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};

function commit(dir, msg) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

const ENV_OK = `## Môi trường
| Sự thật | Nguồn | Ngày |
|---|---|---|
| Migration 001 đã chạy ở staging và production | bảng schema_migrations | 2026-11-10 |
| Cột country có ở staging | \\d users trên staging | 2026-11-11 |
`;

const LAYER = { H: 'Happy', V: 'Validation', E: 'Error', EC: 'Edge', S: 'Security', P: 'Performance' };

const SPEC = ({ type = 'fix', head = '', scope = 'src/', env = '', cases = ['H1', 'H2'] } = {}) => `# T-1: Bộ lọc
Loại: ${type}
Phạm vi: ${scope}
${head}
## Mục tiêu
Lọc danh sách theo quốc gia.

${env}
## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
${cases.map((id) => `| ${id} | ${LAYER[id.replace(/\d+$/, '')]} | a | b | P0 |`).join('\n')}
`;

// Script in đối số của nó dưới dạng JSON, một dòng có dấu để test tìm trong preflight.log.
const PRINT_ARGS = "console.log('ARGS=' + JSON.stringify(process.argv.slice(2)));\n";
const TEST_CMD = 'node -e "console.log(\'ok 1 - T-1-H1 a\'); console.log(\'ok 2 - T-1-H2 b\')"';

// Repo một git: commit gốc có file Compass, `print-args.cjs`, `src/a.js`, `src/d.js` và
// `db/migrations/001.sql`. Spec khai Gốc soi là commit đó.
function makeRepo({ config = {}, type = 'fix', head = '', env = '', cases } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp108-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: TEST_CMD, ...config }));
  put(root, 'print-args.cjs', PRINT_ARGS);
  put(root, 'src/a.js', 'export const a = 1;\n');
  put(root, 'src/d.js', 'export const d = 1;\n');
  put(root, 'db/migrations/001.sql', 'create table users (id int);\n');
  const base = commit(root, 'base');
  put(root, '.compass/T-1/spec.md', SPEC({ type, env, cases, head: `Gốc soi: ${base}\n${head}` }));
  return { root, base };
}

const pre = (root, taskId = 'T-1') => preflightCommand({ cwd: root, taskId });
const evidence = (root, ...rel) => path.join(root, '.compass', 'T-1', 'evidence', ...rel);
const gates = (root) => JSON.parse(readFileSync(evidence(root, 'gate.json'), 'utf8'));
const log = (root, ...repo) => readFileSync(evidence(root, ...(repo.length ? ['repos', ...repo] : []), 'preflight.log'), 'utf8');
const argsIn = (text) => JSON.parse(text.match(/^ARGS=(.*)$/m)[1]);
const MIG = { migrations: ['db/migrations/*.sql'] };

// ---------------------------------------------------------------- Happy

test('CP-108-H1 check runs preflight between convention and test and records it with three hashes', async () => {
  const { root } = makeRepo({ config: { preflight: ['node -e "process.exit(0)"'] } });
  put(root, 'src/a.js', 'export const a = 2;\n');
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
  const at = (g) => r.output.indexOf(`Gate ${g} PASSED`);
  assert.ok(at('convention') >= 0 && at('convention') < at('preflight') && at('preflight') < at('test'), r.output);
  const rec = gates(root).preflight;
  assert.equal(rec.exitCode, 0);
  for (const k of ['sourceHash', 'configHash', 'specHash']) assert.ok(rec[k], k);
});

test('CP-108-H2 {changed} becomes the added and modified files, one quoted argument each', () => {
  const { root } = makeRepo({ config: { preflight: ['node print-args.cjs {changed}'] } });
  put(root, 'src/a.js', 'export const a = 2;\n');
  put(root, 'src/b c.js', 'export const b = 1;\n');
  rmSync(path.join(root, 'src/d.js'));
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.deepEqual(argsIn(log(root)).sort(), ['src/a.js', 'src/b c.js']);
});

test('CP-108-H3 {base} becomes the full SHA of the review base', () => {
  const { root, base } = makeRepo({ config: { preflight: ['node print-args.cjs {base}'] } });
  put(root, 'src/a.js', 'export const a = 2;\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.deepEqual(argsIn(log(root)), [base]);
  assert.equal(base.length, 40);
});

test('CP-108-H4 adding a new migration is fine', () => {
  const { root } = makeRepo({ config: MIG });
  put(root, 'db/migrations/002.sql', 'alter table users add country text;\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-108-H5 an exception line in the spec header lets one edited migration through', () => {
  const { root } = makeRepo({ config: MIG, head: 'Ngoại lệ migration: db/migrations/001.sql — fixes a typo in a comment, not yet applied anywhere\n' });
  put(root, 'db/migrations/001.sql', 'create table users (id int); -- typo fixed\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /db\/migrations\/001\.sql/);
});

// Gốc một git, hai repo khai trong `repos` là thư mục con của nó.
function multiRepo({ be = {}, fe = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp108-mr-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: TEST_CMD, repos: { be: { ...be }, fe: { ...fe } } }));
  put(root, 'be/print-args.cjs', PRINT_ARGS);
  put(root, 'be/a.js', 'export const a = 1;\n');
  put(root, 'fe/f.js', 'export const f = 1;\n');
  const base = commit(root, 'base');
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/, fe/', head: `Gốc soi: ${base}\n` }));
  return root;
}

test('CP-108-H6 a multi-repo task gets one green preflight slot per repo, and done accepts them', () => {
  const root = multiRepo({ be: { preflight: ['node print-args.cjs {changed}'] } });
  put(root, 'be/a.js', 'export const a = 2;\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  const g = gates(root);
  assert.equal(g['preflight@be'].exitCode, 0);
  assert.equal(g['preflight@fe'].exitCode, 0);
  assert.equal(g.preflight, undefined);
  assert.deepEqual(argsIn(log(root, 'be')), ['a.js']);
  const d = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(d.output, /preflight/, d.output);
  // `status` liệt kê từng khe, không báo khe trần là chưa chạy.
  const s = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.match(s.output, /preflight@be\s+✓ pass/);
  assert.match(s.output, /preflight@fe\s+✓ pass/);
  assert.doesNotMatch(s.output, /preflight\s+· chưa chạy/);
});

const FM_CASES = ['H1', 'H2', 'H3', 'H4', 'V1', 'V2', 'V3', 'E1', 'E2', 'E3', 'EC1', 'EC2', 'EC3', 'S1', 'S2', 'S3', 'P1', 'P2', 'H5', 'H6', 'H7'];
const fm = (env) => SPEC({ type: 'feature-m', env, cases: FM_CASES });

test('CP-108-H7 a feature-m spec with a valid environment table passes the spec gate', () => {
  const r = validateSpec(fm(ENV_OK));
  assert.deepEqual(r.errors, []);
});

test('CP-108-H8 the brief puts the environment, then the migrations in the diff, right before the diff', () => {
  const { root } = makeRepo({ config: MIG, type: 'feature-m', env: ENV_OK, cases: FM_CASES });
  put(root, 'db/migrations/002.sql', 'alter table users add country text;\n');
  // Tên ngoài ASCII: git đặt nó trong nháy ở dòng đầu mục của diff.
  put(root, 'db/migrations/003-cú.sql', 'select 1;\n');
  assert.equal(pre(root).exitCode, 0);
  const r = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  const env = brief.indexOf('\n## Môi trường (đọc trước diff)\n');
  const diff = brief.lastIndexOf('\n## Diff\n');
  assert.ok(env > 0 && env < diff, 'mục môi trường nằm trước diff');
  const between = brief.slice(env, diff);
  assert.ok(between.includes('| Migration 001 đã chạy ở staging và production | bảng schema_migrations | 2026-11-10 |'), between);
  assert.match(between, /db\/migrations\/002\.sql \(thêm\)/);
  assert.match(between, /db\/migrations\/003-cú\.sql \(thêm\)/);
  assert.doesNotMatch(brief.slice(env + 10, diff), /\n## /, 'không có mục nào chen giữa môi trường và diff');
});

test('CP-108-H9 upstream lag is an info line and never fails the gate', () => {
  const { root } = makeRepo();
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  git(root, ['branch', 'up']);
  git(root, ['checkout', '-q', 'up']);
  // Chỉ commit x.txt: spec của task chưa theo dõi, `add -A` sẽ mang nó sang nhánh kia.
  for (const n of ['1', '2']) {
    put(root, 'x.txt', n);
    git(root, ['add', 'x.txt']);
    git(root, ['commit', '-q', '-m', `u${n}`]);
  }
  git(root, ['checkout', '-q', branch]);
  git(root, ['branch', `--set-upstream-to=up`]);
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /^ℹ .*chậm 2 commit/m);
});

test('CP-108-H10 compass preflight run alone writes the same record as check', () => {
  const { root } = makeRepo({ config: { preflight: ['node -e "process.exit(0)"'] } });
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  const rec = gates(root).preflight;
  assert.equal(rec.gate, 'preflight');
  assert.equal(rec.exitCode, 0);
  assert.ok(rec.sourceHash && rec.configHash && rec.specHash);
});

// ---------------------------------------------------------------- Validation

test('CP-108-V1 a preflight field that is not a list of non-empty commands is refused before anything runs', () => {
  for (const bad of ['npm run lint', [''], [42]]) {
    const { root } = makeRepo({ config: { preflight: bad } });
    const r = pre(root);
    assert.equal(r.exitCode, 2, `${JSON.stringify(bad)}: ${r.output}`);
    assert.match(r.output, /"preflight"/);
    assert.ok(!existsSync(evidence(root, 'preflight.log')));
  }
});

test('CP-108-V2 a migrations glob that is not a list, or leaves the repo, is refused', () => {
  for (const bad of ['db/*.sql', ['../outside/*.sql'], ['/abs/*.sql']]) {
    const { root } = makeRepo({ config: { migrations: bad } });
    const r = pre(root);
    assert.equal(r.exitCode, 2, `${JSON.stringify(bad)}: ${r.output}`);
    assert.match(r.output, /"migrations"/);
    if (Array.isArray(bad)) assert.ok(r.output.includes(bad[0]), r.output);
  }
});

test('CP-108-V3 an exception line without a reason or without a path fails the spec gate with its line', () => {
  for (const line of ['Ngoại lệ migration: db/migrations/001.sql', 'Ngoại lệ migration: — vì sao đó']) {
    const r = validateSpec(SPEC({ head: `${line}\n` }));
    assert.equal(r.ok, false, line);
    assert.ok(r.errors.some((e) => /Ngoại lệ migration/.test(e) && /dòng \d+/.test(e)), r.errors.join('\n'));
  }
});

test('CP-108-V4 a feature-m spec without the environment section fails and shows both forms', () => {
  const r = validateSpec(fm(''));
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => /Môi trường/.test(x));
  assert.ok(e, r.errors.join('\n'));
  assert.match(e, /feature-m/);
  assert.match(e, /\| Sự thật \| Nguồn \| Ngày \|/);
  assert.match(e, /Không áp dụng:/);
});

test('CP-108-V5 each bad row of the environment table is named', () => {
  const rows = [
    '| A | nguồn a | 2026-02-30 |',
    '| B | nguồn b | 13/11/2026 |',
    '| C |  | 2026-11-01 |',
    '|  | nguồn d | 2026-11-01 |',
  ];
  const env = `## Môi trường\n| Sự thật | Nguồn | Ngày |\n|---|---|---|\n${rows.join('\n')}\n`;
  const r = validateSpec(fm(env));
  const envErrors = r.errors.filter((e) => /Môi trường/.test(e));
  assert.equal(envErrors.length, 4, envErrors.join('\n'));
  for (const n of [1, 2, 3, 4]) assert.ok(envErrors.some((e) => e.includes(`hàng ${n}`)), `hàng ${n}`);
});

test('CP-108-V6 Không áp dụng needs a reason, and an empty section fails', () => {
  for (const env of ['## Môi trường\nKhông áp dụng:\n', '## Môi trường\n\n']) {
    const r = validateSpec(fm(env));
    assert.ok(r.errors.some((e) => /Môi trường/.test(e)), `${JSON.stringify(env)}: ${r.errors.join('\n')}`);
  }
  assert.deepEqual(validateSpec(fm('## Môi trường\nKhông áp dụng: thư viện, không deploy\n')).errors, []);
});

// ---------------------------------------------------------------- Error

test('CP-108-E1 a red command shows its exit code and last 40 lines; the log has all; later commands do not run', () => {
  const loud = 'node -e "for (let i = 1; i <= 100; i++) console.log(\'line \' + i); process.exit(3)"';
  const { root } = makeRepo({ config: { preflight: [loud, 'node print-args.cjs SECOND'] } });
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.ok(r.output.includes(loud), r.output);
  assert.match(r.output, /exit 3/);
  assert.match(r.output, /line 100/);
  assert.match(r.output, /line 61\b/);
  assert.doesNotMatch(r.output, /line 60\b/);
  const full = log(root);
  assert.match(full, /line 1\b/);
  assert.doesNotMatch(full, /SECOND/);
  assert.equal(gates(root).preflight.exitCode, 1);
});

test('CP-108-E2 editing a migration that exists at the base is red and prints the exception line', () => {
  const { root, base } = makeRepo({ config: MIG });
  put(root, 'db/migrations/001.sql', 'create table users (id bigint);\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.ok(r.output.includes(base.slice(0, 7)), r.output);
  assert.ok(r.output.includes('Ngoại lệ migration: db/migrations/001.sql — <lý do>'), r.output);
});

test('CP-108-E3 deleting or renaming an applied migration is red too', () => {
  const del = makeRepo({ config: MIG });
  rmSync(path.join(del.root, 'db/migrations/001.sql'));
  const a = pre(del.root);
  assert.equal(a.exitCode, 1, a.output);
  assert.match(a.output, /db\/migrations\/001\.sql/);

  const ren = makeRepo({ config: MIG });
  renameSync(path.join(ren.root, 'db/migrations/001.sql'), path.join(ren.root, 'db/migrations/001b.sql'));
  const b = pre(ren.root);
  assert.equal(b.exitCode, 1, b.output);
  assert.match(b.output, /db\/migrations\/001\.sql/);

  // Đổi tên đã commit: git thấy cả hai tên và mặc định gộp thành một dòng đổi tên.
  const moved = makeRepo({ config: MIG });
  git(moved.root, ['mv', 'db/migrations/001.sql', 'db/migrations/001b.sql']);
  git(moved.root, ['commit', '-q', '-m', 'rename']);
  const c = pre(moved.root);
  assert.equal(c.exitCode, 1, c.output);
  assert.match(c.output, /db\/migrations\/001\.sql \(xoá\)/);
});

test('CP-108-E4 review refuses to write a brief while declared preflight has no green record', () => {
  for (const arrange of [() => {}, (root) => { put(root, '.compass/config.json', JSON.stringify({ test: TEST_CMD, preflight: ['node -e "process.exit(1)"'] })); pre(root); }]) {
    const { root } = makeRepo({ config: { preflight: ['node -e "process.exit(0)"'] } });
    put(root, 'src/a.js', 'export const a = 2;\n');
    arrange(root);
    const r = reviewCommand({ cwd: root, taskId: 'T-1' });
    assert.equal(r.exitCode, 1, r.output);
    assert.match(r.output, /preflight/i);
    assert.match(r.output, /compass check T-1/);
    assert.ok(!existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')));
    assert.equal(gates(root).review.exitCode, 1);
  }
});

test('CP-108-E5 a preflight record older than the code blocks review', () => {
  const { root } = makeRepo({ config: { preflight: ['node -e "process.exit(0)"'] } });
  put(root, 'src/a.js', 'export const a = 2;\n');
  assert.equal(pre(root).exitCode, 0);
  put(root, 'src/a.js', 'export const a = 3;\n');
  const r = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /preflight/i);
  assert.ok(!existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')));
});

test('CP-108-E6 done is red when config changed after preflight ran', () => {
  const { root } = makeRepo({ config: { preflight: ['node -e "process.exit(0)"'] } });
  assert.equal(pre(root).exitCode, 0);
  put(root, '.compass/config.json', JSON.stringify({ test: TEST_CMD, preflight: ['node -e "process.exit(0)"', 'node -e "1"'] }));
  const d = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(d.exitCode, 1);
  assert.match(d.output, /config\.json đã đổi kể từ khi gate "preflight" chạy/);
});

// ---------------------------------------------------------------- Edge

test('CP-108-EC1 a {changed} command in a repo with no changed file is skipped with a note', () => {
  const root = multiRepo({ fe: { preflight: ['node -e "process.exit(9)" {changed}'] } });
  put(root, 'be/a.js', 'export const a = 2;\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /ℹ .*bỏ qua/);
});

test('CP-108-EC2 nothing declared: green, says so, and done accepts the record', () => {
  const { root } = makeRepo();
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /chưa khai preflight hay migrations/);
  const d = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(d.output, /preflight/, d.output);
});

test('CP-108-EC3 with no environment section and no migration in the diff the brief is byte-identical to the one at the base', async () => {
  const base = readFileSync(path.join(REPO, '.compass', 'CP-108', 'spec.md'), 'utf8').match(/^Gốc soi:\s*(\S+)/m)[1];
  const old = mkdtempSync(path.join(tmpdir(), 'compass-cp108-old-'));
  mkdirSync(path.join(old, 'lib'));
  for (const name of git(REPO, ['ls-tree', '--name-only', base, 'lib/']).split('\n')) {
    writeFileSync(path.join(old, name), execFileSync('git', ['show', `${base}:${name}`], { cwd: REPO }));
  }
  copyFileSync(path.join(REPO, 'package.json'), path.join(old, 'package.json'));
  const before = await import(pathToFileURL(path.join(old, 'lib', 'review-brief.mjs')).href);
  const args = {
    taskId: 'T-1', spec: '# T-1\nLoại: feature-s\n', diff: 'diff --git a/x b/x\n+y\n', files: ['x'],
    briefId: 'abc123def456', base: '1234567890', baseFrom: 'spec', context: 'ngữ cảnh', rubric: true,
  };
  assert.equal(buildBrief({ ...args, environment: '' }), before.buildBrief(args));
  const verify = { taskId: 'T-1', round: 2, spec: 's', diff: 'd', files: ['x'], briefId: 'abc', open: [] };
  assert.equal(buildVerifyBrief({ ...verify, environment: '' }), before.buildVerifyBrief(verify));

  const { root } = makeRepo({ type: 'feature-s' });
  put(root, 'src/a.js', 'export const a = 2;\n');
  reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8'), /Môi trường \(đọc trước diff\)/);
});

test('CP-108-EC4 a sub-repo with its own git is checked against its own base', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp108-sub-'));
  put(root, '.compass/config.json', JSON.stringify({ test: TEST_CMD, repos: { be: { migrations: ['db/migrations/*.sql'] } } }));
  initGit(root);
  put(root, '.gitignore', '/*\n!/.compass/\n!/.gitignore\n');
  commit(root, 'workspace');
  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'db/migrations/001.sql', 'create table t (id int);\n');
  const beBase = commit(be, 'base');
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/', head: `Gốc soi (be): ${beBase}\n` }));
  put(be, 'db/migrations/001.sql', 'create table t (id bigint);\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /be\/db\/migrations\/001\.sql/);
  assert.ok(r.output.includes(beBase.slice(0, 7)), r.output);
  noChangeSubRepo();
});

function noChangeSubRepo() {
  // Lần soi đầu của CP-108: repo con chưa đổi gì thì mục của nó trong diff không mang gốc soi,
  // và preflight đỏ "không biết gốc soi" dù spec khai `Gốc soi (fe):`.
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp108-sub2-'));
  put(root, '.compass/config.json', JSON.stringify({
    test: TEST_CMD, migrations: ['db/*.sql'], repos: { be: {}, fe: { preflight: ['node print-args.cjs {base}'] } },
  }));
  initGit(root);
  put(root, '.gitignore', '/*\n!/.compass/\n!/.gitignore\n');
  commit(root, 'workspace');
  const bases = {};
  for (const name of ['be', 'fe']) {
    const dir = path.join(root, name);
    initGit(dir);
    put(dir, 'db/001.sql', 'select 1;\n');
    put(dir, 'print-args.cjs', PRINT_ARGS);
    bases[name] = commit(dir, 'base');
  }
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/, fe/', head: `Gốc soi (be): ${bases.be}\nGốc soi (fe): ${bases.fe}\n` }));
  put(path.join(root, 'be'), 'a.js', 'export const a = 1;\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.deepEqual(argsIn(log(root, 'fe')), [bases.fe]);

  emptyRangeUnderEnd();
}

// Lần soi thứ hai của CP-108: fe khai `Soi đến (fe)` và khoảng soi của nó rỗng (trong Phạm vi).
// Một commit SAU Soi đến, ngoài việc của task, sửa migration của fe. Khoảng soi rỗng thì không
// có migration nào bị sửa: preflight@fe phải xanh, không đòi dòng Ngoại lệ cho file task không đụng.
function emptyRangeUnderEnd() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp108-sub3-'));
  put(root, '.compass/config.json', JSON.stringify({ test: TEST_CMD, migrations: ['db/*.sql'], repos: { be: {}, fe: {} } }));
  initGit(root);
  put(root, '.gitignore', '/*\n!/.compass/\n!/.gitignore\n');
  commit(root, 'workspace');
  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'a.js', 'export const a = 1;\n');
  const beBase = commit(be, 'base');
  const fe = path.join(root, 'fe');
  initGit(fe);
  put(fe, 'db/001.sql', 'select 1;\n');
  put(fe, 'src/x.js', 'export const x = 1;\n');
  const feBase = commit(fe, 'B');
  put(fe, 'docs/a.md', 'docs\n');
  const feEnd = commit(fe, 'E');
  put(fe, 'db/001.sql', 'select 2;\n');
  commit(fe, 'C — việc khác, sau Soi đến');
  put(root, '.compass/T-1/spec.md', SPEC({
    scope: 'be/, fe/src/',
    head: `Gốc soi (be): ${beBase}\nGốc soi (fe): ${feBase}\nSoi đến (fe): ${feEnd}\n`,
  }));
  put(be, 'a.js', 'export const a = 2;\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.doesNotMatch(r.output, /Ngoại lệ migration/);
}

test('CP-108-EC5 an optional environment section in a bug spec is still validated', () => {
  const env = '## Môi trường\n| Sự thật | Nguồn | Ngày |\n|---|---|---|\n| A | nguồn | 2026-13-01 |\n';
  const r = validateSpec(SPEC({ type: 'bug', env, cases: ['H1', 'V1', 'E1', 'EC1', 'H2', 'H3'] }));
  assert.ok(r.errors.some((e) => /Môi trường/.test(e)), r.errors.join('\n'));
});

test('CP-108-EC6 braces other than the two placeholders pass through', () => {
  const { root } = makeRepo({ config: { preflight: ['node -e "console.log(JSON.stringify({a:1}))"'] } });
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(log(root), /\{"a":1\}/);
});

// ---------------------------------------------------------------- Security

test('CP-108-S1 a changed file name that cannot be quoted safely stops the command before it runs', () => {
  // Skill nói đúng các ký tự đó, và chỉ có một bản của chính nó (lần soi đầu của CP-108).
  const skill = readFileSync(path.join(REPO, 'skills', 'compass', 'SKILL.md'), 'utf8');
  assert.equal(skill.match(/^name: compass$/gm)?.length, 1);
  assert.ok(skill.includes('Tên file có `"`, `$`, `` ` ``, `%`, `\\` hay xuống dòng'), 'skill phải liệt kê các ký tự bị từ chối');
  for (const name of ['src/$(touch pwned).js', 'src/%PATH%.js']) {
    const { root } = makeRepo({ config: { preflight: ['node print-args.cjs {changed}'] } });
    put(root, name, 'x\n');
    const r = pre(root);
    assert.equal(r.exitCode, 1, r.output);
    assert.ok(r.output.includes(name), r.output);
    assert.ok(!existsSync(path.join(root, 'pwned')));
    assert.ok(!existsSync(path.join(root, 'src', 'pwned')));
    assert.doesNotMatch(existsSync(evidence(root, 'preflight.log')) ? log(root) : '', /ARGS=/);
  }
});

test('CP-108-S2 an exception line below the first heading is not honoured', () => {
  const { root } = makeRepo({ config: MIG });
  const file = path.join(root, '.compass', 'T-1', 'spec.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('## Ràng buộc\n', '## Ràng buộc\nNgoại lệ migration: db/migrations/001.sql — lén thêm\n'));
  put(root, 'db/migrations/001.sql', 'create table users (id bigint);\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
});

test('CP-108-S3 a preflight record copied from another task or edited by hand is not trusted', () => {
  // Bản ghi xanh của task khác chép sang: done chặn, review coi như chưa xanh.
  const { root } = makeRepo({ config: { preflight: ['node -e "process.exit(0)"'] } });
  put(root, 'src/a.js', 'export const a = 2;\n');
  put(root, '.compass/T-2/spec.md', SPEC());
  assert.equal(preflightCommand({ cwd: root, taskId: 'T-2' }).exitCode, 0);
  const other = JSON.parse(readFileSync(path.join(root, '.compass', 'T-2', 'evidence', 'gate.json'), 'utf8'));
  mkdirSync(evidence(root), { recursive: true });
  writeFileSync(evidence(root, 'gate.json'), JSON.stringify({ preflight: other.preflight }));
  assert.match(doneCommand({ cwd: root, taskId: 'T-1' }).output, /thuộc task khác/);
  assert.match(reviewCommand({ cwd: root, taskId: 'T-1' }).output, /preflight/i);
  assert.ok(!existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')));

  // Bản ghi đỏ sửa tay thành xanh: chữ ký lệch.
  const t = makeRepo({ config: { preflight: ['node -e "process.exit(1)"'] } });
  put(t.root, 'src/a.js', 'export const a = 2;\n');
  pre(t.root);
  const g = gates(t.root);
  g.preflight.exitCode = 0;
  writeFileSync(evidence(t.root, 'gate.json'), JSON.stringify(g));
  assert.match(reviewCommand({ cwd: t.root, taskId: 'T-1' }).output, /preflight/i);
  assert.ok(!existsSync(path.join(t.root, '.compass', 'T-1', 'review-brief.md')));
});

test('CP-108-S4 the migration check names paths and SHAs, never file contents', () => {
  const { root } = makeRepo({ config: MIG });
  put(root, 'db/migrations/001.sql', 'create table users (id int);\npassword=hunter2\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.doesNotMatch(r.output, /hunter2/);
  assert.doesNotMatch(existsSync(evidence(root, 'preflight.log')) ? log(root) : '', /hunter2/);
});

// ---------------------------------------------------------------- Performance

test('CP-108-P1 nothing declared with 300 changed files stays within budget', () => {
  const { root } = makeRepo();
  for (let i = 0; i < 300; i++) put(root, `src/f${i}.js`, `export const f = ${i};\n`);
  const { value: r } = withinBudget({ run: () => pre(root), budgetMs: 5000, label: 'preflight không khai gì' });
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-108-P2 200 edited migrations among 300 changed files are listed within budget', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp108-p2-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: TEST_CMD, ...MIG }));
  for (let i = 0; i < 200; i++) put(root, `db/migrations/m${i}.sql`, `select ${i};\n`);
  for (let i = 0; i < 100; i++) put(root, `src/f${i}.js`, `export const f = ${i};\n`);
  const base = commit(root, 'base');
  put(root, '.compass/T-1/spec.md', SPEC({ head: `Gốc soi: ${base}\n` }));
  for (let i = 0; i < 200; i++) put(root, `db/migrations/m${i}.sql`, `select ${i} + 1;\n`);
  for (let i = 0; i < 100; i++) put(root, `src/f${i}.js`, `export const f = ${i + 1};\n`);
  const { value: r } = withinBudget({ run: () => pre(root), budgetMs: 10_000, label: '200 migration bị sửa' });
  assert.equal(r.exitCode, 1, r.output);
  // Danh sách liệt kê đủ 200 file khác nhau, mỗi file đúng một dòng.
  const listed = r.output.split('\n').filter((l) => /^\s+db\/migrations\/m\d+\.sql \(sửa\)$/.test(l)).map((l) => l.trim());
  assert.equal(new Set(listed).size, 200);
  assert.equal(listed.length, 200);
});
