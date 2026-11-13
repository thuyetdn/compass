import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewCommand } from '../commands/review.mjs';
import { CRITERIA } from '../lib/findings.mjs';
import { parseHunks } from '../lib/review-rounds.mjs';
import { passingTitles } from '../lib/test-parser.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { sha256 } from '../lib/hash.mjs';

// CP-107: phần CP-106 để lại — test đỏ sau mỗi bản sửa (`redTest`, `rerunBy`), rung cũ của
// mắt chuỗi quay lại danh sách chờ, dòng `+++` trong thân hunk, vòng verify qua repo con.

const SPEC = ({ head = '', scope = 'src/' } = {}) => `# T-1: Bộ lọc
Loại: feature-s
Phạm vi: ${scope}
${head}
## Mục tiêu
Lọc danh sách theo quốc gia.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | a | b | P0 |
`;

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

const BASE = Array.from({ length: 30 }, (_, i) => `export const v${i + 1} = ${i + 1};`);

function setLine(root, n, text, rel = 'src/a.js') {
  const lines = readFileSync(path.join(root, rel), 'utf8').split('\n');
  lines[n - 1] = text;
  writeFileSync(path.join(root, rel), lines.join('\n'));
}

function makeRepo({ head = '' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp107-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
  put(root, 'src/a.js', `${BASE.join('\n')}\n`);
  const base = commit(root, 'base');
  put(root, '.compass/T-1/spec.md', SPEC({ head: `Gốc soi: ${base}\n${head}` }));
  setLine(root, 2, 'export const v2 = "task";');
  return root;
}

const run = (root) => reviewCommand({ cwd: root, taskId: 'T-1' });
const evidence = (root, file) => path.join(root, '.compass', 'T-1', 'evidence', file);
const briefText = (root) => readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
const idIn = (text) => text.match(/"brief":\s*"([^"]+)"/)?.[1] ?? null;
const ledger = (root) => JSON.parse(readFileSync(evidence(root, 'review-ledger.json'), 'utf8'));

function coverageOf(findings) {
  const used = new Set(findings.map((f) => f?.criterion).filter(Boolean));
  return Object.fromEntries(CRITERIA.map(({ key }) => [key, { verdict: used.has(key) ? 'findings' : 'clean' }]));
}

function submit(root, { findings = [], closures } = {}) {
  const body = { brief: idIn(briefText(root)), coverage: coverageOf(findings), findings };
  if (closures !== undefined) body.closures = closures;
  writeFileSync(evidence(root, 'findings.json'), JSON.stringify(body));
}

const major = (id, line, extra = {}) => ({
  id, severity: 'Major', criterion: 'spec', title: `Lỗi ${id}`, detail: 'hỏng', file: 'src/a.js', line,
  disposition: { action: 'fix' }, ...extra,
});
const noTest = { redTest: null, note: 'fixture không có test' };

// Bản ghi gate `test` đã ký, log nằm cạnh nó — đúng hình dạng `compass test` ghi.
function testGate(root, log, { exitCode = 0, sourceHash } = {}) {
  mkdirSync(evidence(root, ''), { recursive: true });
  writeFileSync(evidence(root, 'test.log'), log);
  writeGate(root, 'T-1', {
    gate: 'test', command: 'node t.js', exitCode, outputHash: sha256(log), outputFile: 'evidence/test.log',
    sourceHash: sourceHash ?? hashSource(root),
  });
}

const LOG = [
  '✔ T-1-H1 adds an item (1.2ms)',
  '✔ fixes F1 by narrowing the guard (2.5ms)',
  '✖ broken thing (3ms)',
  'not ok 2 - another broken thing',
  'ok 3 - tap passing title',
  '✓ jest passing title (3 ms)',
].join('\n');

// Vòng 1: một Major cần sửa ở dòng 2. Rồi sửa code, ghi gate `test`, mở vòng 2.
function toRound2(root, log = LOG) {
  assert.equal(run(root).exitCode, 1);
  submit(root, { findings: [major('F1', 2)] });
  assert.equal(run(root).exitCode, 1);
  setLine(root, 2, 'export const v2 = "fix-1";');
  if (log !== null) testGate(root, log);
  const pending = run(root);
  assert.equal(pending.exitCode, 1, pending.output);
}

