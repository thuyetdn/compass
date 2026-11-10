import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reviewCommand } from '../commands/review.mjs';
import { prCommand } from '../commands/pr.mjs';
import { statusCommand } from '../commands/status.mjs';
import { checkCommand } from '../commands/check.mjs';
import { doneCommand } from '../commands/done.mjs';
import { conventionDraftCommand } from '../commands/convention.mjs';
import { knowledgeCommand } from '../commands/knowledge.mjs';
import { collectContext } from '../lib/review-context.mjs';
import { buildDraft } from '../lib/convention-draft.mjs';
import { declaredNames, countNames, countLine, pendingLines, pendingLine, readDeclaredRepos, repoLayout, repoOf } from '../lib/repo-conventions.mjs';
import { coverageFor, writeReview } from './helpers/review.mjs';
import { measureGrowth, assertLinear } from './helpers/growth.mjs';

// CP-98 — issue #4. Gate `review` và `compass pr` coi "có conventions.md" là "repo
// đã khai convention", dù file đó không nói gì về repo đang soi. Các test dựng
// workspace thật trong thư mục tạm, và so với code ở gốc soi khi spec đòi "không đổi
// byte nào".

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Tag của bản phát hành ngay trước CP-98, không phải SHA: CP-71-V1 cấm ghim commit thật.
const BASE_REF = 'v3.2.1';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function put(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

function initGit(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

const migration = (name, { safe = true } = {}) => [
  '<?php',
  '',
  'use yii\\db\\Migration;',
  '',
  `class ${name} extends Migration`,
  '{',
  `    public function ${safe ? 'safeUp' : 'up'}()`,
  '    {',
  `        $this->createTable('${name}', ['id' => $this->primaryKey()]);`,
  '    }',
  '',
  `    public function ${safe ? 'safeDown' : 'down'}()`,
  '    {',
  `        $this->dropTable('${name}');`,
  '    }',
  '}',
  '',
].join('\n');

const ROOT_RULES = [
  '# Quy ước của workspace',
  '',
  'Script trong `.compass/scripts` mở đầu bằng một dòng nói nó làm gì.',
  '',
  '```rule',
  'id: scripts-no-console-error',
  'type: forbid-pattern',
  'pattern: "console\\.error"',
  'scope: .compass/scripts/**',
  'severity: warn',
  '```',
  '',
].join('\n');

const SPEC = ({ scope, head = '' }) => `# T-1: thêm migration
Loại: fix
Phạm vi: ${scope}
${head}
## Mục tiêu
Thêm một migration.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

const pad = (i) => String(i).padStart(4, '0');

// Workspace như issue #4: gốc có git riêng (bỏ qua `be/`), repo con `be` có git riêng
// chứa thư mục migration. Task thêm `migrations/m9999.php` viết bằng `up()`.
function beWorkspace({ safe = 20, up = 1, rootConv = ROOT_RULES, ownBe = null, repos = { be: { test: 'true' } }, extraRoot = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp98-'));
  initGit(root);
  put(root, '.gitignore', '/be/\n');
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos }));
  if (rootConv !== null) put(root, '.knowledge/decided/conventions.md', rootConv);
  for (const [rel, body] of Object.entries(extraRoot)) put(root, rel, body);
  const rootBase = commit(root, 'workspace');

  const be = path.join(root, 'be');
  initGit(be);
  for (let i = 1; i <= safe; i += 1) put(be, `migrations/m${pad(i)}.php`, migration(`m${pad(i)}`));
  for (let i = 0; i < up; i += 1) put(be, `migrations/u${pad(i)}.php`, migration(`u${pad(i)}`, { safe: false }));
  const beBase = commit(be, 'base');
  put(be, 'migrations/m9999.php', migration('m9999', { safe: false }));
  commit(be, 'task: add m9999');

  if (ownBe !== null) put(root, '.knowledge/decided/conventions/be.md', ownBe);
  // Gốc soi của gốc là commit vừa tạo: không khai thì git một commit được soi từ cây
  // rỗng, và `.gitignore` cùng `conventions.md` của gốc thành file của task.
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/', head: `Gốc soi: ${rootBase}\nGốc soi (be): ${beBase}\n` }));
  return { root, be, rootBase, beBase };
}

function briefOf(root) {
  const r = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  return readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
}

// Mục `### convention` của brief hay của ngữ cảnh, tới mục `### impact`.
function conventionPart(text) {
  const start = text.indexOf('### convention');
  const end = text.indexOf('### impact');
  assert.ok(start >= 0 && end > start, 'không thấy mục convention');
  return text.slice(start, end);
}

const samplesIn = (part) => [...part.matchAll(/^#### Mẫu: (.+)$/gm)].map((m) => m[1].replace(/ \(.*\)$/, ''));

// Repo một git ở gốc: `files` là danh sách lô, mỗi lô một commit theo thứ tự.
function singleRepo(batches = [], { conv = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp98-one-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
  if (conv !== null) put(root, '.knowledge/decided/conventions.md', conv);
  commit(root, 'init');
  batches.forEach((files, i) => {
    for (const [rel, body] of Object.entries(files)) put(root, rel, body);
    commit(root, `step ${i + 1}`);
  });
  return root;
}

// Code của Compass ở gốc soi, dựng lại trong thư mục tạm, để so "không đổi byte nào"
// với chính code cũ chứ không với một ảnh chụp chép tay.
let oldTree = null;
function oldCompass() {
  if (oldTree) return oldTree;
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-cp98-old-'));
  const names = git(ROOT, ['ls-tree', '-r', '--name-only', BASE_REF, '--', 'lib', 'commands', 'package.json']).split('\n').filter(Boolean);
  for (const name of names) {
    const body = execFileSync('git', ['show', `${BASE_REF}:${name}`], { cwd: ROOT, maxBuffer: 50_000_000 });
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
  oldTree = dir;
  return dir;
}
const oldModule = (rel) => import(pathToFileURL(path.join(oldCompass(), rel)).href);

const PENDING_BE = /Repo `be` chưa có convention đã duyệt/;

// ---------------------------------------------------------------- Happy

test('CP-98-H1 a repo without its own conventions gets an inferred block, not the root rules', () => {
  const { root } = beWorkspace();
  const part = conventionPart(briefOf(root));
  assert.match(part, /#### Repo `be`/);
  assert.match(part, /`\.knowledge\/decided\/conventions\/be\.md`/);
  assert.match(part, /chưa có convention đã duyệt/);
  assert.match(part, /- `be\/migrations` \(`\*\.php`\): /);
  assert.ok(samplesIn(part).length >= 1, part);
  for (const s of samplesIn(part)) assert.match(s, /^be\/migrations\/[^/]+\.php$/);
  assert.doesNotMatch(part, /scripts-no-console-error/, 'luật của gốc bị đưa ra như luật của be');
  assert.doesNotMatch(part, /Xét theo đúng các luật dưới đây/);
});

test('CP-98-H2 the per-directory count excludes the task file: 20 of 21 siblings declare safeUp', () => {
  const { root } = beWorkspace({ safe: 20, up: 1 });
  const part = conventionPart(briefOf(root));
  assert.match(part, /`safeUp` 20\/21 file/);
  assert.match(part, /`safeDown` 20\/21 file/);
  assert.doesNotMatch(part, /`up` \d+\/\d+/);
});

test('CP-98-H3 a repo with its own matching conventions shows them as declared, with no count or sample', () => {
  const own = [
    '# Quy ước của be',
    '',
    'Migration dùng safeUp/safeDown.',
    '',
    '```rule',
    'id: migration-safe-up',
    'type: forbid-pattern',
    'pattern: "function up\\("',
    'scope: migrations/**',
    'severity: error',
    '```',
    '',
  ].join('\n');
  const { root } = beWorkspace({ ownBe: own });
  const part = conventionPart(briefOf(root));
  assert.match(part, /#### Repo `be`/);
  assert.match(part, /đã khai convention ở `\.knowledge\/decided\/conventions\/be\.md`/);
  assert.ok(part.includes(own.trimEnd()), 'thiếu nguyên văn be.md');
  assert.match(part, /"basis": "declared"/);
  assert.doesNotMatch(part, /\d+\/\d+ file/);
  assert.deepEqual(samplesIn(part), []);
});

test('CP-98-H4 samples are the two newest siblings by commit, not the first two by name', () => {
  const file = (n) => `<?php\nfunction ${n}() {}\n`;
  const root = singleRepo([
    { 'src/a.php': file('a') },
    { 'src/b.php': file('b') },
    { 'src/c.php': file('c') },
    { 'src/d.php': file('d') },
    { 'src/e.php': file('e') },
    { 'src/b.php': `${file('b')}// changed\n` },
  ]);
  put(root, 'src/z.php', file('z'));
  const part = conventionPart(collectContext(root, { files: ['src/z.php'] }).text);
  assert.deepEqual(samplesIn(part).sort(), ['src/b.php', 'src/e.php']);
});

test('CP-98-H5 compass pr inside the sub-repo: newest samples, root conventions, pending line in output and report', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp98-pr-'));
  initGit(root);
  put(root, '.gitignore', '/be/\n');
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { be: { test: 'true' } } }));
  put(root, '.knowledge/decided/conventions.md', ROOT_RULES);
  commit(root, 'workspace');
  const be = path.join(root, 'be');
  initGit(be);
  for (let i = 1; i <= 20; i += 1) put(be, `migrations/m${pad(i)}.php`, migration(`m${pad(i)}`));
  commit(be, 'bulk');
  put(be, 'migrations/m0021.php', migration('m0021'));
  commit(be, 'm0021');
  put(be, 'migrations/m0022.php', migration('m0022'));
  commit(be, 'm0022');
  git(be, ['checkout', '-q', '-b', 'feature']);
  put(be, 'migrations/m9999.php', migration('m9999', { safe: false }));
  commit(be, 'feat: m9999');
  git(be, ['checkout', '-q', 'main']);
  // Bản checkout của người soi đi tiếp sau điểm rẽ: m0001 mới sửa. Mẫu phải theo lịch
  // sử của đầu PR (worktree), không theo nhánh người soi đang đứng.
  put(be, 'migrations/m0001.php', `${migration('m0001')}// sửa trên main\n`);
  commit(be, 'main: sửa m0001');

  const first = prCommand({ cwd: be, ref: 'feature', base: 'main' });
  assert.equal(first.exitCode, 1, first.output);
  const dir = path.join(be, '.git', 'compass', 'pr', 'feature');
  const brief = readFileSync(path.join(dir, 'review-brief.md'), 'utf8');
  const part = conventionPart(brief);
  assert.deepEqual(samplesIn(part).sort(), ['migrations/m0021.php', 'migrations/m0022.php']);
  assert.match(part, /#### Repo `be`/);
  assert.match(part, /`\.knowledge\/decided\/conventions\/be\.md`/);
  assert.match(part, /`safeUp` 22\/22 file/);

  const id = brief.match(/"brief":\s*"([^"]+)"/)[1];
  writeFileSync(path.join(dir, 'findings.json'), JSON.stringify({ brief: id, coverage: coverageFor(), findings: [] }));
  const second = prCommand({ cwd: be, ref: 'feature', base: 'main' });
  assert.equal(second.exitCode, 0, second.output);
  assert.match(second.output, PENDING_BE);
  assert.match(readFileSync(path.join(dir, 'report.md'), 'utf8'), PENDING_BE);

  // Có convention riêng ở gốc thì pr đọc nó, không đọc worktree của PR.
  put(root, '.knowledge/decided/conventions/be.md', '# be\n\nMigration dùng safeUp.\n');
  const third = prCommand({ cwd: be, ref: 'feature', base: 'main' });
  assert.equal(third.exitCode, 1, third.output);
  const again = conventionPart(readFileSync(path.join(dir, 'review-brief.md'), 'utf8'));
  assert.match(again, /Migration dùng safeUp\./);
});

test('CP-98-H6 convention --draft --repo=be writes the repo draft with the per-directory section', () => {
  const { root } = beWorkspace();
  const r = conventionDraftCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 0, r.output);
  const file = path.join(root, '.compass', 'conventions-draft', 'be.md');
  const text = readFileSync(file, 'utf8');
  assert.match(text, /^## Theo thư mục$/m);
  assert.match(text, /`migrations` \(`\*\.php`\): .*`safeUp` 20\/22 file/);
  assert.match(text, /`\.knowledge\/decided\/conventions\/be\.md`/);
  assert.equal(existsSync(path.join(root, '.knowledge', 'decided', 'conventions')), false, 'Compass ghi vào decided/');
  assert.equal(existsSync(path.join(root, '.compass', 'conventions-draft.md')), false);

  // Config thiếu `test` ở phần chung, và một repo khác chưa clone: `loadConfig` và
  // `resolveRepos` đều thất bại. Bản nháp vẫn phải là của be, không phải của cả gốc.
  put(root, '.compass/config.json', JSON.stringify({ repos: { be: {}, chua: { path: 'chua-clone' } } }));
  const again = conventionDraftCommand({ cwd: root, repo: 'be', force: true });
  assert.equal(again.exitCode, 0, again.output);
  assert.match(readFileSync(file, 'utf8'), /`safeUp` 20\/22 file/);

  // Repo khai mà thư mục chưa có: từ chối, không soạn gì dưới tên đó.
  const missing = conventionDraftCommand({ cwd: root, repo: 'chua' });
  assert.equal(missing.exitCode, 2, missing.output);
  assert.equal(existsSync(path.join(root, '.compass', 'conventions-draft', 'chua.md')), false);
});

test('CP-98-H7 status names the repo without its own conventions and leaves the other alone', () => {
  const { root } = beWorkspace({ repos: { be: { test: 'true' }, fe: { test: 'true' } } });
  mkdirSync(path.join(root, 'fe'), { recursive: true });
  put(root, '.knowledge/decided/conventions/fe.md', '# fe\n');
  const r = statusCommand({ cwd: root });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, PENDING_BE);
  assert.doesNotMatch(r.output, /Repo `fe` chưa có convention/);
  assert.doesNotMatch(r.output, /Gốc chưa có convention/, 'gốc có conventions.md mà vẫn bị nhắc');

  // Dự án một repo chưa có conventions.md: gốc là đơn vị duy nhất, và nó được nhắc.
  const one = singleRepo([{ 'src/a.js': 'export const a = 1;\n' }]);
  const single = statusCommand({ cwd: one });
  assert.equal(single.exitCode, 0, single.output);
  assert.match(single.output, /⚠ Gốc chưa có convention đã duyệt \(`\.knowledge\/decided\/conventions\.md`\)/);
  assert.match(single.output, /sai ở đây thì gate `test` đỏ mà không rõ vì sao\.$/);
});

// CP-103 (issue #6) đổi tiền đề của case này: repo con thiếu convention riêng giờ dừng ở
// gate `convention`, nên không còn tới được `done` xanh. Gốc thì không bao giờ bị chặn, nên
// dòng nhắc trên `done` xanh bây giờ là của gốc. Dòng của `be` vẫn hiện khi file của nó bị
// xóa sau lần gate xanh: `sourceHash` không phủ `.knowledge/`.
test('CP-98-H8 done closes a green task and prints the pending line for the root', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp98-done-'));
  initGit(root);
  const out = (ids) => ids.map((id, i) => `console.log('ok ${i + 1} - T-1-${id} x')`).join('; ');
  put(root, '.compass/config.json', JSON.stringify({ test: `node -e "${out(['H1', 'H2'])}"`, repos: { be: {} } }));
  put(root, '.knowledge/decided/conventions/be.md', '# Quy ước của be\n\nTên nói rõ nghĩa.\n');
  put(root, 'be/a.js', 'export const a = 1;\n');
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/, tools/x.js' }));
  commit(root, 'task');
  assert.equal(knowledgeCommand({ cwd: root, sync: true }).exitCode, 0);
  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(c.exitCode, 0, c.output);
  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /⚠ Gốc chưa có convention đã duyệt/);
  assert.doesNotMatch(r.output, PENDING_BE, 'be có convention riêng mà vẫn bị nhắc');

  // File của `be` bị xóa sau lần gate xanh, rồi spec đổi nên done đỏ: dòng nhắc của cả
  // gốc lẫn `be` vẫn phải có trên nhánh đỏ.
  rmSync(path.join(root, '.knowledge', 'decided', 'conventions', 'be.md'));
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/, tools/' }));
  const red = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(red.exitCode, 0, red.output);
  assert.match(red.output, /⚠ Gốc chưa có convention đã duyệt/);
  assert.match(red.output, PENDING_BE);
});

// ---------------------------------------------------------------- Validation

test('CP-98-V1 --repo must be a key in repos, on both entry points', () => {
  const { root } = beWorkspace();
  const r = conventionDraftCommand({ cwd: root, repo: 'nope' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /nope/);
  assert.match(r.output, /be/);
  assert.equal(existsSync(path.join(root, '.compass', 'conventions-draft')), false);

  const cli = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), 'convention', '--draft', '--repo=nope'], { cwd: root, encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stdout + cli.stderr);
  assert.equal(existsSync(path.join(root, '.compass', 'conventions-draft')), false);
  const ok = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), 'convention', '--draft', '--repo=be'], { cwd: root, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(existsSync(path.join(root, '.compass', 'conventions-draft', 'be.md')));
});

