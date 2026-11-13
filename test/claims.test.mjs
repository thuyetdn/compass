import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preflightCommand } from '../commands/preflight.mjs';
import { reviewCommand } from '../commands/review.mjs';
import { validateSpec } from '../lib/spec-validator.mjs';
import { withinBudget } from './helpers/timing.mjs';

// CP-110 — issue #7, đợt 3, mục 8: claim check trong preflight.

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

const LAYER = { H: 'Happy', V: 'Validation', E: 'Error', EC: 'Edge', S: 'Security', P: 'Performance' };
const CASES = ['H1', 'H2', 'H3', 'V1', 'V2', 'E1', 'E2', 'EC1', 'EC2', 'S1', 'S2', 'H4', 'H5'];

const SPEC = ({ type = 'fix', head = '', goal = 'Ghi tài liệu cho bộ lọc.', scope = 'lib/', cases = '' } = {}) => `# T-1: Tài liệu
Loại: ${type}
Phạm vi: ${scope}
${head}
## Mục tiêu
${goal}

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
${CASES.map((id) => `| ${id} | ${LAYER[id.replace(/\d+$/, '')]} | a | b | P0 |`).join('\n')}
${cases}`;

const TEST_CMD = 'node -e "0"';

function makeRepo({ head = '', goal, type, cases } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp110-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: TEST_CMD }));
  put(root, 'lib/a.js', 'export function parseThing(x) { return x; }\nexport const obj = { method() { return 1; } };\n');
  put(root, 'README.md', '# Demo\n\nOld line naming `lib/gone.js`.\n');
  const base = commit(root, 'base');
  put(root, '.compass/T-1/spec.md', SPEC({ head: `Gốc soi: ${base}\n${head}`, goal, type, cases }));
  return { root, base };
}

const pre = (root) => preflightCommand({ cwd: root, taskId: 'T-1' });
const addDoc = (root, text, file = 'README.md') => put(root, file, `${readFileSync(path.join(root, file), 'utf8')}${text}`);
const docLine = (root, needle, file = 'README.md') => readFileSync(path.join(root, file), 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;

// Số lần git chạy lệnh khớp `re` trong lúc `run`, đọc từ GIT_TRACE.
function gitCalls(run, re) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'compass-cp110-trace-')), 'trace.txt');
  const saved = process.env.GIT_TRACE;
  process.env.GIT_TRACE = file;
  try { run(); } finally { if (saved === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = saved; }
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return text.split('\n').filter((l) => /trace: built-in: git/.test(l) && re.test(l)).length;
}

// ---------------------------------------------------------------- Happy

test('CP-110-H1 an added doc line naming an existing path is green', () => {
  const { root } = makeRepo();
  addDoc(root, '\nThe filter lives in `lib/a.js` and `lib/`.\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  const rec = JSON.parse(readFileSync(path.join(root, '.compass/T-1/evidence/gate.json'), 'utf8')).preflight;
  assert.deepEqual(rec.claims, { checked: 2, wrong: 0, exempted: [] });
});

test('CP-110-H2 an added doc line naming the base commit, full or short, is green', () => {
  const { root, base } = makeRepo();
  addDoc(root, `\nSince \`${base}\` (short \`${base.slice(0, 7)}\`).\n`);
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-110-H3 a function claim whose name appears in code is green', () => {
  const { root } = makeRepo();
  addDoc(root, '\nCall `parseThing()` or `parseThing(x, y)`.\n');
  assert.equal(pre(root).exitCode, 0);
});

test('CP-110-H4 an exemption line in the spec header lets one claim through and says so', () => {
  const { root } = makeRepo({ head: 'Tuyên bố ngoài repo: lib/other.js — lives in the payments repo\n' });
  addDoc(root, '\nPayments call `lib/other.js`.\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /^ℹ Tuyên bố `lib\/other\.js` được miễn theo dòng Tuyên bố ngoài repo của spec: lives in the payments repo$/m);
});

test('CP-110-H5 multi-repo: a path under the repo folder is checked against that repo', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp110-mr-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: TEST_CMD, repos: { be: {}, fe: {} } }));
  put(root, 'be/src/b.js', 'export const b = 1;\n');
  put(root, 'be/README.md', '# be\n');
  put(root, 'fe/f.js', 'export const f = 1;\n');
  const base = commit(root, 'base');
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/, fe/', head: `Gốc soi: ${base}\n` }));
  put(root, 'be/README.md', '# be\n\nSee `src/b.js`.\n');
  // Tài liệu của fe nói về thư mục của fe: `src/` ở be không biến nó thành tuyên bố sai của be.
  put(root, 'fe/README.md', '# fe\n\nSee `src/x.js`.\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  put(root, 'be/README.md', '# be\n\nSee `src/b.js` and `src/c.js`.\n');
  const red = pre(root);
  assert.equal(red.exitCode, 1, red.output);
  assert.match(red.output, /be\/README\.md:3 `src\/c\.js` — không có file hay thư mục này/);
  // Spec nói về mọi repo trong phạm vi: `src/zz.js` neo được ở be, nên được phán.
  put(root, 'be/README.md', '# be\n\nSee `src/b.js`.\n');
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/, fe/', head: `Gốc soi: ${base}\n`, goal: 'Đọc `src/zz.js`.' }));
  assert.match(pre(root).output, /\.compass\/T-1\/spec\.md:\d+ `src\/zz\.js` — không có file hay thư mục này/);
});

