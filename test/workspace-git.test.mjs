import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewCommand } from '../commands/review.mjs';
import { secretsCommand } from '../commands/secrets.mjs';
import { prCommand } from '../commands/pr.mjs';
import { writeReview, coverageFor } from './helpers/review.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { withinBudget } from './helpers/timing.mjs';

// CP-84 — issue #1: repo con có `.git` riêng nằm dưới gốc Compass. `review`,
// `secrets` và `compass pr` phải thấy code của chúng, như `test` hay `convention`
// đã thấy. Mọi test dựng một workspace thật trong thư mục tạm.

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
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

// Repo con: `main` có `a.js`; nhánh `feature` thêm các file của task, mỗi phần tử
// của `steps` là một commit.
function subRepo(root, rel, { steps = [{ 'b.js': 'export const b = 2;\n' }], base = {} } = {}) {
  const dir = path.join(root, rel);
  initGit(dir);
  put(dir, 'a.js', 'export const a = 1;\n');
  for (const [f, body] of Object.entries(base)) put(dir, f, body);
  commit(dir, 'base');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  const shas = steps.map((files, i) => {
    for (const [f, body] of Object.entries(files)) put(dir, f, body);
    return commit(dir, `step ${i + 1}`);
  });
  return { dir, shas };
}

const SPEC = ({ scope, head = '' }) => `# T-1: việc trong repo con
Loại: fix
Phạm vi: ${scope}
${head}
## Mục tiêu
Thêm b.js.

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

// Gốc Compass như issue #1: git riêng chỉ theo dõi `.compass/` (hoặc không có git).
function workspace({ rootGit = true, ignoreAll = true, repos = { be: { test: 'true' } }, scope = 'be/', head = '', config = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp84-'));
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', ...config, repos }));
  put(root, '.compass/T-1/spec.md', SPEC({ scope, head }));
  if (rootGit) {
    initGit(root);
    if (ignoreAll) put(root, '.gitignore', '/*\n!/.compass/\n!/.gitignore\n');
    commit(root, 'workspace');
  }
  return root;
}

const setSpec = (root, opts) => writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC(opts));
const review = (root) => reviewCommand({ cwd: root, taskId: 'T-1' });
const secrets = (root) => secretsCommand({ cwd: root, taskId: 'T-1' });
const briefOf = (root) => readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
const diffOf = (brief) => brief.slice(brief.lastIndexOf('\n## Diff\n'));

test('CP-84-H1 the review brief holds the code of a sub-repo with its own git', () => {
  const root = workspace();
  const { dir } = subRepo(root, 'be');
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  const brief = briefOf(root);
  assert.match(diffOf(brief), /diff --git a\/be\/b\.js b\/be\/b\.js/);
  assert.match(brief, /^- be\/b\.js$/m);
  // Gốc soi của be là điểm rẽ của nó khỏi main, trong chính git của be.
  const base = git(dir, ['rev-parse', 'main']).slice(0, 7);
  assert.ok(brief.includes(`Repo \`be\` (git riêng, file mang tiền tố \`be/\`): Diff tính từ \`${base}\``), brief.slice(brief.indexOf('## Phạm vi'), brief.indexOf('## Các file')));
});

test('CP-84-H2 secrets fails on a .env committed in a sub-repo', () => {
  const root = workspace();
  subRepo(root, 'be', { steps: [{ 'b.js': 'export const b = 2;\n', '.env': 'DB_PASSWORD=hunter2\n' }] });
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /be\/\.env/);
  assert.doesNotMatch(r.output, /hunter2/);
});

test('CP-84-H3 compass pr inside a sub-repo reviews that repo\'s branch', () => {
  const root = workspace();
  const { dir } = subRepo(root, 'be');
  git(dir, ['checkout', '-q', 'main']);
  const r = prCommand({ cwd: dir, ref: 'feature', base: 'main' });
  assert.equal(r.exitCode, 1, r.output);
  const brief = readFileSync(path.join(dir, '.git', 'compass', 'pr', 'feature', 'review-brief.md'), 'utf8');
  assert.match(diffOf(brief), /b\.js/);
  assert.doesNotMatch(diffOf(brief), /\.gitignore/);
  assert.ok(!existsSync(path.join(root, '.git', 'compass')), 'trạng thái nằm trong git của gốc');
  // Dọn dẹp của CP-81 chạy trong git của repo con: không worktree tạm, không ref tạm.
  assert.doesNotMatch(git(dir, ['worktree', 'list', '--porcelain']), /compass-pr-/);
  assert.equal(git(dir, ['for-each-ref', 'refs/compass/']), '');
});

