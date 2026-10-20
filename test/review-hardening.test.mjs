import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewCommand } from '../commands/review.mjs';
import { collectContext } from '../lib/review-context.mjs';
import { stripComments } from '../lib/repo-detect.mjs';
import { writeReview } from './helpers/review.mjs';
import { withinBudget } from './helpers/timing.mjs';

// CP-79 — năm lỗi lần soi thứ ba của CP-78 để lại, và bảy Minor lần soi của chính
// CP-79 tìm ra. Lỗi 1, 2, 3 và 5 có test đỏ trên code ở e481b51. Lỗi 4 (giữ mọi
// file trong bộ nhớ) không đo được bằng test mà không chập chờn: EC1 và EC2 chỉ
// chứng minh bản quét một lượt cho cùng kết quả, và cũng xanh trên e481b51.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'ignore' });

function makeRepo({ base = {}, changes = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-harden-'));
  const put = (rel, body) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  };
  put('.compass/config.json', JSON.stringify({ test: 'true' }));
  put('.compass/T-1/spec.md', SPEC);
  for (const [rel, body] of Object.entries(base)) put(rel, body);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  put('.compass/T-1/spec.md', SPEC.replace('Phạm vi: src/', `Phạm vi: src/\nGốc soi: ${sha}`));
  for (const [rel, body] of Object.entries(changes)) put(rel, body);
  return root;
}

const run = (root) => reviewCommand({ cwd: root, taskId: 'T-1' });
const contextOf = (root, files) => collectContext(root, { files }).text;

function section(text, name) {
  const start = text.indexOf(`### ${name}`);
  assert.ok(start >= 0, `thiếu mục ### ${name}`);
  const rest = text.slice(start + 4 + name.length);
  const next = rest.search(/\n### /);
  return next < 0 ? rest : rest.slice(0, next);
}

test('CP-79-H1 names quoted in comments are not exports', () => {
  const lib = [
    '// Ví dụ cũ: export const fake = 1;',
    '/* module.exports = { ghost }; */',
    'export function real() { return 1; }',
    '',
  ].join('\n');
  const root = makeRepo({
    base: {
      'src/lib.js': 'export function real() {}\n',
      'src/use.js': "import { real } from './lib.js';\nreal();\n",
      'src/side.js': '/** export const phantom = 2; */\nexport const sidekick = 3;\n',
    },
    changes: { 'src/lib.js': lib },
  });
  const ctx = contextOf(root, ['src/lib.js']);
  const impact = section(ctx, 'impact');
  assert.match(impact, /src\/lib\.js → real:/);
  assert.ok(!/\bfake\b/.test(impact), 'tên trong comment không được thành export');
  assert.ok(!/\bghost\b/.test(impact));
  const reuse = section(ctx, 'reuse');
  assert.match(reuse, /src\/side\.js: sidekick/);
  assert.ok(!/\bphantom\b/.test(reuse));
});

test('CP-79-H2 SKILL.md says a context-only reopen needs a pinned diff', () => {
  // Bản checkout trên Windows có thể là CRLF; không chuẩn hóa thì `\n\n` không
  // thấy, đoạn cắt chạy tới hết file và test xanh trên chữ ở chỗ khác.
  const skill = readFileSync(path.join(ROOT, 'skills', 'compass', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const i = skill.indexOf('Id băm cả spec, diff lẫn ngữ cảnh');
  assert.ok(i >= 0, 'đoạn nói về id brief đã biến mất');
  const end = skill.indexOf('\n\n', i);
  assert.ok(end > i, 'đoạn phải kết thúc bằng một dòng trống');
  const para = skill.slice(i, end);
  assert.match(para, /task khai `Soi đến:`/, 'phải nói điều kiện Soi đến');
  assert.match(para, /Không khai `Soi đến:`.*?code hoặc spec đã đổi/, 'phải nói khi không có Soi đến thì là code đổi');
  assert.match(para, /nâng cấp Compass/, 'phải nói nâng cấp Compass cũng chỉ đổi ngữ cảnh');
});

test('CP-79-V1 a changed code file over 1 MB is named, not skipped', () => {
  const big = `export const big = 1;\n${'// filler\n'.repeat(110_000)}`;
  const root = makeRepo({ base: { 'src/big.js': 'export const big = 0;\n' }, changes: { 'src/big.js': big } });
  const impact = section(contextOf(root, ['src/big.js']), 'impact');
  assert.match(impact, /src\/big\.js: không đọc được \(lớn hơn 1 MB\)/);
  assert.ok(!/Không có file code nào để dò/.test(impact));
});

test('CP-79-V2 a changed code file holding a NUL byte is named, not skipped', () => {
  const root = makeRepo({ base: { 'src/blob.js': 'export const b = 0;\n' }, changes: { 'src/blob.js': 'export const b = 1;\n\0\n' } });
  assert.match(section(contextOf(root, ['src/blob.js']), 'impact'), /src\/blob\.js: không đọc được \(nhị phân\)/);
});

test('CP-79-V3 a changed code file missing from the working tree gets its own reason', () => {
  const root = makeRepo({ base: { 'src/gone.js': 'export const g = 0;\n' } });
  rmSync(path.join(root, 'src', 'gone.js'));
  const impact = section(contextOf(root, ['src/gone.js']), 'impact');
  assert.match(impact, /src\/gone\.js: không đọc được \(không có trong cây làm việc\)/);
  assert.ok(!/lớn hơn 1 MB/.test(impact), 'file không có thì không được bảo là lớn');
});

// Dựng đúng chuỗi lỗi reviewer tái hiện: brief phát ra, code sửa, findings hỏng
// nộp vào (nhánh đó ghi đè sổ bằng diff mới), rồi một lần chạy nữa.
function staleThroughMalformed() {
  const root = makeRepo({
    base: { 'src/filter.js': 'export const filter = (l) => l;\n' },
    changes: { 'src/filter.js': 'export const filter = (l, c) => l;\n' },
  });
  assert.equal(run(root).exitCode, 1, 'pha một phải sinh brief');
  writeFileSync(path.join(root, 'src', 'filter.js'), 'export const filter = (l, c) => l.filter(Boolean);\n');
  writeFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'findings.json'), '{ hỏng');
  assert.equal(run(root).exitCode, 2, 'findings hỏng phải bị từ chối');
  return root;
}

test('CP-79-E1 after malformed findings, phase two still says the code changed', () => {
  const root = staleThroughMalformed();
  writeReview(root, 'T-1');
  const r = run(root);
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Code hoặc spec đã đổi/);
  assert.ok(!/ngữ cảnh repo/.test(r.output), 'code đổi thật, không được bảo là ngữ cảnh');
});