function round2(root, closure, findings = []) {
  submit(root, { closures: [{ id: 'F1', status: 'closed', ...closure }], findings });
  return run(root);
}

test('CP-107-H1 a narrow fix names a passing test and the lens that re-ran; both land in the ledger', () => {
  const root = makeRepo();
  toRound2(root);
  const r = round2(root, { rung: 'narrow', redTest: 'fixes F1 by narrowing the guard', rerunBy: 'matrix' });
  assert.equal(r.exitCode, 0, r.output);
  const c = ledger(root).rounds[1].closures[0];
  assert.equal(c.redTest, 'fixes F1 by narrowing the guard');
  assert.equal(c.rerunBy, 'matrix');
});

test('CP-107-H2 a revert needs no redTest', () => {
  const root = makeRepo();
  toRound2(root, null);
  const r = round2(root, { rung: 'revert' });
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(ledger(root).rounds[1].closures[0].redTest, null);
});

test('CP-107-H3 redTest null with a note is accepted and counted', () => {
  const root = makeRepo();
  toRound2(root, null);
  const r = round2(root, { rung: 'reuse', redTest: null, note: 'docs-only fix' });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /1 bản sửa không có test đỏ trước/);
});

test('CP-107-H4 a relisted third chain link shows the round and rung it was closed with', () => {
  const root = makeRepo({ head: 'Vòng soi tối đa: 5 — fixture cần vòng 5' });
  assert.equal(run(root).exitCode, 1);
  submit(root, { findings: [major('F1', 2)] });
  run(root);
  const step = (value, body) => {
    setLine(root, 2, `export const v2 = "${value}";`);
    assert.equal(run(root).exitCode, 1);
    submit(root, body);
    return run(root);
  };
  step('fix-1', { closures: [{ id: 'F1', status: 'closed', rung: 'narrow', ...noTest }], findings: [major('F2', 2, { origin: 'fix-induced', causedBy: 'F1' })] });
  step('fix-2', { closures: [{ id: 'F2', status: 'closed', rung: 'narrow', ...noTest }], findings: [major('F3', 2, { origin: 'fix-induced', causedBy: 'F2' })] });
  const r4 = step('fix-3', { closures: [{ id: 'F3', status: 'closed', rung: 'narrow', ...noTest }] });
  assert.equal(r4.exitCode, 1, r4.output);
  setLine(root, 2, 'export const v2 = "fix-4";');
  const r5 = run(root);
  assert.equal(r5.exitCode, 1, r5.output);
  const brief = briefText(root);
  assert.match(brief, /vòng 5/);
  const block = brief.slice(brief.indexOf('F3 [Major]'));
  assert.match(block.split('\n').slice(0, 6).join('\n'), /đã đóng ở vòng 4 bằng rung "narrow".*revert/);
});

const HEADER = 'diff --git a/src/a.js b/src/a.js\nindex 1..2 100644\n--- a/src/a.js\n+++ b/src/a.js\n';

test('CP-107-H5 an added line whose content starts with "++ " stays in its file', () => {
  const diff = `${HEADER}@@ -1,2 +1,4 @@\n ctx\n+++ x\n+more\n+again\n ctx2\n`;
  const hunks = parseHunks(diff);
  assert.deepEqual([...hunks.keys()], ['src/a.js']);
  assert.deepEqual(hunks.get('src/a.js'), [[1, 4]]);
});

test('CP-107-EC1 a deleted "-- y" line followed by an added "++ y" line keeps the file and ranges', () => {
  const diff = `${HEADER}@@ -3,3 +3,3 @@\n ctx\n--- y\n+++ y\n ctx\n@@ -10 +10 @@\n-old\n+new\n`;
  const hunks = parseHunks(diff);
  assert.deepEqual([...hunks.keys()], ['src/a.js']);
  assert.deepEqual(hunks.get('src/a.js'), [[3, 3], [10, 1]]);
});