test('CP-84-H4 two sub-repos in Phạm vi share one brief, each with its own range', () => {
  const root = workspace({ repos: { be: { test: 'true' }, fe: { test: 'true' } }, scope: 'be/, fe/' });
  subRepo(root, 'be');
  subRepo(root, 'fe', { steps: [{ 'f.js': 'export const f = 3;\n' }] });
  assert.equal(review(root).exitCode, 1);
  const brief = briefOf(root);
  assert.match(diffOf(brief), /a\/be\/b\.js/);
  assert.match(diffOf(brief), /a\/fe\/f\.js/);
  assert.equal(brief.match(/^Repo `be` \(git riêng/gm)?.length, 1);
  assert.equal(brief.match(/^Repo `fe` \(git riêng/gm)?.length, 1);
});

test('CP-84-H5 findings for the brief pass, and an edit in the sub-repo reopens the review', () => {
  const root = workspace();
  const { dir } = subRepo(root, 'be');
  assert.equal(review(root).exitCode, 1);
  writeReview(root, 'T-1');
  const passed = review(root);
  assert.equal(passed.exitCode, 0, passed.output);
  put(dir, 'b.js', 'export const b = 22;\n');
  const reopened = review(root);
  assert.equal(reopened.exitCode, 1, reopened.output);
  assert.match(reopened.output, /đã đổi/);
});

function prTwice(dir, { stateIn = dir, ...opts } = {}) {
  const first = prCommand({ cwd: dir, ref: 'feature', base: 'main', ...opts });
  assert.equal(first.exitCode, 1, first.output);
  const state = path.join(stateIn, '.git', 'compass', 'pr', 'feature');
  const brief = readFileSync(path.join(state, 'review-brief.md'), 'utf8');
  const id = brief.match(/"brief":\s*"([^"]+)"/)[1];
  writeFileSync(path.join(state, 'findings.json'), JSON.stringify({ brief: id, coverage: coverageFor(), findings: [] }));
  return prCommand({ cwd: dir, ref: 'feature', base: 'main', ...opts });
}

const marker = (name) => path.join(mkdtempSync(path.join(tmpdir(), 'compass-cp84-mark-')), name).split(path.sep).join('/');
const writes = (file) => `node -e "require('fs').writeFileSync('${file}', process.cwd())"`;

test('CP-84-H6 --run-tests inside a sub-repo runs the root config\'s command for that repo', () => {
  const ran = marker('RAN');
  const root = workspace({ repos: { be: { test: writes(ran) } } });
  const { dir } = subRepo(root, 'be');
  git(dir, ['checkout', '-q', 'main']);
  const r = prTwice(dir, { runTests: true, warned: true });
  assert.equal(r.exitCode, 0, r.output);
  assert.ok(existsSync(ran), 'lệnh test của repos.be không chạy');
  assert.match(readFileSync(ran, 'utf8'), /compass-pr-[^\\/]+[\\/]head$/, 'test không chạy trong worktree tạm của PR');
});

test('CP-84-EC13 two repos in one sub-git: --run-tests uses the repo you stand in', () => {
  const ranWeb = marker('WEB');
  const ranApi = marker('API');
  const root = workspace({ repos: { web: { path: 'apps/web', test: writes(ranWeb) }, api: { path: 'apps/api', test: writes(ranApi) } } });
  const apps = path.join(root, 'apps');
  initGit(apps);
  put(apps, 'web/w.js', 'export const w = 1;\n');
  put(apps, 'api/a.js', 'export const a = 1;\n');
  commit(apps, 'base');
  git(apps, ['checkout', '-q', '-b', 'feature']);
  put(apps, 'api/a.js', 'export const a = 2;\n');
  commit(apps, 'feat');
  git(apps, ['checkout', '-q', 'main']);
  const r = prTwice(path.join(apps, 'api'), { runTests: true, warned: true, stateIn: apps });
  assert.equal(r.exitCode, 0, r.output);
  assert.ok(existsSync(ranApi), 'lệnh test của api không chạy');
  assert.ok(!existsSync(ranWeb), 'chạy lệnh test của web dù đang đứng trong api');
  assert.match(readFileSync(ranApi, 'utf8'), /[\\/]head[\\/]api$/);
});

test('CP-84-V1 Gốc soi (be) sets be\'s base and the brief says it came from the spec', () => {
  const root = workspace();
  const { shas } = subRepo(root, 'be', { steps: [{ 'x.js': 'export const x = 1;\n' }, { 'b.js': 'export const b = 2;\n' }] });
  setSpec(root, { scope: 'be/', head: `Gốc soi (be): ${shas[0]}\n` });
  assert.equal(review(root).exitCode, 1);
  const brief = briefOf(root);
  assert.match(diffOf(brief), /a\/be\/b\.js/);
  assert.doesNotMatch(diffOf(brief), /be\/x\.js/);
  assert.match(brief, /Repo `be`[^\n]*khai ở spec/);
});

test('CP-84-V2 repos.be.reviewBase is be\'s base; a top-level reviewBase is not tried in be', () => {
  const root = workspace();
  const rootSha = git(root, ['rev-parse', 'HEAD']);
  const { shas } = subRepo(root, 'be', { steps: [{ 'x.js': 'export const x = 1;\n' }, { 'b.js': 'export const b = 2;\n' }] });
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', reviewBase: rootSha, repos: { be: { test: 'true', reviewBase: shas[0] } } }));
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(diffOf(briefOf(root)), /a\/be\/b\.js/);
  assert.doesNotMatch(diffOf(briefOf(root)), /be\/x\.js/);

  // Không khai ở repo thì be tự lần về điểm rẽ, không thử sha của git gốc.
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', reviewBase: rootSha, repos: { be: { test: 'true' } } }));
  const r2 = review(root);
  assert.equal(r2.exitCode, 1, r2.output);
  assert.match(diffOf(briefOf(root)), /be\/x\.js/);
});

test('CP-84-V3 Gốc soi for an undeclared repo is refused', () => {
  const root = workspace();
  subRepo(root, 'be');
  setSpec(root, { scope: 'be/', head: 'Gốc soi (xx): HEAD\n' });
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /"xx"/);
  assert.match(r.output, /Repo con có git riêng: be\./);
});

