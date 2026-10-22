import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { conventionCommand, conventionDraftCommand } from '../commands/convention.mjs';
import { parseRules } from '../lib/rule-parser.mjs';
import { makeRepo, put, codeFile, codeFiles, manyFiles, gitAdd } from './helpers/convention-repo.mjs';
import { withinBudget } from './helpers/timing.mjs';

// CP-82 — `compass convention --draft` đọc config và code của repo rồi soạn bản
// nháp `conventions.md`. Bản nháp là đề xuất, không phải quyết định: nó nằm ở
// `.compass/`, người duyệt rồi tự chuyển vào `.knowledge/decided/`.

const DRAFT = path.join('.compass', 'conventions-draft.md');
const DECIDED = path.join('.knowledge', 'decided', 'conventions.md');

const draft = (root, force = false) => conventionDraftCommand({ cwd: root, force });
const readDraft = (root) => readFileSync(path.join(root, DRAFT), 'utf8');

function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `thiếu mục ${heading}`);
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(/\n#{2,3} /);
  return next < 0 ? rest : rest.slice(0, next);
}

const EDITORCONFIG = 'root = true\n\n[*]\nindent_style = space\nindent_size = 2\n';
const PRETTIER = JSON.stringify({ singleQuote: true, semi: false }, null, 2);

test('CP-82-H1 configs and matching code give stated conventions with their sources', () => {
  const root = makeRepo({ '.editorconfig': EDITORCONFIG, '.prettierrc': PRETTIER, ...codeFiles(30) });
  const r = draft(root);
  assert.equal(r.exitCode, 0, r.output);
  const text = readDraft(root);
  assert.match(text, /`indent_size` = `2`/);
  assert.match(text, /`singleQuote`: `true`/);
  assert.match(text, /`semi`: `false`/);
  const counted = section(text, '## Đếm từ code');
  assert.match(counted, /- Thụt lề: 2 dấu cách — 30 \/ 30 file/);
  assert.match(counted, /- Nháy: nháy đơn — 30 \/ 30 file/);
  assert.match(counted, /- Dấu chấm phẩy: không dấu chấm phẩy — 30 \/ 30 file/);
});

test('CP-82-H2 file-name case is stated with its count', () => {
  const files = codeFiles(38);
  files['src/partOne.js'] = codeFile();
  files['src/partTwo.js'] = codeFile();
  const root = makeRepo(files);
  assert.equal(draft(root).exitCode, 0);
  assert.match(section(readDraft(root), '## Đếm từ code'), /- Tên file: kebab-case — 38 \/ 40 file/);
});

test('CP-82-H3 the draft, moved into decided/, passes the convention gate on the same tree', () => {
  const root = makeRepo({ '.editorconfig': EDITORCONFIG, '.prettierrc': PRETTIER, ...codeFiles(30) });
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  const parsed = parseRules(text);
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.rules.length >= 1, 'phải có ít nhất một luật máy chạy được');
  put(root, DECIDED, text);
  const gate = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(gate.exitCode, 0, gate.output);
  assert.match(gate.output, /không vi phạm/);
});

test('CP-82-H4 test files give the naming pattern and the folder', () => {
  const files = codeFiles(20);
  for (let i = 0; i < 20; i += 1) files[`test/unit-${i}.test.mjs`] = codeFile({ name: `t${i}` });
  const root = makeRepo(files);
  assert.equal(draft(root).exitCode, 0);
  const counted = section(readDraft(root), '## Đếm từ code');
  assert.match(counted, /- File test: `\*\.test\.mjs` — 20 \/ 20 file test/);
  assert.match(counted, /- Thư mục test: `test\/` — 20 \/ 20 file test/);
});

test('CP-82-H5 an ESLint rule the code already keeps becomes a warn rule', () => {
  const root = makeRepo({ '.eslintrc.json': JSON.stringify({ rules: { 'no-var': 'error' } }), ...codeFiles(25) });
  assert.equal(draft(root).exitCode, 0);
  const rule = parseRules(readDraft(root)).rules.find((r) => r.id === 'no-var-js');
  assert.ok(rule, 'thiếu luật no-var-js');
  assert.equal(rule.type, 'forbid-pattern');
  assert.equal(rule.severity, 'warn');
  assert.equal(rule.scope, '**/*.js');
  assert.ok(new RegExp(rule.pattern).test('var x = 1'));
  assert.ok(!new RegExp(rule.pattern).test('const variable = 1'));
});