// Gốc Compass với git chỉ theo dõi `.compass/`; repo con có git riêng (CP-84).
function workspace(scope = 'be/') {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp107-ws-'));
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { be: { test: 'true' } } }));
  initGit(root);
  put(root, '.gitignore', '/*\n!/.compass/\n!/.gitignore\n');
  commit(root, 'workspace');
  return root;
}

function subGit(dir) {
  initGit(dir);
  put(dir, 'a.js', `${BASE.join('\n')}\n`);
  return commit(dir, 'base');
}

function verifyAcrossSubRepo(root, gitDir, prefix) {
  const base = subGit(gitDir);
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/', head: `Gốc soi (be): ${base}\n` }));
  setLine(gitDir, 2, 'export const v2 = "task";', 'a.js');
  assert.equal(run(root).exitCode, 1);
  submit(root, { findings: [major('F1', 2, { file: `${prefix}/a.js` })] });
  assert.equal(run(root).exitCode, 1);
  setLine(gitDir, 2, 'export const v2 = "fix-1";', 'a.js');
  assert.equal(run(root).exitCode, 1);
  const brief = briefText(root);
  assert.ok(brief.includes(`${prefix}/a.js`), brief);
  submit(root, {
    closures: [{ id: 'F1', status: 'closed', rung: 'narrow', ...noTest }],
    findings: [major('F2', 2, { file: `${prefix}/a.js`, origin: 'fix-induced', causedBy: 'F1', severity: 'Minor', disposition: { action: 'kept', reason: 'không ai gặp' } })],
  });
  return run(root);
}

test('CP-107-H6 a verify round over a nested sub-repo with its own git accepts a fix-induced finding there', () => {
  const root = workspace();
  const r = verifyAcrossSubRepo(root, path.join(root, 'be'), 'be');
  assert.equal(r.exitCode, 0, r.output);
  assert.doesNotMatch(r.output, /không nằm trong bản sửa/);
});

test('CP-107-H7 a verify round over a sub-repo declared through a junction to a git inside the root', () => {
  const root = workspace();
  const real = path.join(root, 'real', 'be');
  mkdirSync(real, { recursive: true });
  symlinkSync(real, path.join(root, 'be'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = verifyAcrossSubRepo(root, real, 'real/be');
  assert.equal(r.exitCode, 0, r.output);
  assert.doesNotMatch(r.output, /không nằm trong bản sửa/);
});

test('CP-107-V1 a narrow fix without redTest is a rubric error', () => {
  const root = makeRepo();
  toRound2(root);
  const r = round2(root, { rung: 'narrow' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /closure F1: rung narrow .*"redTest"/);
});

test('CP-107-V2 redTest null needs a note', () => {
  const root = makeRepo();
  toRound2(root);
  const r = round2(root, { rung: 'mechanism', redTest: null });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /closure F1: "redTest": null phải kèm "note"/);
});

test('CP-107-V3 redTest must be a title or null', () => {
  for (const bad of [42, '', '   ']) {
    const root = makeRepo();
    toRound2(root);
    const r = round2(root, { rung: 'narrow', redTest: bad });
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, /closure F1: "redTest" phải là tên một test/);
  }
});

test('CP-107-V4 rerunBy must be a non-empty string', () => {
  for (const bad of ['', {}]) {
    const root = makeRepo();
    toRound2(root);
    const r = round2(root, { rung: 'revert', rerunBy: bad });
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, /closure F1: "rerunBy" phải là chuỗi không rỗng/);
  }
});

test('CP-107-E1 a redTest missing from the log names the title and the log', () => {
  const root = makeRepo();
  toRound2(root);
  const r = round2(root, { rung: 'narrow', redTest: 'no such test' });
  assert.equal(r.exitCode, 2, r.output);
  assert.ok(r.output.includes('"no such test"'), r.output);
  assert.ok(r.output.includes(path.join('.compass', 'T-1', 'evidence', 'test.log')), r.output);
});