test('CP-98-V2 --repo needs repos in config', () => {
  const root = singleRepo([{ 'src/a.js': 'export const a = 1;\n' }]);
  const r = conventionDraftCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /repos/);
  assert.equal(existsSync(path.join(root, '.compass', 'conventions-draft')), false);
});

test('CP-98-V3 basis declared is accepted only when a declared file is shown for a touched unit', () => {
  // Gốc có conventions.md, nhưng task chỉ đụng be: luật của gốc không được cho phép `declared`.
  const { root } = beWorkspace();
  briefOf(root);
  const finding = (basis) => ({
    severity: 'Minor', criterion: 'convention', basis, title: 'Dùng up()', detail: 'repo dùng safeUp', file: 'be/migrations/m9999.php', line: 7,
  });
  const coverage = coverageFor({ convention: { verdict: 'findings' } });
  writeReview(root, 'T-1', { coverage, findings: [finding('declared')] });
  const rejected = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(rejected.exitCode, 2, rejected.output);
  assert.match(rejected.output, /basis/);
  writeReview(root, 'T-1', { coverage, findings: [finding('inferred')] });
  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  put(root, '.knowledge/decided/conventions/be.md', '# be\n\nMigration dùng safeUp.\n');
  briefOf(root);
  writeReview(root, 'T-1', { coverage, findings: [finding('declared')] });
  const accepted = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(accepted.exitCode, 0, accepted.output);
});