test('CP-82-V1 fewer than 20 files are not enough to state a counted convention', () => {
  const root = makeRepo(codeFiles(10));
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  assert.match(section(text, '### Chưa đủ mẫu'), /Thụt lề: 10 file, cần ít nhất 20/);
  assert.doesNotMatch(text, /- Thụt lề: 2 dấu cách —/);
});

test('CP-82-V2 a 60/40 split is reported as inconsistent, not stated', () => {
  const root = makeRepo({ ...codeFiles(24), ...codeFiles(16, { quote: 'double' }, { prefix: 'other' }) });
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  assert.match(section(text, '### Không nhất quán'), /- Nháy: nháy đơn 24, nháy kép 16 \(trên 40 file\)/);
  assert.doesNotMatch(text, /- Nháy: nháy đơn —/);
});

test('CP-82-V3 an unreadable .prettierrc is named, and the draft is still written', () => {
  const root = makeRepo({ '.prettierrc': 'singleQuote: true\n', ...codeFiles(20) });
  const r = draft(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(section(readDraft(root), '### Không đọc được'), /`\.prettierrc`: không phải JSON/);
});

test('CP-82-V4 a candidate rule the code breaks today is left out, with the count', () => {
  const files = { '.eslintrc.json': JSON.stringify({ rules: { 'no-console': 'warn' } }), ...codeFiles(20) };
  for (let i = 0; i < 3; i += 1) files[`src/log-${i}.js`] = "console.log('x')\n";
  const root = makeRepo(files);
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  assert.ok(!parseRules(text).rules.some((r) => r.id === 'no-console-js'), 'luật đang bị phá không được đề xuất');
  assert.match(section(text, '### Không đề xuất'), /`no-console-js`: 3 chỗ đang phá luật này/);
});

test('CP-82-E1 an existing draft is not overwritten without --force', () => {
  const root = makeRepo(codeFiles(20));
  put(root, DRAFT, 'bản nháp cũ của tôi\n');
  const r = draft(root);
  assert.equal(r.exitCode, 2);
  assert.match(r.output, /--force/);
  assert.equal(readDraft(root), 'bản nháp cũ của tôi\n');
});

test('CP-82-E2 outside a git repo the command refuses and writes nothing', () => {
  const root = makeRepo(codeFiles(20), { git: false });
  const r = draft(root);
  assert.equal(r.exitCode, 2);
  assert.match(r.output, /git/);
  assert.ok(!existsSync(path.join(root, DRAFT)));
});

test('CP-82-E3 a draft path that cannot be written gives exit 1 and leaves no partial file', () => {
  const root = makeRepo(codeFiles(20));
  mkdirSync(path.join(root, DRAFT));
  const r = draft(root, true);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Không ghi được/);
  assert.deepEqual(readdirSync(path.join(root, '.compass')).filter((f) => f.includes('.tmp')), []);
});

test('CP-82-EC1 configs with no code give a draft that says nothing was counted', () => {
  const root = makeRepo({ '.editorconfig': EDITORCONFIG });
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  assert.match(text, /`indent_style` = `space`/);
  assert.match(text, /Không có file code nào để đếm/);
});

test('CP-82-EC2 the same tree gives a byte-identical draft', () => {
  const root = makeRepo({ '.editorconfig': EDITORCONFIG, '.prettierrc': PRETTIER, ...codeFiles(30) });
  assert.equal(draft(root).exitCode, 0);
  const first = readDraft(root);
  assert.equal(draft(root, true).exitCode, 0);
  assert.equal(readDraft(root), first);
});

test('CP-82-EC3 an existing decided/conventions.md is not read and not touched', () => {
  const root = makeRepo(codeFiles(20));
  put(root, DECIDED, '# Của nhóm\n\nZZ-TOKEN-OF-THE-TEAM\n');
  assert.equal(draft(root).exitCode, 0);
  assert.equal(readFileSync(path.join(root, DECIDED), 'utf8'), '# Của nhóm\n\nZZ-TOKEN-OF-THE-TEAM\n');
  const text = readDraft(root);
  assert.ok(!text.includes('ZZ-TOKEN-OF-THE-TEAM'), 'bản nháp không được đọc file đã quyết');
  assert.match(text, /Repo đã có `\.knowledge\/decided\/conventions\.md`/);
});