test('CP-79-E2 after malformed findings, phase one still says the code changed', () => {
  const root = staleThroughMalformed();
  rmSync(path.join(root, '.compass', 'T-1', 'evidence', 'findings.json'));
  const r = run(root);
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Code hoặc spec đã đổi/);
  assert.ok(!/ngữ cảnh repo/.test(r.output));
});

test('CP-79-EC1 a one-pass caller scan matches a per-name scan, in the same order', () => {
  const names = Array.from({ length: 20 }, (_, i) => `fn${String(i).padStart(2, '0')}`);
  const lib = names.map((n) => `export function ${n}() {}`).join('\n') + '\n';
  const base = { 'src/lib.js': lib };
  for (let f = 0; f < 12; f += 1) {
    const used = names.filter((_, i) => (i + f) % 3 === 0);
    base[`use/u${String(f).padStart(2, '0')}.js`] = [`import { ${used.join(', ')} } from '../src/lib.js';`, ...used.map((n) => `${n}();`)].join('\n') + '\n';
  }
  const root = makeRepo({ base, changes: { 'src/lib.js': `${lib}// đổi\n` } });

  // Bản đối chiếu độc lập: quét từng tên trên từng file, như bản trước CP-79.
  const files = Object.keys(base).filter((f) => f !== 'src/lib.js').sort();
  const impact = section(contextOf(root, ['src/lib.js']), 'impact');
  for (const name of names) {
    const re = new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
    const hits = [];
    for (const rel of files) {
      base[rel].split('\n').forEach((line, i) => { if (re.test(line)) hits.push(`${rel}:${i + 1}`); });
    }
    const more = hits.length > 8 ? ` (và ${hits.length - 8} nơi khác)` : '';
    const expected = hits.length ? `- src/lib.js → ${name}: ${hits.slice(0, 8).join(', ')}${more}` : `- src/lib.js → ${name} — không thấy nơi gọi nào ngoài file này`;
    assert.ok(impact.includes(expected), `lệch ở ${name}:\nmong: ${expected}`);
  }
});