// ---------------------------------------------------------------- Error

test('CP-98-E1 no history: samples fall back to name order', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp98-nohist-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
  for (const n of ['c', 'a', 'b']) put(root, `src/${n}.php`, `<?php\nfunction ${n}() {}\n`);
  git(root, ['add', '-A']);
  put(root, 'src/z.php', '<?php\nfunction z() {}\n');
  const part = conventionPart(collectContext(root, { files: ['src/z.php'] }).text);
  assert.deepEqual(samplesIn(part), ['src/a.php', 'src/b.php']);

  // Không quá 2 ứng viên thì lấy cả hai theo thứ tự tên, không hỏi git: b mới hơn a mà
  // vẫn đứng sau. Hỏi git cho thư mục như vậy là tốn một lượt duyệt lịch sử vô ích.
  const two = singleRepo([{ 'lib/a.php': '<?php\nfunction a() {}\n' }, { 'lib/b.php': '<?php\nfunction b() {}\n' }]);
  put(two, 'lib/z.php', '<?php\nfunction z() {}\n');
  assert.deepEqual(samplesIn(conventionPart(collectContext(two, { files: ['lib/z.php'] }).text)), ['lib/a.php', 'lib/b.php']);
});

test('CP-98-E2 an own conventions path that is a directory counts as missing', () => {
  const { root } = beWorkspace();
  mkdirSync(path.join(root, '.knowledge', 'decided', 'conventions', 'be.md'), { recursive: true });
  const part = conventionPart(briefOf(root));
  assert.match(part, /chưa có convention đã duyệt/);
  assert.match(part, /`safeUp` 20\/21 file/);
  assert.match(statusCommand({ cwd: root }).output, PENDING_BE);
  assert.ok(pendingLines(root, ['be']).some((l) => PENDING_BE.test(l)));
});