test('CP-82-EC4 a config that disagrees with the code is flagged for a person', () => {
  const root = makeRepo({ '.editorconfig': 'root = true\n\n[*]\nindent_style = tab\n', ...codeFiles(25) });
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  assert.match(section(text, '## Cần người quyết'), /Thụt lề: `\.editorconfig` khai tab, nhưng code dùng 2 dấu cách \(25 \/ 25 file\)/);
});

test('CP-82-S1 an executable ESLint config is listed and never run', () => {
  const root = makeRepo({
    'eslint.config.js': "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'MARKER'), 'ran')\n",
    'package.json': JSON.stringify({ type: 'commonjs' }),
    ...codeFiles(20),
  });
  assert.equal(draft(root).exitCode, 0);
  assert.ok(!existsSync(path.join(root, 'MARKER')), 'file config đã bị chạy');
  assert.match(readDraft(root), /`eslint\.config\.js`: Compass không chạy hay đoán nội dung file này/);
});

test('CP-82-S2 a symlinked .prettierrc is not followed', (t) => {
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp82-out-'));
  writeFileSync(path.join(outside, 'p.json'), JSON.stringify({ outsideSecret: 'LEAK_82' }));
  const root = makeRepo(codeFiles(20));
  try {
    symlinkSync(path.join(outside, 'p.json'), path.join(root, '.prettierrc'), 'file');
  } catch (err) {
    // Windows chỉ cho tạo symlink file khi có quyền. Junction thì ai cũng tạo được,
    // và cũng là một link: đo bằng nó để case này không xanh mà chẳng kiểm tra gì.
    t.diagnostic(`không tạo được symlink file (${err.code}); đo bằng junction`);
    symlinkSync(outside, path.join(root, '.prettierrc'), 'junction');
  }
  // Ghi link vào index đúng dạng link (mode 120000), như git làm với symlink:
  // bản nháp chỉ đọc config đã theo dõi, và `git add` trên Windows sẽ đi vào junction.
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: path.join(outside, 'p.json'), encoding: 'utf8' }).trim();
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `120000,${blob},.prettierrc`], { cwd: root });
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  assert.ok(!text.includes('LEAK_82'));
  assert.match(section(text, '### Không đọc được'), /`\.prettierrc`: là symlink/);
});