test('CP-107-E2 no record, a red record or a stale record means run check first; no ledger round', () => {
  const cases = {
    missing: () => {},
    red: (root) => testGate(root, LOG, { exitCode: 1 }),
    stale: (root) => testGate(root, LOG, { sourceHash: 'sha256:old' }),
    // Bản ghi đỏ sửa tay thành xanh: chữ ký lệch, nên không còn là bản ghi tin được.
    tampered: (root) => {
      testGate(root, LOG, { exitCode: 1 });
      const file = evidence(root, 'gate.json');
      const gates = JSON.parse(readFileSync(file, 'utf8'));
      gates.test.exitCode = 0;
      writeFileSync(file, JSON.stringify(gates));
    },
  };
  for (const [name, arrange] of Object.entries(cases)) {
    const root = makeRepo();
    toRound2(root, null);
    arrange(root);
    const r = round2(root, { rung: 'narrow', redTest: 'fixes F1 by narrowing the guard' });
    assert.equal(r.exitCode, 2, `${name}: ${r.output}`);
    assert.match(r.output, /compass check T-1/, name);
    assert.equal(ledger(root).rounds.length, 1, name);
  }
});

test('CP-107-EC2 a prefix of a passing title is not that title', () => {
  const root = makeRepo();
  toRound2(root);
  const r = round2(root, { rung: 'narrow', redTest: 'fixes F1' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /không có trên dòng pass nào/);
});

test('CP-107-EC3 a title in the second repo section of a joined log is found', () => {
  const root = makeRepo();
  toRound2(root, `# repo be\n✔ be only (1ms)\n# repo fe\n✔ fe fix covers F1 (2ms)\n`);
  const r = round2(root, { rung: 'narrow', redTest: 'fe fix covers F1' });
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-107-EC4 node, TAP and jest passing lines all yield the bare title', () => {
  const titles = passingTitles(LOG);
  for (const t of ['T-1-H1 adds an item', 'tap passing title', 'jest passing title']) assert.ok(titles.has(t), t);
  assert.ok(passingTitles('  ✔ nested title (12.5ms)').has('nested title'));
  assert.ok(passingTitles('√ windows tick').has('windows tick'));
  // Vitest --reporter=tap: chú thích `# time=…` đổi mỗi lần chạy, dòng mở khối không phải test.
  const vitest = passingTitles('ok 1 - t/a.test.js # time=3.14ms {\n    ok 1 - CP-9-H1 covers it # time=1.62ms\n}');
  assert.deepEqual([...vitest], ['CP-9-H1 covers it']);
  // Mã màu ANSI quanh dấu tick.
  assert.ok(passingTitles('\u001b[32m✓\u001b[39m CP-9-H2 colored').has('CP-9-H2 colored'));
  // Dòng tên file của Jest không phải test.
  assert.equal(passingTitles('PASS src/a.test.js').size, 0);
});

test('CP-107-S1 a title only on failing lines does not count', () => {
  for (const t of ['broken thing', 'another broken thing']) {
    const root = makeRepo();
    toRound2(root);
    const r = round2(root, { rung: 'narrow', redTest: t });
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, /không có trên dòng pass nào/);
  }
});

test('CP-107-S2 redTest is literal, never a pattern', () => {
  for (const t of ['.*', 'fixes F1 by narrowing the gu(a)rd', '[a-z]+']) {
    const root = makeRepo();
    toRound2(root);
    const r = round2(root, { rung: 'narrow', redTest: t });
    assert.equal(r.exitCode, 2, `${t}: ${r.output}`);
    assert.match(r.output, /không có trên dòng pass nào/);
  }
});

test('CP-107-S3 a test.log edited after the gate ran is refused', () => {
  const root = makeRepo();
  toRound2(root, '✔ something else (1ms)\n');
  writeFileSync(evidence(root, 'test.log'), '✔ fixes F1 by narrowing the guard (1ms)\n');
  const r = round2(root, { rung: 'narrow', redTest: 'fixes F1 by narrowing the guard' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /không còn khớp bản ghi/);
});