test('CP-98-E3 done with a config that is not JSON behaves exactly as before', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp98-badcfg-'));
  initGit(root);
  put(root, '.compass/config.json', '{ "test": "true", "repos": { "be": {} ');
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/' }));
  mkdirSync(path.join(root, 'be'));
  commit(root, 'task');
  const now = doneCommand({ cwd: root, taskId: 'T-1' });
  const { doneCommand: oldDone } = await oldModule('commands/done.mjs');
  const before = oldDone({ cwd: root, taskId: 'T-1' });
  assert.equal(now.exitCode, before.exitCode);
  // Khác duy nhất: từ CP-103 `fix` cũng đòi gate `convention`, nên có thêm một dòng "chưa chạy".
  assert.equal(now.output, before.output.replace('  Gate "test" chưa chạy.\n', '  Gate "test" chưa chạy.\n  Gate "convention" chưa chạy.\n'));
  assert.doesNotMatch(now.output, /chưa có convention đã duyệt/);
});

// ---------------------------------------------------------------- Edge

test('CP-98-EC1 single-repo briefs with prose or matching rules keep every byte', async () => {
  const { collectContext: oldCollect } = await oldModule('lib/review-context.mjs');
  const files = {
    'src/filter.js': 'export function filter(list) {\n  return list;\n}\n',
    'src/util.js': 'export function slugify(text) {\n  return text.toLowerCase();\n}\n',
  };
  const prose = '# Quy ước\n\nTên hàm nói rõ nghĩa.\n';
  const ruled = '# Quy ước\n\n```rule\nid: no-var\ntype: forbid-pattern\npattern: "\\\\bvar "\nscope: src/**/*.js\nseverity: error\n```\n';
  for (const conv of [prose, ruled]) {
    const root = singleRepo([files], { conv });
    put(root, 'src/filter.js', 'export function filter(list, c) {\n  return list.filter((x) => x.c === c);\n}\n');
    const now = conventionPart(collectContext(root, { files: ['src/filter.js'] }).text);
    const before = conventionPart(oldCollect(root, { files: ['src/filter.js'] }).text);
    assert.equal(now, before);
    assert.ok(now.includes(conv.trimEnd()));
  }
});