test('CP-79-EC2 the context is byte-identical across two runs after the rewrite', () => {
  const files = ['lib/review-context.mjs', 'commands/review.mjs'];
  assert.equal(collectContext(ROOT, { files }).text, collectContext(ROOT, { files }).text);
});

test('CP-79-EC3 past the cap of 8 call sites, the rest is counted exactly', () => {
  // 1 dòng import + 11 dòng gọi = 12 nơi: in 8, đếm 4.
  const use = ["import { hot } from '../src/lib.js';", ...Array.from({ length: 11 }, () => 'hot();')].join('\n') + '\n';
  const root = makeRepo({
    base: { 'src/lib.js': 'export function hot() {}\n', 'use/hot.js': use },
    changes: { 'src/lib.js': 'export function hot() { return 1; }\n' },
  });
  const shown = Array.from({ length: 8 }, (_, i) => `use/hot.js:${i + 1}`).join(', ');
  assert.ok(section(contextOf(root, ['src/lib.js']), 'impact').includes(`- src/lib.js → hot: ${shown} (và 4 nơi khác)`));
});

test('CP-79-EC4 a regex holding /* and a quote does not hide the exports after it', () => {
  // Mỗi dòng regex dưới đây, đọc nhầm, mở một chú thích nuốt tới `*/` kế tiếp
  // hay một chuỗi nuốt tới dấu nháy kế tiếp. Dòng `obj.in / 2 / 3` là phép chia:
  // đọc nó thành regex `/ 2 /` thì vô hại, nhưng mục tiêu là luật chung khớp.
  const lib = [
    "const trim = (s) => s.replace(/\\/*$/, '');",
    'const quote = /["\']/;',
    'const blank = (l) => /^\\s*\\/*/.test(l);',
    'function star(l) { return /\\/*x/.test(l); }',
    'const obj = { in: 6 };',
    'const third = obj.in / 2 / 3;',
    'export function alpha() { return trim(quote.source) + blank(star("")) + third; }',
    'export const beta = 1;',
    '// hết */',
    'export function gamma() {}',
    'export const half = beta / 2;',
    '',
  ].join('\n');
  const root = makeRepo({ base: { 'src/lib.js': 'export const alpha = 0;\n' }, changes: { 'src/lib.js': lib } });
  const impact = section(contextOf(root, ['src/lib.js']), 'impact');
  for (const name of ['alpha', 'beta', 'gamma', 'half']) {
    assert.match(impact, new RegExp(`src/lib\\.js → ${name}\\b`), `mất export ${name}`);
  }
});

test('CP-79-EC5 a stray apostrophe in JSX text does not hide the exports after it', () => {
  // `'` của `Don't` mở một chuỗi giả; không đóng ở cuối dòng thì nó chạy tới
  // `'src/*'`, và `/*` trong đó mở một chú thích nuốt tới hết file.
  const view = [
    "export function Hello() { return <p>Don't panic</p>; }",
    "export const glob = 'src/*';",
    'export function Bye() { return null; }',
    'export const Later = 1;',
    '',
  ].join('\n');
  const root = makeRepo({ base: { 'src/view.jsx': 'export const Hello = 0;\n' }, changes: { 'src/view.jsx': view } });
  const impact = section(contextOf(root, ['src/view.jsx']), 'impact');
  for (const name of ['Hello', 'glob', 'Bye', 'Later']) {
    assert.match(impact, new RegExp(`src/view\\.jsx → ${name}\\b`), `mất export ${name}`);
  }
});

test('CP-79-P1 stripping comments stays linear in the number of slashes', () => {
  // ~1 MB phép chia xen chú thích, đúng dạng lần soi thứ ba đo: bản đọc ngược
  // chuỗi đang nối mất 7 giây, bản này vài trăm ms.
  const lines = Array.from({ length: 25_000 }, (_, i) => `const v${i} = a${i} / b + c / 2; // note`);
  const text = lines.join('\n');
  const { value } = withinBudget({ run: () => stripComments(text), budgetMs: 1500, label: 'stripComments 1 MB' });
  assert.equal(value, lines.map((l) => l.replace('// note', '       ')).join('\n'), 'chỉ chú thích bị xóa trắng');
});