test('CP-82-S3 a config value holding backticks and a fence cannot break the draft', () => {
  const root = makeRepo({
    'package.json': JSON.stringify({ scripts: { lint: 'echo ```\n## Fake heading\n``` `x`' } }),
    ...codeFiles(20),
  });
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  assert.ok(!/^## Fake heading$/m.test(text), 'giá trị config tạo được heading');
  assert.equal(text.match(/^## Đếm từ code$/gm).length, 1);
  const lintLine = text.split('\n').find((l) => l.startsWith('- `lint`'));
  assert.ok(lintLine, 'thiếu dòng script lint');
  assert.match(lintLine, /^- `lint`: (`{4,}) .* \1$/, `giá trị phải nằm trong một code span đủ dài: ${lintLine}`);
});

test('CP-82-V8 files not added to git change nothing in the draft', () => {
  const root = makeRepo({ '.eslintrc.json': JSON.stringify({ rules: { 'no-console': 'warn' } }), ...codeFiles(25) });
  assert.equal(draft(root).exitCode, 0);
  const before = readDraft(root);
  assert.match(before, /id: no-console-js/);
  // Ba kiểu rò: file code đếm vào thống kê, file có `console.log` gạt luật ra khỏi
  // bản nháp, và file config được đọc như config của repo.
  put(root, 'src/scratch-file.js', codeFile({ quote: 'double', semi: true, indent: 4 }));
  put(root, 'src/debug-log.js', "console.log('x')\n");
  put(root, '.prettierrc', JSON.stringify({ singleQuote: false }));
  assert.equal(draft(root, true).exitCode, 0);
  assert.equal(readDraft(root), before, 'file chưa add đã đổi bản nháp');
});

test('CP-82-EC16 CSS inside template literals does not count as semicolons', () => {
  const styled = [
    "import styled from 'styled-components'",
    '',
    'export const Box = styled.div`',
    '  color: red;',
    '  margin: 0 auto;',
    '`',
    '',
    'export function show(x) {',
    '  return x',
    '}',
    '',
  ].join('\n');
  const files = codeFiles(15);
  for (let i = 0; i < 10; i += 1) files[`src/styled-${i}.js`] = styled;
  const root = makeRepo(files);
  assert.equal(draft(root).exitCode, 0);
  assert.match(section(readDraft(root), '## Đếm từ code'), /- Dấu chấm phẩy: không dấu chấm phẩy — 25 \/ 25 file/);
});

test('CP-82-S7 the rule trial does not follow a committed symlink', (t) => {
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp82-out-'));
  writeFileSync(path.join(outside, 'leak.js'), "console.log('outside')\n");
  const root = makeRepo({ '.eslintrc.json': JSON.stringify({ rules: { 'no-console': 'warn' } }), ...codeFiles(20) });
  try {
    symlinkSync(path.join(outside, 'leak.js'), path.join(root, 'src', 'linked.js'), 'file');
  } catch (err) {
    // Junction chỉ trỏ được tới thư mục, mà đọc một thư mục thì cũ hay mới đều
    // hỏng như nhau: không có gì để đo. Case này chỉ đo được nơi tạo được symlink file.
    t.diagnostic(`không tạo được symlink file (${err.code}); case này chỉ đo được ở Linux, macOS hoặc Windows có quyền`);
    return;
  }
  gitAdd(root);
  assert.equal(draft(root).exitCode, 0);
  assert.match(readDraft(root), /id: no-console-js/, 'symlink ra ngoài repo đã gạt luật khỏi bản nháp');
});

test('CP-82-H11 a shared Prettier config named in package.json is listed by name', () => {
  const root = makeRepo({ 'package.json': JSON.stringify({ prettier: '@acme/prettier-config' }), ...codeFiles(20) });
  assert.equal(draft(root).exitCode, 0);
  assert.match(readDraft(root), /`package\.json` → `prettier`: dùng config chung `@acme\/prettier-config`/);
});

test('CP-82-V9 a tracked file deleted from the working tree is not counted', () => {
  const files = codeFiles(25);
  files['src/oldName.js'] = codeFile();
  const root = makeRepo(files);
  rmSync(path.join(root, 'src', 'oldName.js'));
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  assert.match(text, /Đếm trên 25 file code/);
  assert.match(section(text, '## Đếm từ code'), /- Tên file: kebab-case — 25 \/ 25 file/);
});

test('CP-82-S5 a lone carriage return in a config value cannot create a heading', () => {
  const root = makeRepo({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .\r## Lone CR heading' } }), ...codeFiles(20) });
  assert.equal(draft(root).exitCode, 0);
  const text = readDraft(root);
  // Markdown coi `\r` một mình là xuống dòng, nên dòng sau nó mở đầu bằng `## ` là
  // một heading thật, dù đuôi còn dấu backtick đóng của code span.
  assert.ok(!text.split(/\r\n|\r|\n/).some((l) => l.startsWith('## Lone CR heading')), 'giá trị config tạo được heading qua \\r');
});

test('CP-82-S6 a config value quoting the mark opening line does not take over the mark', () => {
  const root = makeRepo({
    'package.json': JSON.stringify({ scripts: { lint: '<!-- compass-convention-mark v1 source /etc/passwd 0123456789abcdef' } }),
    ...codeFiles(25),
  });
  assert.equal(draft(root).exitCode, 0);
  put(root, DECIDED, readDraft(root));
  const r = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
  assert.doesNotMatch(r.output, /hỏng|bỏ qua|có thể đã cũ/, r.output);
});

test('CP-82-P1 a 60 MB repo of 5,000 files is drafted within 20 s', () => {
  // Chạy riêng mất chừng 3,5 giây. 20 giây là chỗ cho `npm test` chạy song song mọi
  // file, nơi cùng bản nháp từng mất 11–14 giây (CP-85); bản chậm gấp sáu vẫn đỏ.
  const big = codeFile({ extra: 500 });
  const root = manyFiles(5000, big);
  assert.ok(big.length * 5000 > 55_000_000, `fixture chỉ ${big.length * 5000} byte`);
  const { value } = withinBudget({ run: () => draft(root, true), budgetMs: 20_000, tries: 2, label: 'draft 5.000 file' });
  assert.equal(value.exitCode, 0, value.output);
});

test('CP-82-P2 one 900 KB file of long lines is counted without a quadratic cost', () => {
  const long = `export const data = [${Array.from({ length: 180 }, (_, i) => `'item-${i}'`).join(', ')}]\n`;
  const root = makeRepo({ 'src/huge-file.js': long.repeat(Math.ceil(900_000 / long.length)), ...codeFiles(19) });
  const { value } = withinBudget({ run: () => draft(root, true), budgetMs: 3000, label: 'draft file 900 KB' });
  assert.equal(value.exitCode, 0, value.output);
});