test('CP-98-EC2 declared rules that match no changed file still bring samples for that folder', () => {
  const conv = '# Quy ước\n\n```rule\nid: no-exit\ntype: forbid-pattern\npattern: "process\\\\.exit"\nscope: lib/**/*.mjs\nseverity: error\n```\n';
  const root = singleRepo([{
    'commands/a.mjs': 'export function a() {}\n',
    'commands/b.mjs': 'export function b() {}\n',
  }], { conv });
  put(root, 'commands/x.mjs', 'export function x() {}\n');
  const part = conventionPart(collectContext(root, { files: ['commands/x.mjs'] }).text);
  assert.ok(part.includes(conv.trimEnd()), 'thiếu luật đã khai');
  assert.deepEqual(samplesIn(part).sort(), ['commands/a.mjs', 'commands/b.mjs']);
  assert.ok(part.indexOf('id: no-exit') < part.indexOf('#### Mẫu:'), 'mẫu phải đứng sau luật');
  assert.doesNotMatch(part, /\d+ file, chưa đủ mẫu|\d+\/\d+ file/);
});

test('CP-98-EC3 a folder with 7 siblings is not enough to state a name', () => {
  const { root } = beWorkspace({ safe: 7, up: 0 });
  const part = conventionPart(briefOf(root));
  assert.match(part, /- `be\/migrations` \(`\*\.php`\): 7 file, chưa đủ mẫu/);
  assert.doesNotMatch(part, /`safeUp` 7\/7/);
});