test('CP-110-H6 a path with a line suffix is checked without the suffix', () => {
  const { root } = makeRepo();
  addDoc(root, '\nSee `lib/a.js:12`.\n');
  assert.equal(pre(root).exitCode, 0);
  addDoc(root, 'And `lib/zz.js:3`.\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /`lib\/zz\.js:3` — không có file hay thư mục này/);
});

// ---------------------------------------------------------------- Validation

test('CP-110-V1 an exemption line without a reason or without a span fails the spec gate with its line number', () => {
  for (const [line, re] of [['Tuyên bố ngoài repo: lib/x.js', /thiếu lý do/], ['Tuyên bố ngoài repo: — because', /thiếu span/]]) {
    const text = SPEC({ head: `${line}\n` });
    const n = text.split('\n').findIndex((l) => l.startsWith('Tuyên bố')) + 1;
    const v = validateSpec(text);
    const err = v.errors.find((e) => e.includes('Tuyên bố ngoài repo'));
    assert.ok(err, v.errors.join('\n'));
    assert.match(err, new RegExp(`ở dòng ${n} `));
    assert.match(err, re);
  }
});

test('CP-110-V2 an exemption line below the first heading is not honoured', () => {
  const { root } = makeRepo({ goal: 'Ghi tài liệu.\nTuyên bố ngoài repo: lib/other.js — lives elsewhere' });
  addDoc(root, '\nPayments call `lib/other.js`.\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /`lib\/other\.js` — không có file hay thư mục này/);
});

// ---------------------------------------------------------------- Error

test('CP-110-E1 a typo in a path under an existing folder makes preflight red with file, line and reason', () => {
  const { root } = makeRepo();
  addDoc(root, '\nThe gate lives in `lib/preflght.mjs`, or in `` lib/preflght2.mjs ``.\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /`lib\/preflght2\.mjs` — không có file hay thư mục này/);
  assert.match(r.output, new RegExp(`README\\.md:${docLine(root, 'preflght')} \`lib/preflght\\.mjs\` — không có file hay thư mục này`));
  assert.match(r.output, /Tuyên bố ngoài repo: lib\/preflght\.mjs — <lý do>/);
});

test('CP-110-E2 a SHA-shaped span that is not a commit is red', () => {
  const { root } = makeRepo();
  addDoc(root, '\nFixed in `deadbeef1`.\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /`deadbeef1` — không phải commit trong git này/);
});

test('CP-110-E3 a function name that appears nowhere in code is red', () => {
  const { root } = makeRepo();
  addDoc(root, '\nCall `parseTing()`.\n');
  put(root, 'notes.md', 'parseTing is mentioned only in markdown\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /`parseTing\(\)` — không thấy tên này trong code/);
});

test('CP-110-E4 a false path in the spec goal is red and located in the spec', () => {
  const { root } = makeRepo({ goal: 'Đọc `lib/missing.js`.\n\n```text\n`lib/fenced.js`\n```' });
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.doesNotMatch(r.output, /fenced\.js/);
  const n = readFileSync(path.join(root, '.compass/T-1/spec.md'), 'utf8').split('\n').findIndex((l) => l.includes('lib/missing.js')) + 1;
  assert.match(r.output, new RegExp(`\\.compass/T-1/spec\\.md:${n} \`lib/missing\\.js\` — không có file hay thư mục này`));
});

test('CP-110-E5 a red claim check stops review from writing a brief', () => {
  const { root } = makeRepo({ type: 'feature-s' });
  addDoc(root, '\nSee `lib/nope.js`.\n');
  assert.equal(pre(root).exitCode, 1);
  const r = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Preflight chưa xanh trên code hiện tại, nên Compass không sinh brief:\n {4}"preflight" đang đỏ\./);
  assert.ok(!existsSync(path.join(root, '.compass/T-1/review-brief.md')));
});

// ---------------------------------------------------------------- Edge

test('CP-110-EC1 a false path inside a fenced block of an added section is not checked', () => {
  const { root } = makeRepo();
  addDoc(root, '\n```md\nSee `lib/nope.js`.\n```\n\n~~~~\n`lib/nope2.js`\n~~~\n`lib/nope3.js`\n~~~~\n');
  assert.equal(pre(root).exitCode, 0);
});

test('CP-110-EC2 a false claim on a line the task did not add is not checked', () => {
  const { root } = makeRepo();
  addDoc(root, '\nA new line naming `lib/a.js`.\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.doesNotMatch(r.output, /gone\.js/);

  // Soi đến: diff giữa hai commit. Cây làm việc sau đó chèn dòng lên đầu, nên số dòng của diff không
  // còn chỉ đúng dòng trên đĩa; claim check phải đọc dòng task thêm, không phải dòng đang nằm ở số đó.
  const t = makeRepo();
  // Khối rào cũng đọc ở commit Soi đến: dịch hai dòng thì rào trên đĩa không còn trùng dòng `fenced.js`.
  addDoc(t.root, 'New `lib/nope.js`.\n```\n`lib/fenced.js`\n```\n');
  git(t.root, ['add', 'README.md']);
  git(t.root, ['commit', '-q', '-m', 'task']);
  const end = git(t.root, ['rev-parse', 'HEAD']);
  put(t.root, '.compass/T-1/spec.md', SPEC({ head: `Gốc soi: ${t.base}\nSoi đến: ${end}\n`, scope: 'README.md' }));
  put(t.root, 'README.md', `# Top\n\n${readFileSync(path.join(t.root, 'README.md'), 'utf8')}`);
  // Một commit sau Soi đến: Soi đến trùng HEAD thì Compass soi như không khai.
  git(t.root, ['add', 'README.md']);
  git(t.root, ['commit', '-q', '-m', 'later']);
  const shifted = pre(t.root);
  assert.equal(shifted.exitCode, 1, shifted.output);
  assert.match(shifted.output, /README\.md:4 `lib\/nope\.js` — không có file hay thư mục này/);
  assert.doesNotMatch(shifted.output, /gone\.js|fenced\.js/);
});

test('CP-110-EC3 relative, glob, placeholder, URL and flag spans are not judged', () => {
  const { root } = makeRepo();
  addDoc(root, '\n`evidence/gate.json`, `lib/*.js`, `<id>/spec.md`, `https://x.y/lib/a.js`, `--force`, `lib/{a,b}.js`, `lib/../x.js`.\n');
  put(root, 'lib/b.js', '// see `lib/nope.js`\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, '.compass/T-1/evidence/gate.json'), 'utf8')).preflight.claims.checked, 0);
});

test('CP-110-EC4 seven hex characters of one class are not treated as a SHA', () => {
  const { root } = makeRepo();
  addDoc(root, '\n`aaaaaaa` and `1234567` and `deadbee`.\n');
  assert.equal(pre(root).exitCode, 0);
});

test('CP-110-EC5 a dotted call is looked up by its last part', () => {
  const { root } = makeRepo();
  addDoc(root, '\nUse `obj.method()`.\n');
  assert.equal(pre(root).exitCode, 0);
  addDoc(root, 'And `method.nothere()`.\n');
  assert.match(pre(root).output, /`method\.nothere\(\)` — không thấy tên này trong code/);
});

test('CP-110-EC6 a made-up fixture path in the spec test-case table is not checked', () => {
  const { root } = makeRepo({ cases: '| EC9 | Edge | fixture `lib/fake.js` | `lib/fake2.js` stays | P1 |\n' });
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-110-EC7 a span holding an ellipsis is a placeholder, not a path', () => {
  const { root } = makeRepo({ goal: 'Files under `lib/…` and `lib/x…`.' });
  assert.equal(pre(root).exitCode, 0);
});

// ---------------------------------------------------------------- Security

test('CP-110-S1 a span shaped like a shell command never reaches a shell', () => {
  const { root } = makeRepo();
  // `$IFS` không ngoặc nhọn: span vẫn là đường dẫn máy phán, và qua sh thì nó thành dấu cách.
  addDoc(root, "\n`lib/$(touch$IFS'pwned')`, `lib/a.js;touch$IFS'pwned2'`, `x$(touch$IFS'pwned3')()`.\n");
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /`lib\/\$\(touch\$IFS'pwned'\)` — không có file hay thư mục này/);
  assert.match(r.output, /`lib\/a\.js;touch\$IFS'pwned2'` — không có file hay thư mục này/);
  assert.match(r.output, /`x\$\(touch\$IFS'pwned3'\)\(\)` — không thấy tên này trong code/);
  for (const f of ['pwned', 'pwned2', 'pwned3']) {
    assert.ok(!existsSync(path.join(root, f)) && !existsSync(path.join(root, 'lib', f)), f);
  }
});

test('CP-110-S2 a span starting with a dash is never passed to git as a flag', () => {
  const { root } = makeRepo();
  put(root, '-x/a.js', '1;\n');
  addDoc(root, '\n`--output=x`, `-abc1234`, `--exec=touch x`, `-x/b.js`.\n');
  const r = pre(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.ok(!existsSync(path.join(root, 'x')));
});

test('CP-110-S3 a red claim shows path, line and span, never the rest of the line', () => {
  const { root } = makeRepo();
  addDoc(root, '\ntoken=SECRET-123 see `lib/nope.js` password=hunter2\n');
  const r = pre(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /README\.md:\d+ `lib\/nope\.js`/);
  assert.doesNotMatch(r.output, /SECRET-123|hunter2/);
});

// ---------------------------------------------------------------- Performance

test('CP-110-P1 500 added doc lines with 300 claims and 50 function names stay within budget', () => {
  const { root } = makeRepo();
  const names = Array.from({ length: 50 }, (_, i) => `fn${i}`);
  put(root, 'lib/many.js', names.map((n) => `export function ${n}() {}\n`).join(''));
  const lines = Array.from({ length: 500 }, (_, i) => (i < 300 ? `Call \`${names[i % 50]}()\`.` : `Plain line ${i}.`));
  addDoc(root, `\n${lines.join('\n')}\n`);
  const { value } = withinBudget({ run: () => pre(root), budgetMs: 8000, label: 'CP-110-P1' });
  assert.equal(value.exitCode, 0, value.output);
  assert.equal(gitCalls(() => pre(root), / grep /), 1, 'one git grep for the 50 names');
});

test('CP-110-P2 200 distinct SHA claims are checked in one batch within budget', () => {
  const { root } = makeRepo();
  const shas = Array.from({ length: 200 }, (_, i) => `${(i + 0x100000).toString(16)}a${i}`.slice(0, 9).padEnd(9, '1'));
  addDoc(root, `\n${shas.map((s) => `\`${s}\``).join(' ')}\n`);
  const { value } = withinBudget({ run: () => pre(root), budgetMs: 8000, label: 'CP-110-P2' });
  assert.equal(value.exitCode, 1);
  assert.equal((value.output.match(/không phải commit trong git này/g) ?? []).length, 200);
  assert.equal(gitCalls(() => pre(root), / cat-file --batch-check/), 1, 'one cat-file batch for the 200 SHAs');
});