test('CP-84-V4 Gốc soi for a repo that shares the root\'s git says to use plain Gốc soi', () => {
  const root = workspace({ ignoreAll: false, repos: { fe: { test: 'true' } }, scope: 'fe/' });
  put(root, 'fe/f.js', 'export const f = 1;\n');
  commit(root, 'fe');
  setSpec(root, { scope: 'fe/', head: 'Gốc soi (fe): HEAD\n' });
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Gốc soi:/);
});

test('CP-84-V5 Soi đến (be) stops be\'s diff and keeps only its Phạm vi entries', () => {
  const root = workspace();
  const { shas } = subRepo(root, 'be', { steps: [{ 'x.js': 'export const x = 1;\n', 'y.js': 'export const y = 1;\n' }, { 'b.js': 'export const b = 2;\n' }] });
  setSpec(root, { scope: 'be/x.js', head: `Soi đến (be): ${shas[0]}\n` });
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  const diff = diffOf(briefOf(root));
  assert.match(diff, /a\/be\/x\.js/);
  assert.doesNotMatch(diff, /be\/y\.js/);
  assert.doesNotMatch(diff, /be\/b\.js/);
});

test('CP-84-V6 a Gốc soi (be) that is not in be\'s git names be and the spec', () => {
  const root = workspace();
  subRepo(root, 'be');
  setSpec(root, { scope: 'be/', head: 'Gốc soi (be): khong-co-ref-nay\n' });
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Repo `be`: Gốc soi "khong-co-ref-nay" \(khai ở spec\)/);
});

test('CP-84-E1 a Compass root with no git still reviews and scans its sub-repos', () => {
  const root = workspace({ rootGit: false });
  subRepo(root, 'be', { steps: [{ 'b.js': 'export const b = 2;\n', '.env': 'X=1\n' }] });
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(diffOf(briefOf(root)), /a\/be\/b\.js/);
  const s = secrets(root);
  assert.equal(s.exitCode, 1, s.output);
  assert.match(s.output, /be\/\.env/);
});

test('CP-84-E2 a sub-repo with no commit yet is named', () => {
  const root = workspace();
  initGit(path.join(root, 'be'));
  put(root, 'be/b.js', 'export const b = 2;\n');
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Repo `be`: Repo chưa có commit nào/);
});

test('CP-84-E3 every unit empty is red', () => {
  const root = workspace();
  subRepo(root, 'be');
  setSpec(root, { scope: 'be/', head: 'Gốc soi: HEAD\nGốc soi (be): HEAD\n' });
  commit(root, 'spec');
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Không có thay đổi/);
});

test('CP-84-E4 compass pr at a root with no git names the repos to cd into', () => {
  const root = workspace({ rootGit: false, repos: { be: { test: 'true' }, fe: { test: 'true' } } });
  subRepo(root, 'be');
  subRepo(root, 'fe');
  const r = prCommand({ cwd: root, ref: '1' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Repo con có git riêng: be, fe\./);
  assert.match(r.output, /cd be && compass pr 1/);
});

test('CP-84-E5 secrets is red and names be when be\'s base does not resolve', () => {
  const root = workspace({ repos: { be: { test: 'true', reviewBase: 'khong-co-ref-nay' } } });
  subRepo(root, 'be');
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Repo `be`: Gốc soi "khong-co-ref-nay" \(khai ở config\.json\)/);
});