test('CP-98-EC4 root files and repo files in one task get one block each', () => {
  // Gốc đụng ba thư mục có file cùng loại: khối của gốc dùng hết 4 mẫu của nó và nói
  // đã cắt thư mục thứ ba, còn khối be vẫn có mẫu riêng.
  const tools = {};
  for (const d of ['a', 'b', 'c']) for (const n of ['x1', 'x2']) tools[`tools/${d}/${n}.mjs`] = `export function ${n}() {}\n`;
  const { root, rootBase, beBase } = beWorkspace({ extraRoot: tools });
  put(root, '.compass/scripts/a.mjs', '// in danh sách migration\nconsole.log(1);\n');
  for (const d of ['a', 'b', 'c']) put(root, `tools/${d}/n.mjs`, 'export function n() {}\n');
  commit(root, 'script');
  put(root, '.compass/T-1/spec.md', SPEC({
    scope: 'be/, .compass/scripts/a.mjs, tools/',
    head: `Gốc soi: ${rootBase}\nGốc soi (be): ${beBase}\n`,
  }));
  const part = conventionPart(briefOf(root));
  const rootAt = part.indexOf('#### Gốc');
  const beAt = part.indexOf('#### Repo `be`');
  assert.ok(rootAt >= 0 && beAt >= 0, part);
  const rootBlock = rootAt < beAt ? part.slice(rootAt, beAt) : part.slice(rootAt);
  const beBlock = beAt < rootAt ? part.slice(beAt, rootAt) : part.slice(beAt);
  assert.match(rootBlock, /scripts-no-console-error/);
  assert.match(rootBlock, /"basis": "declared"/);
  assert.equal(samplesIn(rootBlock).length, 4);
  assert.match(rootBlock, /Bỏ bớt mẫu của 1 thư mục khác/);
  assert.match(beBlock, /chưa có convention đã duyệt/);
  assert.doesNotMatch(beBlock, /scripts-no-console-error/);
  assert.equal(samplesIn(beBlock).length, 2, beBlock);
  assert.doesNotMatch(beBlock, /Không tìm thấy file cùng thư mục/);
});

test('CP-98-EC5 a repo key with a slash maps to nested paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp98-slash-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { 'store/backend': { test: 'true' } } }));
  put(root, 'store/backend/a.php', '<?php\nfunction a() {}\n');
  commit(root, 'init');
  put(root, 'store/backend/x.php', '<?php\nfunction x() {}\n');
  put(root, '.knowledge/decided/conventions/store/backend.md', '# backend\n\nHàm đặt tên ngắn.\n');
  const part = conventionPart(collectContext(root, { files: ['store/backend/x.php'] }).text);
  assert.match(part, /#### Repo `store\/backend`/);
  assert.match(part, /`\.knowledge\/decided\/conventions\/store\/backend\.md`/);
  assert.match(part, /Hàm đặt tên ngắn\./);

  const r = conventionDraftCommand({ cwd: root, repo: 'store/backend' });
  assert.equal(r.exitCode, 0, r.output);
  assert.ok(existsSync(path.join(root, '.compass', 'conventions-draft', 'store', 'backend.md')));
});

test('CP-98-EC6 a name counts once per file, and not from a line comment', () => {
  assert.deepEqual(declaredNames('    public function safeUp()\n    {}\n    public function safeUp()\n'), ['safeUp']);
  assert.deepEqual(declaredNames('// function safeUp() {}\n# def x():\n'), []);
  assert.deepEqual(declaredNames('export async function load() {}\ndef run(a):\nfunc (s *S) Serve(w) {}\n'), ['Serve', 'load', 'run']);
  const texts = { 'd/a.php': 'public function safeUp()\npublic function safeUp()\n', 'd/b.php': '// function safeUp()\n' };
  const got = countNames({ files: Object.keys(texts), read: (rel) => texts[rel], minFiles: 1 });
  assert.equal(got.total, 2);
  assert.deepEqual(got.counts.get('safeUp'), 1);
});

test('CP-98-EC7 plain --draft on a multi-repo workspace keeps every byte', async () => {
  const { root } = beWorkspace();
  const { buildDraft: oldBuild } = await oldModule('lib/convention-draft.mjs');
  const now = buildDraft(root);
  const before = oldBuild(root);
  assert.equal(now.ok, true);
  assert.equal(now.text, before.text);
});

// ---------------------------------------------------------------- Security

test('CP-98-S1 .env files are never sampled or quoted, even when newest', () => {
  const root = singleRepo([
    { 'src/a.php': '<?php\nfunction a() {}\n', 'src/b.php': '<?php\nfunction b() {}\n' },
    { 'src/.env': 'DB_PASSWORD=SECRET_VALUE_XYZ\n', 'src/.env.local': 'TOKEN=SECRET_VALUE_XYZ\n' },
  ]);
  put(root, 'src/z.php', '<?php\nfunction z() {}\n');
  const text = collectContext(root, { files: ['src/z.php'] }).text;
  assert.ok(!text.includes('SECRET_VALUE_XYZ'), 'nội dung .env lọt vào ngữ cảnh');
  assert.deepEqual(samplesIn(conventionPart(text)).sort(), ['src/a.php', 'src/b.php']);
});

test('CP-98-S2 an own conventions file that is a symlink is not followed', (t) => {
  // Junction ở thư mục `conventions`: Windows tạo được không cần quyền admin, nên phần
  // này đo được trên mọi máy.
  const viaDir = beWorkspace().root;
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'compass-cp98-outdir-'));
  put(outsideDir, 'be.md', 'OUTSIDE_SECRET_98\n');
  mkdirSync(path.join(viaDir, '.knowledge', 'decided'), { recursive: true });
  symlinkSync(outsideDir, path.join(viaDir, '.knowledge', 'decided', 'conventions'), 'junction');
  // Chỉ đo mục convention: git trên Windows coi junction là thư mục, nên file trong đó
  // là file chưa theo dõi của git gốc và đi vào diff — chuyện của diff, có từ trước CP-98.
  const viaPart = conventionPart(briefOf(viaDir));
  assert.ok(!viaPart.includes('OUTSIDE_SECRET_98'), 'convention ngoài repo được đọc qua junction');
  assert.match(viaPart, /chưa có convention đã duyệt/);

  const { root } = beWorkspace();
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp98-out-'));
  put(outside, 'x.md', 'OUTSIDE_SECRET_98\n');
  mkdirSync(path.join(root, '.knowledge', 'decided', 'conventions'), { recursive: true });
  try {
    symlinkSync(path.join(outside, 'x.md'), path.join(root, '.knowledge', 'decided', 'conventions', 'be.md'), 'file');
  } catch (err) {
    t.diagnostic(`không tạo được symlink trên máy này (${err.code}); phần này chỉ đo được ở Linux, macOS hoặc Windows có quyền`);
    return;
  }
  const brief = briefOf(root);
  assert.ok(!brief.includes('OUTSIDE_SECRET_98'));
  assert.match(conventionPart(brief), /chưa có convention đã duyệt/);
});

test('CP-98-S3 a repo name that escapes the draft folder is refused before any write', () => {
  // Tên độc nằm ngay trong `repos`: kiểm tra "có trong config" không chặn được chúng,
  // chỉ luật tên chặn được.
  const bad = ['../x', 'be/../..', 'C:x', '/abs', 'be\\..\\x'];
  const { root } = beWorkspace({ repos: { be: { test: 'true' }, ...Object.fromEntries(bad.map((k) => [k, { test: 'true' }])) } });
  for (const repo of bad) {
    const r = conventionDraftCommand({ cwd: root, repo });
    assert.equal(r.exitCode, 2, `${repo}: ${r.output}`);
  }
  // Tên repo đi vào dòng nhắc, và dòng nhắc đi lên PR trong `report.md`: cả tên lẫn lệnh
  // nằm trong code span, không còn chữ `<img` nào đứng trần.
  const line = pendingLine('<img src=x>');
  assert.equal(line.replace(/(`+) ?[^`]*? ?\1/g, '').includes('<img'), false, line);
  assert.equal(existsSync(path.join(root, '.compass', 'conventions-draft')), false);
  assert.equal(existsSync(path.join(root, '.compass', 'x.md')), false);
  assert.equal(existsSync(path.join(root, 'x.md')), false);
});

test('CP-98-S4 sibling names that look like git options are passed as paths', () => {
  const root = singleRepo([
    { 'src/a.php': '<?php\nfunction a() {}\n' },
    { 'src/-n.php': '<?php\nfunction n() {}\n', 'src/--output=o.php': '<?php\nfunction o() {}\n' },
  ]);
  put(root, 'src/z.php', '<?php\nfunction z() {}\n');
  const part = conventionPart(collectContext(root, { files: ['src/z.php'] }).text);
  assert.deepEqual(samplesIn(part).sort(), ['src/--output=o.php', 'src/-n.php']);
  assert.equal(existsSync(path.join(root, 'o.php')), false);
  assert.equal(existsSync(path.join(root, 'src', 'o.php')), false);

  // Thư mục mới đi vào lệnh git. Tên của nó mà thành cờ `--max-count=0` thì git log
  // không trả gì, và mẫu rơi về thứ tự tên (a, b) thay vì mới nhất (b, c).
  const odd = singleRepo([
    { '--max-count=0/a.php': '<?php\nfunction a() {}\n' },
    { '--max-count=0/b.php': '<?php\nfunction b() {}\n' },
    { '--max-count=0/c.php': '<?php\nfunction c() {}\n' },
  ]);
  put(odd, '--max-count=0/z.php', '<?php\nfunction z() {}\n');
  const oddPart = conventionPart(collectContext(odd, { files: ['--max-count=0/z.php'] }).text);
  assert.deepEqual(samplesIn(oddPart).sort(), ['--max-count=0/b.php', '--max-count=0/c.php']);
});

// ---------------------------------------------------------------- Performance