test('CP-84-EC1 a repo in the root\'s own git gives the same brief as no repos at all', () => {
  const root = workspace({ ignoreAll: false, repos: { fe: { test: 'true' } }, scope: 'fe/' });
  put(root, 'fe/f.js', 'export const f = 1;\n');
  commit(root, 'fe');
  git(root, ['checkout', '-q', '-b', 'feature']);
  put(root, 'fe/f.js', 'export const f = 2;\n');
  commit(root, 'feat');
  assert.equal(review(root).exitCode, 1);
  const withRepos = briefOf(root);
  put(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
  rmSync(path.join(root, '.compass', 'T-1', 'review-brief.md'));
  assert.equal(review(root).exitCode, 1);
  assert.equal(briefOf(root), withRepos);
  assert.doesNotMatch(withRepos, /Repo `/);
});

test('CP-84-EC2 a sub-repo outside Phạm vi is not in the brief', () => {
  const root = workspace({ repos: { be: { test: 'true' }, fe: { test: 'true' } }, scope: 'be/' });
  subRepo(root, 'be');
  subRepo(root, 'fe', { steps: [{ 'f.js': 'export const f = 3;\n' }] });
  assert.equal(review(root).exitCode, 1);
  assert.doesNotMatch(briefOf(root), /fe\/f\.js/);
});

test('CP-84-EC3 secrets catches a .env committed in a sub-repo outside Phạm vi', () => {
  const root = workspace({ repos: { be: { test: 'true' }, fe: { test: 'true' } }, scope: 'be/' });
  subRepo(root, 'be');
  subRepo(root, 'fe', { steps: [{ '.env': 'TOKEN=1\n' }] });
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /fe\/\.env/);

  // `.env` đã nằm trên nhánh chính của fe từ trước: không nằm trong diff nào, chỉ
  // việc liệt kê index của fe mới thấy nó.
  const fe = path.join(root, 'fe');
  git(fe, ['checkout', '-q', 'main']);
  git(fe, ['merge', '-q', '--ff-only', 'feature']);
  git(fe, ['branch', '-q', '-D', 'feature']);
  const r2 = secrets(root);
  assert.equal(r2.exitCode, 1, r2.output);
  assert.match(r2.output, /fe\/\.env/);
});

test('CP-84-V7 a Phạm vi entry that is not a pathspec is refused when only a repo declares Soi đến', () => {
  const root = workspace();
  const { shas } = subRepo(root, 'be', { steps: [{ 'x.js': 'export const x = 1;\n' }, { 'b.js': 'export const b = 2;\n' }] });
  setSpec(root, { scope: 'be/x.js, ../ngoai.js', head: `Soi đến (be): ${shas[0]}\n` });
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /pathspec/);
});

test('CP-84-EC4 a sub-repo on main is scanned for uncommitted changes only', () => {
  const root = workspace({ repos: { be: { test: 'true' }, fe: { test: 'true' } }, scope: 'be/' });
  subRepo(root, 'be');
  const fe = path.join(root, 'fe');
  initGit(fe);
  put(fe, 'README.md', 'fe\n');
  commit(fe, 'init');
  put(fe, 'old.js', "require('fs').readFileSync('.env')\n");
  commit(fe, 'old');
  put(fe, 'more.js', 'export const m = 1;\n');
  commit(fe, 'more');
  put(fe, 'new.js', "require('fs').readFileSync('.env')\n");
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /fe\/new\.js/);
  assert.doesNotMatch(r.output, /old\.js/);
});

test('CP-84-EC5 the root unit adds no gitlink for a sub-repo it does not ignore', () => {
  const root = workspace({ ignoreAll: false });
  subRepo(root, 'be');
  assert.equal(review(root).exitCode, 1);
  const brief = briefOf(root);
  assert.doesNotMatch(brief, /Subproject commit/);
  assert.doesNotMatch(diffOf(brief), /diff --git a\/be b\/be/);
  assert.match(diffOf(brief), /a\/be\/b\.js/);
});

test('CP-84-EC6 two repos inside one sub-git are one unit, each file once', () => {
  const root = workspace({ repos: { web: { path: 'apps/web', test: 'true' }, api: { path: 'apps/api', test: 'true' } }, scope: 'web, api' });
  const apps = path.join(root, 'apps');
  initGit(apps);
  put(apps, 'web/w.js', 'export const w = 1;\n');
  put(apps, 'api/a.js', 'export const a = 1;\n');
  commit(apps, 'base');
  git(apps, ['checkout', '-q', '-b', 'feature']);
  put(apps, 'web/w.js', 'export const w = 2;\n');
  put(apps, 'api/a.js', 'export const a = 2;\n');
  commit(apps, 'feat');
  assert.equal(review(root).exitCode, 1);
  const diff = diffOf(briefOf(root));
  assert.equal(diff.match(/diff --git a\/apps\/web\/w\.js/g)?.length, 1);
  assert.equal(diff.match(/diff --git a\/apps\/api\/a\.js/g)?.length, 1);
});

test('CP-84-EC7 an uncommitted new file in a sub-repo is in the brief', () => {
  const root = workspace();
  const { dir } = subRepo(root, 'be');
  put(dir, 'moi.js', 'export const moi = 1;\n');
  assert.equal(review(root).exitCode, 1);
  assert.match(diffOf(briefOf(root)), /a\/be\/moi\.js/);
});

test('CP-84-EC8 deleting a tracked .env in a sub-repo is not a .env in the diff', () => {
  const root = workspace();
  const { dir } = subRepo(root, 'be', { base: { '.env': 'X=1\n' }, steps: [] });
  git(dir, ['rm', '-q', '.env']);
  put(dir, '.gitignore', '.env\n');
  commit(dir, 'remove .env');
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-84-EC9 a caller inside the sub-repo shows in the context', () => {
  const root = workspace();
  subRepo(root, 'be', {
    base: { 'b.js': 'export function tinh(x) {\n  return x\n}\n', 'c.js': "import { tinh } from './b.js'\nexport const y = tinh(1)\n" },
    steps: [{ 'b.js': 'export function tinh(x) {\n  return x * 2\n}\n' }],
  });
  assert.equal(review(root).exitCode, 1);
  const brief = briefOf(root);
  const context = brief.slice(brief.indexOf('### impact'), brief.indexOf('### reuse'));
  assert.match(context, /be\/c\.js/);
});

test('CP-84-S1 a sub-repo .env never reaches the brief', () => {
  const root = workspace();
  subRepo(root, 'be', { base: { '.gitignore': '.env\n' }, steps: [{ 'b.js': "export const f = () => require('fs').readFileSync('.env')\n" }] });
  put(root, 'be/.env', 'SECRET-VALUE-84\n');
  assert.equal(review(root).exitCode, 1);
  assert.doesNotMatch(briefOf(root), /SECRET-VALUE-84/);
});

test('CP-84-S2 a sub-repo\'s diff.noprefix and diff.external do not change the brief', () => {
  const ran = marker('EXTERNAL');
  const root = workspace();
  const { dir } = subRepo(root, 'be');
  git(dir, ['config', 'diff.noprefix', 'true']);
  git(dir, ['config', 'diff.mnemonicPrefix', 'true']);
  git(dir, ['config', 'diff.external', writes(ran)]);
  assert.equal(review(root).exitCode, 1);
  assert.match(diffOf(briefOf(root)), /diff --git a\/be\/b\.js b\/be\/b\.js/);
  assert.ok(!existsSync(ran), 'diff.external của repo con đã chạy');
});

test('CP-84-S3 a repo that is a link to a git outside the root is refused', () => {
  const root = workspace();
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp84-out-'));
  subRepo(outside, 'be', { steps: [{ 'b.js': 'export const OUTSIDE = 1;\n' }] });
  symlinkSync(path.join(outside, 'be'), path.join(root, 'be'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /ngoài gốc Compass/);
  assert.ok(!existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')), 'brief đã được dựng từ git bên ngoài');
  const s = secrets(root);
  assert.equal(s.exitCode, 2, s.output);
});

test('CP-84-S4 a PR that commits its own .compass/config.json does not choose the test command', () => {
  const rootRan = marker('ROOT');
  const prRan = marker('PR');
  const root = workspace({ repos: { be: { test: writes(rootRan) } } });
  const { dir } = subRepo(root, 'be', { steps: [{ 'b.js': 'export const b = 2;\n', '.compass/config.json': JSON.stringify({ test: writes(prRan) }) }] });
  git(dir, ['checkout', '-q', 'main']);
  const r = prTwice(dir, { runTests: true, warned: true });
  assert.equal(r.exitCode, 0, r.output);
  assert.ok(existsSync(rootRan), 'lệnh test của gốc không chạy');
  assert.ok(!existsSync(prRan), 'lệnh test do PR commit đã chạy');

  // Đứng ngay trên nhánh PR cũng vậy: file trên đĩa là của PR.
  git(dir, ['checkout', '-q', 'feature']);
  rmSync(rootRan, { force: true });
  rmSync(path.join(dir, '.git', 'compass'), { recursive: true, force: true });
  const r2 = prTwice(dir, { runTests: true, warned: true });
  assert.equal(r2.exitCode, 0, r2.output);
  assert.ok(existsSync(rootRan));
  assert.ok(!existsSync(prRan), 'lệnh test do PR commit đã chạy');
});

test('CP-84-S5 a Gốc soi (be) that reads as a git flag is refused before git runs it', () => {
  const root = workspace();
  subRepo(root, 'be');
  setSpec(root, { scope: 'be/', head: 'Gốc soi (be): --output=pwned.txt\n' });
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /cờ/);
  assert.ok(!existsSync(path.join(root, 'be', 'pwned.txt')));
});

test('CP-84-E6 one repos entry that fails to resolve does not hide the other sub-repos', () => {
  // `be` khai lệnh test rỗng: lỗi của gate `test`, không phải lý do để không
  // quét be (lần soi đầu của CP-84).
  const root = workspace();
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { be: { test: '' }, fe: { test: 'true' } } }));
  subRepo(root, 'be', { steps: [{ 'b.js': 'export const b = 2;\n', '.env': 'X=1\n' }] });
  subRepo(root, 'fe');
  const s = secrets(root);
  assert.equal(s.exitCode, 1, s.output);
  assert.match(s.output, /be\/\.env/);
  assert.equal(review(root).exitCode, 1);
  assert.match(diffOf(briefOf(root)), /a\/be\/b\.js/);
});

test('CP-84-E7 a declared repo that is not cloned: refused in Phạm vi, skipped otherwise', () => {
  const root = workspace({ repos: { be: { test: 'true' }, fe: { test: 'true' } }, scope: 'be/, fe/' });
  subRepo(root, 'be', { steps: [{ 'b.js': 'export const b = 2;\n', '.env': 'X=1\n' }] });
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /"fe" nằm trong Phạm vi nhưng không thấy thư mục/);
  setSpec(root, { scope: 'be/' });
  assert.equal(review(root).exitCode, 1);
  const s = secrets(root);
  assert.equal(s.exitCode, 1, s.output);
  assert.match(s.output, /be\/\.env/);
});

test('CP-84-E8 an unreadable config.json does not let secrets pass on a sub-repo .env', () => {
  const root = workspace();
  subRepo(root, 'be', { steps: [{ '.env': 'X=1\n' }] });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{ "repos": { "be": ');
  const s = secrets(root);
  assert.equal(s.exitCode, 2, s.output);
  assert.match(s.output, /Không đọc được \.compass\/config\.json, nên không biết repo con nào có git riêng/);
});

test('CP-84-EC10 a repo whose name differs from its path is chosen and narrowed either way', () => {
  const root = workspace({ repos: { web: { path: 'apps/web', test: 'true' } }, scope: 'apps/web/w.js' });
  const { shas } = subRepo(root, 'apps/web', { steps: [{ 'w.js': 'export const w = 1;\n', 'z.js': 'export const z = 1;\n' }, { 'q.js': 'export const q = 1;\n' }] });
  assert.equal(review(root).exitCode, 1);
  assert.match(diffOf(briefOf(root)), /a\/apps\/web\/w\.js/);
  for (const scope of ['apps/web/w.js', 'web/w.js']) {
    setSpec(root, { scope, head: `Soi đến (web): ${shas[0]}\n` });
    assert.equal(review(root).exitCode, 1, scope);
    const diff = diffOf(briefOf(root));
    assert.match(diff, /a\/apps\/web\/w\.js/, scope);
    assert.doesNotMatch(diff, /apps\/web\/z\.js/, scope);
    assert.doesNotMatch(diff, /apps\/web\/q\.js/, scope);
  }
});

test('CP-84-EC11 a sub-repo with a single commit is diffed from the empty tree', () => {
  const root = workspace();
  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'b.js', 'export const b = 2;\n');
  commit(be, 'only');
  assert.equal(review(root).exitCode, 1);
  const brief = briefOf(root);
  assert.match(diffOf(brief), /a\/be\/b\.js/);
  assert.match(brief, /Repo `be`[^\n]*\nGốc soi là cây rỗng/);
});

test('CP-84-EC12 a rename inside a sub-repo carries the prefix', () => {
  const root = workspace();
  subRepo(root, 'be', { base: { 'cu.js': 'export const tenDaiDeGitNhanRaDoiTen = 12345;\n' }, steps: [] });
  const be = path.join(root, 'be');
  git(be, ['mv', 'cu.js', 'moi.js']);
  commit(be, 'rename');
  assert.equal(review(root).exitCode, 1);
  const diff = diffOf(briefOf(root));
  assert.match(diff, /^rename from be\/cu\.js$/m);
  assert.match(diff, /^rename to be\/moi\.js$/m);

  // Tên ngoài ASCII git đặt trong nháy: tiền tố phải nằm trong nháy, như dòng diff --git.
  git(be, ['mv', 'moi.js', 'cũ.js']);
  commit(be, 'rename 2');
  rmSync(path.join(root, '.compass', 'T-1', 'review-brief.md'));
  assert.equal(review(root).exitCode, 1);
  assert.match(diffOf(briefOf(root)), /^rename to "be\/c\\305\\251\.js"$/m);
});

test('CP-84-EC14 a root Soi đến with only sub-repo entries in Phạm vi leaves the root out', () => {
  const root = workspace();
  const rootSha = git(root, ['rev-parse', 'HEAD']);
  put(root, 'note.txt', 'không thuộc task\n');
  git(root, ['add', '-f', 'note.txt']);
  commit(root, 'note');
  subRepo(root, 'be');
  setSpec(root, { scope: 'be/b.js', head: `Gốc soi: ${rootSha}~0\nSoi đến: HEAD~0\n` });
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  const brief = briefOf(root);
  assert.doesNotMatch(diffOf(brief), /note\.txt/);
  assert.match(diffOf(brief), /a\/be\/b\.js/);
});

test('CP-84-V9 a repos entry whose path leaves the root makes review and secrets red', () => {
  const root = workspace({ repos: { be: { test: 'true' }, ra: { path: '../ngoai', test: 'true' } } });
  subRepo(root, 'be', { steps: [{ '.env': 'X=1\n' }] });
  for (const r of [review(root), secrets(root)]) {
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, /repo "ra" trỏ ra ngoài thư mục gốc/);
  }
});

test('CP-84-EC16 a single-git project whose config lacks a top-level test still reviews', () => {
  // Lần soi thứ ba: config thiếu `test` là việc của gate `test`. Trước CP-84 `review`
  // và `secrets` vẫn chạy với nó, và dự án một git phải giữ nguyên như vậy.
  const root = workspace({ ignoreAll: false, repos: undefined });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ reviewBase: 'HEAD' }));
  put(root, 'src/x.js', 'export const x = 1;\n');
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(diffOf(briefOf(root)), /a\/src\/x\.js/);
  assert.doesNotMatch(r.output, /repo con/);
  assert.equal(secrets(root).exitCode, 0);

  // JSON hỏng mà không nhắc `repos` thì cũng là dự án một git như trước.
  writeFileSync(path.join(root, '.compass', 'config.json'), '{ "test": ');
  const broken = review(root);
  assert.doesNotMatch(broken.output, /repo con/);
  assert.notEqual(broken.exitCode, 2, broken.output);
});

test('CP-84-EC17 a repo named like an object property gets no base from the prototype', () => {
  const root = workspace({ repos: { toString: { test: 'true' }, constructor: { test: 'true' } }, scope: 'toString/, constructor/' });
  subRepo(root, 'toString');
  subRepo(root, 'constructor', { steps: [{ 'c.js': 'export const c = 1;\n' }] });
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  const diff = diffOf(briefOf(root));
  assert.match(diff, /a\/toString\/b\.js/);
  assert.match(diff, /a\/constructor\/c\.js/);
  assert.equal(secrets(root).exitCode, 0);
});

test('CP-84-E10 a sub-repo whose .git git cannot read makes review and secrets red', () => {
  // Lần soi thứ tư: `.git` có mà git từ chối (trên Windows hay gặp nhất là safe.directory)
  // từng bị coi như thư mục thường, và `secrets` xanh trên `.env` đã commit.
  const root = workspace();
  subRepo(root, 'be', { steps: [{ '.env': 'X=1\n' }] });
  const be = path.join(root, 'be');
  rmSync(path.join(be, '.git'), { recursive: true, force: true });
  writeFileSync(path.join(be, '.git'), 'gitdir: ../khong-co-thu-muc-nay\n');
  for (const r of [review(root), secrets(root)]) {
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, /Repo "be" có \.git nhưng git không đọc được nó/);
  }
});

const breakGit = (dir) => {
  rmSync(path.join(dir, '.git'), { recursive: true, force: true });
  writeFileSync(path.join(dir, '.git'), 'gitdir: ../khong-co-thu-muc-nay\n');
};

test('CP-84-E11 a shared sub-git that git cannot read makes both gates red', () => {
  const root = workspace({ repos: { web: { path: 'apps/web', test: 'true' }, api: { path: 'apps/api', test: 'true' } }, scope: 'web, api' });
  const apps = path.join(root, 'apps');
  initGit(apps);
  put(apps, 'web/w.js', 'export const w = 1;\n');
  put(apps, 'api/.env', 'X=1\n');
  commit(apps, 'base');
  breakGit(apps);
  for (const r of [review(root), secrets(root)]) {
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, /git -C apps status/);
  }
});

test('CP-84-E12 a root git that git cannot read, next to sub-repos, makes both gates red', () => {
  const root = workspace();
  put(root, 'cfg/.env', 'X=1\n');
  git(root, ['add', '-f', 'cfg/.env']);
  commit(root, 'env');
  subRepo(root, 'be');
  breakGit(root);
  for (const r of [review(root), secrets(root)]) {
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, /Git của gốc Compass \([^)]+\) có \.git nhưng git không đọc được nó/);
  }
});

test('CP-84-E13 a root git with no commit is named as the root\'s, not a sub-repo\'s', () => {
  const root = workspace({ rootGit: false });
  initGit(root);
  subRepo(root, 'be');
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Git của gốc Compass: Repo chưa có commit nào/);
});

test('CP-84-EC19 a single-git task that deletes a declared repo folder still reviews', () => {
  const root = workspace({ ignoreAll: false, repos: { fe: { test: 'true' } }, scope: 'fe/' });
  put(root, 'fe/f.js', 'export const f = 1;\n');
  commit(root, 'fe');
  git(root, ['checkout', '-q', '-b', 'feature']);
  git(root, ['rm', '-q', '-r', 'fe']);
  commit(root, 'bỏ fe');
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(diffOf(briefOf(root)), /deleted file mode[\s\S]*fe\/f\.js|a\/fe\/f\.js/);
});

test('CP-84-EC20 a sub-repo in Phạm vi with an empty diff still gets its range line', () => {
  const root = workspace({ repos: { be: { test: 'true' }, fe: { test: 'true' } }, scope: 'be/, fe/' });
  subRepo(root, 'be');
  subRepo(root, 'fe', { steps: [{ 'f.js': 'export const f = 3;\n' }] });
  setSpec(root, { scope: 'be/, fe/', head: 'Gốc soi (be): HEAD\n' });
  assert.equal(review(root).exitCode, 1);
  const brief = briefOf(root);
  assert.match(brief, /^Repo `be` \(git riêng, file mang tiền tố `be\/`\): không có thay đổi nào trong khoảng soi của git này\.$/m);
  assert.match(brief, /^Repo `fe` \(git riêng/m);
});

test('CP-84-EC21 a $ in a sub-repo folder name stays literal in rename lines', () => {
  const root = workspace({ repos: { app: { path: 'app$1', test: 'true' } }, scope: 'app' });
  subRepo(root, 'app$1', { base: { 'cu.js': 'export const tenDaiDeGitNhanRaDoiTen = 12345;\n' }, steps: [] });
  const dir = path.join(root, 'app$1');
  git(dir, ['mv', 'cu.js', 'moi.js']);
  commit(dir, 'rename');
  assert.equal(review(root).exitCode, 1);
  const diff = diffOf(briefOf(root));
  assert.match(diff, /^rename from app\$1\/cu\.js$/m);
  assert.match(diff, /^rename to app\$1\/moi\.js$/m);
});

test('CP-84-EC18 an own-git repo nested in another own-git repo is not a gitlink', () => {
  const root = workspace({ repos: { apps: { test: 'true' }, web: { path: 'apps/web', test: 'true' } }, scope: 'apps/, web/' });
  subRepo(root, 'apps', { steps: [{ 'x.js': 'export const x = 1;\n' }] });
  subRepo(root, 'apps/web', { steps: [{ 'w.js': 'export const w = 1;\n' }] });
  assert.equal(review(root).exitCode, 1);
  const diff = diffOf(briefOf(root));
  assert.doesNotMatch(diff, /Subproject commit|160000/);
  assert.equal(diff.match(/diff --git a\/apps\/web\/w\.js/g)?.length, 1);
  assert.match(diff, /a\/apps\/x\.js/);
});

test('CP-84-V8 Gốc soi (be) never stands in for the plain Gốc soi line', () => {
  const head = (lines) => parseSpec(`# T-1: x\nLoại: fix\n${lines}\n## Mục tiêu\nx\n`);
  const a = head('Gốc soi (be): aaa\nGốc soi: bbb\nGốc soi (be): ccc\n');
  assert.equal(a.reviewBase, 'bbb');
  assert.deepEqual(a.repoBases, { be: 'aaa' });
  const b = head('Gốc soi (be): aaa\nSoi đến (be): ddd\n');
  assert.equal(b.reviewBase, null);
  assert.equal(b.reviewEnd, null);
  assert.deepEqual(b.repoEnds, { be: 'ddd' });
});

test('CP-84-S6 secrets scans committed work of a sub-repo in Phạm vi even on its main branch', () => {
  // be đứng trên nhánh chính, task commit thẳng vào đó. Chỉ repo ngoài Phạm vi mới
  // được rút về thay đổi chưa commit (lần soi thứ hai của CP-84).
  const root = workspace();
  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'README.md', 'be\n');
  commit(be, 'init');
  put(be, 'x.js', "require('fs').readFileSync('.env')\n");
  commit(be, 'task');
  const s = secrets(root);
  assert.equal(s.exitCode, 1, s.output);
  assert.match(s.output, /be\/x\.js/);
  assert.equal(review(root).exitCode, 1);
  assert.match(diffOf(briefOf(root)), /a\/be\/x\.js/);
});

test('CP-84-E9 --run-tests in a sub-repo works while another repos entry is not cloned', () => {
  const ran = marker('RAN');
  const root = workspace({ repos: { be: { test: writes(ran) }, fe: { test: 'true' } } });
  const { dir } = subRepo(root, 'be');
  git(dir, ['checkout', '-q', 'main']);
  const r = prTwice(dir, { runTests: true, warned: true });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(readFileSync(ran, 'utf8'), /compass-pr-[^\\/]+[\\/]head$/);
});

test('CP-84-EC15 a root Soi đến with root and be entries narrows the root and keeps be whole', () => {
  const root = workspace({ ignoreAll: false });
  put(root, 'docs/a.md', 'a\n');
  put(root, 'docs/b.md', 'b\n');
  const base = commit(root, 'docs');
  put(root, 'docs/a.md', 'a2\n');
  put(root, 'docs/b.md', 'b2\n');
  const end = commit(root, 'docs 2');
  subRepo(root, 'be');
  setSpec(root, { scope: 'docs/a.md, be/b.js', head: `Gốc soi: ${base}\nSoi đến: ${end}\n` });
  writeFileSync(path.join(root, '.gitignore'), 'be/\n');
  commit(root, 'ignore be');
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  const diff = diffOf(briefOf(root));
  assert.match(diff, /a\/docs\/a\.md/);
  assert.doesNotMatch(diff, /docs\/b\.md/);
  assert.match(diff, /a\/be\/b\.js/);
});

test('CP-84-P1 six sub-repos of 300 files each, three in Phạm vi, review within 15 s', () => {
  const names = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
  const root = workspace({ repos: Object.fromEntries(names.map((n) => [n, { test: 'true' }])), scope: 'r1/, r2/, r3/' });
  for (const n of names) {
    const base = {};
    for (let i = 0; i < 300; i += 1) base[`src/m${i}.js`] = `export const v${i} = ${i}\n`;
    subRepo(root, n, { base, steps: [{ 'src/m1.js': 'export const v1 = 100\n' }] });
  }
  const { value } = withinBudget({
    run: () => {
      rmSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), { force: true });
      return review(root);
    },
    budgetMs: 15_000,
    tries: 2,
    label: 'review 6 repo con',
  });
  assert.equal(value.exitCode, 1, value.output);
  const diff = diffOf(briefOf(root));
  assert.match(diff, /a\/r3\/src\/m1\.js/);
  assert.doesNotMatch(diff, /a\/r4\//);
});