test('CP-98-P1 the per-directory count grows linearly with the number of siblings', () => {
  const body = Array.from({ length: 300 }, (_, i) => `    public function step${i % 7}() { return ${i}; }`).join('\n');
  const all = Array.from({ length: 1000 }, (_, i) => `d/f${pad(i)}.php`);
  const result = measureGrowth({
    run: (n) => countNames({ files: all.slice(0, n), read: () => body }),
    small: 250,
    large: 1000,
    pairs: 5,
    warmup: 1,
  });
  assertLinear(result, 6);
});

test('CP-98-P2 a folder of 3,000 siblings reads at most 1,000 and says it sampled', () => {
  let reads = 0;
  const files = Array.from({ length: 3000 }, (_, i) => `d/f${pad(i)}.php`);
  const got = countNames({ files, read: () => { reads += 1; return 'public function safeUp()\n'; } });
  assert.ok(reads <= 1000, `đọc ${reads} file`);
  assert.equal(got.sampled, true);
  assert.equal(got.total, 1000);
  const line = countLine('d', '.php', got);
  assert.match(line, /`safeUp` 1000\/1000 file/);
  assert.match(line, /lấy đều.*3000/);
});

// ---------------------------------------------------------------- CP-99
// Bốn điểm lượt soi thứ ba của CP-98 để lại: dòng ví dụ trong tài liệu, ba bản sao của
// việc đọc `repos` thô, một bộ lọc chết, và tên file có xuống dòng.

test('CP-99-H1 the docs show the pending line exactly as Compass prints it', () => {
  const skill = readFileSync(path.join(ROOT, 'skills', 'compass', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const agents = readFileSync(path.join(ROOT, 'templates', 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
  const line = pendingLine('be');
  const fenced = [...skill.matchAll(/^```text\n([\s\S]*?)\n```$/gm)].map((m) => m[1].split('\n'));
  assert.ok(fenced.some((lines) => lines.includes(line)), `SKILL.md thiếu dòng:\n${line}`);
  for (const [name, text] of [['SKILL.md', skill], ['AGENTS.md', agents]]) {
    assert.doesNotMatch(text, /`⚠ Repo `/, `${name} còn code span lồng nhau`);
  }
});

test('CP-99-H2 one raw reader serves the draft, the layout and the --repo check', () => {
  const { root } = beWorkspace();
  const got = readDeclaredRepos(root);
  assert.equal(got.ok, true);
  assert.deepEqual(Object.keys(got.repos), ['be']);
  assert.equal(repoOf('be/x.php', repoLayout(root).repos)?.key, 'be');
  assert.equal(conventionDraftCommand({ cwd: root, repo: 'be' }).exitCode, 0);
});

test('CP-99-V1 repos written as an array counts as no repos everywhere', () => {
  const { root } = beWorkspace();
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: ['be'] }));
  const got = readDeclaredRepos(root);
  assert.equal(got.ok, true);
  assert.equal(got.repos, null);
  const r = conventionDraftCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /repos/);
  assert.deepEqual(repoLayout(root).repos, []);
});

test('CP-99-E1 a config that is not JSON is named without quoting the parser', () => {
  const { root } = beWorkspace();
  put(root, '.compass/config.json', '{ "repos": ');
  assert.equal(readDeclaredRepos(root).ok, false);
  const r = conventionDraftCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /không phải JSON hợp lệ/);
  assert.doesNotMatch(r.output, /Unexpected|position|JSON\.parse/i);
  assert.deepEqual(repoLayout(root).repos, []);
  put(root, 'src/z.php', '<?php\nfunction z() {}\n');
  assert.match(collectContext(root, { files: ['src/z.php'] }).text, /### convention/);
});

test('CP-99-EC1 a sibling whose name holds a newline never shows up as a partial name', (t) => {
  if (process.platform === 'win32') {
    t.diagnostic('Windows không cho đặt tên file có xuống dòng; case này chỉ đo được ở Linux và macOS');
    return;
  }
  const root = singleRepo([
    { 'src/c.php': '<?php\nfunction c() {}\n', 'src/d.php': '<?php\nfunction d() {}\n' },
    { 'src/a\nb.php': '<?php\nfunction ab() {}\n' },
  ]);
  put(root, 'src/z.php', '<?php\nfunction z() {}\n');
  const part = conventionPart(collectContext(root, { files: ['src/z.php'] }).text);
  const samples = samplesIn(part);
  assert.ok(samples.length >= 1, part);
  for (const s of samples) {
    assert.ok(['src/c.php', 'src/d.php', 'src/a\nb.php'].includes(s), `mẫu lạ: ${JSON.stringify(s)}`);
  }
  assert.ok(!samples.includes('src/a') && !samples.includes('b.php'));
});

test('CP-99-EC2 plain --draft on a multi-repo workspace still keeps every byte', async () => {
  const { root } = beWorkspace();
  const { buildDraft: oldBuild } = await oldModule('lib/convention-draft.mjs');
  assert.equal(buildDraft(root).text, oldBuild(root).text);
});
