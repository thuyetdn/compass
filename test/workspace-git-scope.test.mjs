import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewCommand } from '../commands/review.mjs';
import { secretsCommand } from '../commands/secrets.mjs';
import { isUnder, foldsCase as fsFoldsCase } from '../lib/git-files.mjs';

// CP-88 — issue #2. Repo con ngoài Phạm vi chỉ góp thay đổi chưa commit cho
// `secrets`, đứng ở nhánh nào cũng vậy; repo có git nằm ngoài gốc chỉ bị từ chối
// khi nó nằm trong Phạm vi, ngoài đó thì bỏ qua và nói ra.

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

const SPEC = ({ scope, head = '' }) => `# T-1: việc trong be
Loại: fix
Phạm vi: ${scope}
${head}
## Mục tiêu
Đổi be.

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

// Gốc như issue #2: git riêng chỉ theo dõi `.compass/`; `be` là repo của task, đứng
// trên main với một thay đổi chưa commit.
function workspace({ repos = { be: {}, fe: {} }, scope = 'be/a.js', head = '', ignoreAll = true, parent = tmpdir() } = {}) {
  const root = mkdtempSync(path.join(parent, 'compass-cp88-'));
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: Object.fromEntries(Object.entries(repos).map(([k, v]) => [k, { test: 'true', ...v }])) }));
  put(root, '.compass/T-1/spec.md', SPEC({ scope, head }));
  initGit(root);
  put(root, '.gitignore', ignoreAll ? '/*\n!/.compass/\n!/.gitignore\n' : '');
  commit(root, 'workspace');
  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'a.js', 'export const a = 1\n');
  commit(be, 'be');
  put(be, 'a.js', 'export const a = 2\n');
  return root;
}

// `fe` ngoài Phạm vi: main có x.txt, rồi nhánh `alpha` với các commit trong `steps`.
function feOnAlpha(root, steps) {
  const fe = path.join(root, 'fe');
  initGit(fe);
  put(fe, 'x.txt', 'x\n');
  const first = commit(fe, 'fe');
  git(fe, ['checkout', '-q', '-b', 'alpha']);
  for (const files of steps) {
    for (const [f, body] of Object.entries(files)) put(fe, f, body);
    commit(fe, 'alpha');
  }
  return { fe, first };
}

const setSpec = (root, opts) => writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC(opts));
const review = (root) => reviewCommand({ cwd: root, taskId: 'T-1' });
const secrets = (root) => secretsCommand({ cwd: root, taskId: 'T-1' });
const briefOf = (root) => readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
const readsEnv = "require('fs').readFileSync('.env')\n";

// `hub`: junction trỏ tới một git nằm ngoài gốc Compass.
function hubOutside(root, files = { 'h.js': 'export const h = 1\n' }) {
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp88-out-'));
  const hub = path.join(outside, 'hub');
  initGit(hub);
  for (const [f, body] of Object.entries(files)) put(hub, f, body);
  commit(hub, 'hub');
  symlinkSync(hub, path.join(root, 'hub'), process.platform === 'win32' ? 'junction' : 'dir');
}

test('CP-88-H1 an out-of-scope repo on another branch with big committed work does not block secrets', () => {
  const root = workspace();
  feOnAlpha(root, [{ 'big.txt': 'y'.repeat(2_100_000) }]);
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-88-H2 an uncommitted .env read in an out-of-scope repo on another branch is still caught', () => {
  const root = workspace();
  const { fe } = feOnAlpha(root, [{ 'y.js': 'export const y = 1\n' }]);
  put(fe, 'moi.js', readsEnv);
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /fe\/moi\.js/);
});

test('CP-88-H3 a junction to a git outside the root, outside Phạm vi, is skipped with a note', () => {
  const root = workspace({ repos: { be: {}, hub: {} } });
  hubOutside(root);
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Bỏ qua repo "hub": git của nó nằm ngoài gốc Compass/);
  assert.match(briefOf(root), /a\/be\/a\.js/);
  const s = secrets(root);
  assert.equal(s.exitCode, 0, s.output);
  assert.match(s.output, /Bỏ qua repo "hub": git của nó nằm ngoài gốc Compass/);
});

test('CP-88-V1 repos.fe.reviewBase still wins for an out-of-scope repo', () => {
  const root = workspace();
  const { first } = feOnAlpha(root, [{ 'old.js': readsEnv }]);
  const cfg = JSON.parse(readFileSync(path.join(root, '.compass', 'config.json'), 'utf8'));
  cfg.repos.fe.reviewBase = first;
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify(cfg));
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /fe\/old\.js/);
});

test('CP-88-V2 Gốc soi (fe) in the spec still wins for an out-of-scope repo', () => {
  const root = workspace();
  const { first } = feOnAlpha(root, [{ 'old.js': readsEnv }]);
  setSpec(root, { scope: 'be/a.js', head: `Gốc soi (fe): ${first}\n` });
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /fe\/old\.js/);
});

test('CP-88-E1 a junction to a git outside the root that is in Phạm vi is refused', () => {
  const root = workspace({ repos: { be: {}, hub: {} }, scope: 'be/a.js, hub/h.js' });
  hubOutside(root);
  for (const r of [review(root), secrets(root)]) {
    assert.equal(r.exitCode, 2, r.output);
    assert.match(r.output, /Repo "hub" có git nằm ngoài gốc Compass/);
  }
});

test('CP-88-E2 a skipped repo does not hide a .env committed in the task\'s repo', () => {
  const root = workspace({ repos: { be: {}, hub: {} } });
  hubOutside(root);
  put(path.join(root, 'be'), '.env', 'X=1\n');
  commit(path.join(root, 'be'), 'env');
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /be\/\.env/);
});

test('CP-88-EC1 a .env committed on the branch of an out-of-scope repo is caught through the index', () => {
  const root = workspace();
  feOnAlpha(root, [{ '.env': 'TOKEN=1\n' }]);
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /fe\/\.env/);
});

test('CP-88-EC2 the task\'s own repo on another branch is scanned from its branch point', () => {
  const root = workspace({ scope: 'be/' });
  const be = path.join(root, 'be');
  git(be, ['checkout', '-q', '-b', 'alpha']);
  put(be, 'x.js', readsEnv);
  commit(be, 'task');
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /be\/x\.js/);
});

test('CP-88-EC3 an out-of-scope repo on a detached HEAD with nothing uncommitted passes', () => {
  const root = workspace();
  const { fe } = feOnAlpha(root, [{ 'big.txt': 'y'.repeat(2_100_000), 'old.js': readsEnv }]);
  git(fe, ['checkout', '-q', '--detach']);
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-88-EC4 review of the task\'s repo on another branch still holds its branch work', () => {
  const root = workspace({ scope: 'be/' });
  const be = path.join(root, 'be');
  const forkSha = git(be, ['rev-parse', 'HEAD']);
  git(be, ['checkout', '-q', '-b', 'alpha']);
  put(be, 'b.js', 'export const b = 2\n');
  commit(be, 'task');
  assert.equal(review(root).exitCode, 1);
  const brief = briefOf(root);
  assert.match(brief, /a\/be\/b\.js/);
  assert.ok(brief.includes(`Repo \`be\` (git riêng, file mang tiền tố \`be/\`): Diff tính từ \`${forkSha.slice(0, 7)}\``));
});

test('CP-88-S1 nothing of a skipped repo reaches the output or the brief', () => {
  // Git gốc không ignore gì: thư mục của repo bị bỏ qua không được vào index tạm của nó.
  const root = workspace({ repos: { be: {}, hub: {} }, ignoreAll: false });
  hubOutside(root, { 'hubfile.js': 'export const HUB = 1\n', '.env': 'SECRET-HUB-88\n' });
  const r = review(root);
  const s = secrets(root);
  const all = `${r.output}\n${s.output}\n${briefOf(root)}`;
  assert.doesNotMatch(all, /SECRET-HUB-88/);
  assert.doesNotMatch(all, /hubfile/);
  // Git gốc thấy junction là một repo lồng `hub/`: thêm nó vào index tạm là một gitlink.
  assert.doesNotMatch(briefOf(root), /Subproject commit|diff --git a\/hub/);
});

test('CP-88-S3 a root with no git whose only repo is skipped never passes secrets', () => {
  // Lần soi đầu: không còn git nào để đọc thì `secrets` từng xanh trên một quét rỗng.
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp88-nogit-'));
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { hub: { test: 'true' } } }));
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'x.js' }));
  put(root, 'x.js', readsEnv);
  hubOutside(root);
  const s = secrets(root);
  assert.notEqual(s.exitCode, 0, s.output);
  assert.match(s.output, /Không có git nào để đọc/);
});

test('CP-88-S4 a skipped repo nested inside a sub-repo is not a gitlink in that sub-repo\'s diff', () => {
  const root = workspace({ repos: { be: {}, hub: { path: 'be/hub' } }, scope: 'be/' });
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp88-out-'));
  const hub = path.join(outside, 'hub');
  initGit(hub);
  put(hub, 'h.js', 'export const h = 1\n');
  commit(hub, 'hub');
  symlinkSync(hub, path.join(root, 'be', 'hub'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Bỏ qua repo "hub"/);
  assert.doesNotMatch(briefOf(root), /Subproject commit|diff --git a\/be\/hub/);
  assert.equal(secrets(root).exitCode, 0);
});

// Junction vào một thư mục CON của git bên ngoài: git của gốc đi xuyên qua nó và liệt
// kê từng file, chứ không thấy một repo lồng `hub/` (lần soi thứ hai của CP-88).
function hubIntoSubdir(at) {
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp88-sub-'));
  initGit(outside);
  // Gọi tới hàm của task: mục impact của ngữ cảnh sẽ đọc file này nếu nó được liệt kê.
  put(outside, 'sub/hubfile.js', "import { tinhPhiVanChuyen } from '../be/a.js'\nexport const HUB = tinhPhiVanChuyen()\n");
  put(outside, 'sub/.env', 'SECRET-HUB-SUB-88\n');
  commit(outside, 'outside');
  symlinkSync(path.join(outside, 'sub'), at, process.platform === 'win32' ? 'junction' : 'dir');
}

test('CP-88-S5 a skipped junction into a subfolder of an outside git leaks nothing', () => {
  const root = workspace({ repos: { be: {}, hub: {} }, ignoreAll: false });
  put(path.join(root, 'be'), 'a.js', 'export function tinhPhiVanChuyen() {\n  return 2\n}\n');
  hubIntoSubdir(path.join(root, 'hub'));
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Bỏ qua repo "hub"/);
  const s = secrets(root);
  assert.equal(s.exitCode, 0, s.output);
  const all = `${r.output}\n${s.output}\n${briefOf(root)}`;
  assert.doesNotMatch(all, /SECRET-HUB-SUB-88|hubfile|hub\/\.env/);
});

test('CP-88-S6 the same junction nested inside a sub-repo leaks nothing either', () => {
  const root = workspace({ repos: { be: {}, hub: { path: 'be/hub' } }, scope: 'be/' });
  hubIntoSubdir(path.join(root, 'be', 'hub'));
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  const s = secrets(root);
  assert.equal(s.exitCode, 0, s.output);
  const all = `${r.output}\n${s.output}\n${briefOf(root)}`;
  assert.doesNotMatch(all, /SECRET-HUB-SUB-88|hubfile|hub\/\.env/);
});

test('CP-88-S7 a config name that differs in case from the folder still skips everything', () => {
  // Lần soi thứ ba: config khai `Hub`, thư mục là `hub`. So phân biệt hoa thường thì
  // bước bỏ qua không khớp và `.env` của git bên ngoài vào brief.
  assert.ok(isUnder('hub/.env', 'Hub', { fold: true }));
  assert.ok(!isUnder('hub/.env', 'Hub', { fold: false }));
  const root = workspace({ repos: { be: {}, Hub: {} }, ignoreAll: false });
  if (!fsFoldsCase(root)) return; // `Hub` và `hub` là hai thư mục khác nhau ở đây
  hubIntoSubdir(path.join(root, 'hub'));
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Bỏ qua repo "Hub"/);
  const s = secrets(root);
  const all = `${r.output}\n${s.output}\n${briefOf(root)}`;
  assert.doesNotMatch(all, /SECRET-HUB-SUB-88|hubfile/);
});

test('CP-88-S8 a .env the root git itself tracks under a skipped junction is still caught', () => {
  // Lần soi thứ ba: file git của gốc đã theo dõi là của nó, kể cả dưới junction.
  const root = workspace({ repos: { be: {}, hub: {} }, ignoreAll: false });
  hubIntoSubdir(path.join(root, 'hub'));
  git(root, ['add', '-f', 'hub/.env']);
  commit(root, 'lỡ commit');
  // Diff của git gốc rỗng: chỉ việc liệt kê index của nó mới thấy file đó.
  setSpec(root, { scope: 'be/a.js', head: 'Gốc soi: HEAD\n' });
  const s = secrets(root);
  assert.equal(s.exitCode, 1, s.output);
  assert.match(s.output, /hub\/\.env/);
});

test('CP-88-V4 Phạm vi naming a skipped repo in another case refuses it where case folds', () => {
  assert.ok(isUnder('Hub/h.js', 'hub', { fold: true }));
  const root = workspace({ repos: { be: {}, hub: {} }, scope: 'be/a.js, Hub/h.js' });
  if (!fsFoldsCase(root)) return;
  hubOutside(root);
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Repo "hub" có git nằm ngoài gốc Compass/);
});

test('CP-88-S9 Phạm vi naming the task\'s repo in another case keeps it in scope', () => {
  // Lần soi thứ tư: `BE/x.js` cho repo `be` từng làm be thành "ngoài Phạm vi", và
  // `secrets` chỉ còn đọc thay đổi chưa commit của nó.
  const root = workspace({ scope: 'BE/x.js' });
  if (!fsFoldsCase(root)) return; // `BE` và `be` là hai thư mục khác nhau ở đây
  const be = path.join(root, 'be');
  git(be, ['checkout', '-q', '-b', 'alpha']);
  put(be, 'x.js', readsEnv);
  commit(be, 'task');
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /be\/x\.js/);
});

// Thư mục phân biệt hoa thường, kể cả trên Windows (`fsutil ... setCaseSensitiveInfo`,
// không cần quyền admin). Trả null khi máy không làm được.
function caseSensitiveDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-cp88-cs-'));
  if (process.platform === 'win32') {
    try {
      execFileSync('fsutil.exe', ['file', 'setCaseSensitiveInfo', dir, 'enable'], { stdio: 'ignore' });
    } catch {
      return null;
    }
  }
  mkdirSync(path.join(dir, 'probe'));
  return existsSync(path.join(dir, 'PROBE')) ? null : dir;
}

test('CP-88-EC5 on a case-sensitive folder a skipped `hub` does not hide a real `Hub` folder', () => {
  // Lần soi thứ tư: gập hoa thường theo tên hệ điều hành thì trên ổ phân biệt hoa
  // thường, junction `hub` bị bỏ qua giấu luôn `Hub/.env` là file thật của gốc.
  const parent = caseSensitiveDir();
  if (!parent) return; // máy này không có thư mục phân biệt hoa thường
  const root = workspace({ repos: { be: {}, hub: {} }, ignoreAll: false, parent });
  assert.equal(fsFoldsCase(root), false);
  hubIntoSubdir(path.join(root, 'hub'));
  put(root, 'Hub/.env', 'X=1\n');
  // Dòng đọc `.env` chỉ diff mới thấy: danh sách file chỉ bắt chính file `.env`.
  put(root, 'Hub/y.js', readsEnv);
  const s = secrets(root);
  assert.equal(s.exitCode, 1, s.output);
  assert.match(s.output, /Hub\/\.env/);
  assert.match(s.output, /Hub\/y\.js/);
  assert.doesNotMatch(s.output, /hub\/\.env/);
});

test('CP-88-S10 Phạm vi written with ./ or doubled slashes keeps the task\'s repo in scope', () => {
  // Lần soi thứ năm: `./be/x.js` từng làm be thành "ngoài Phạm vi".
  for (const scope of ['./be/x.js', 'be//x.js', './/be/./x.js']) {
    const root = workspace({ scope });
    const be = path.join(root, 'be');
    git(be, ['checkout', '-q', '-b', 'alpha']);
    put(be, 'x.js', readsEnv);
    commit(be, 'task');
    const r = secrets(root);
    assert.equal(r.exitCode, 1, `${scope}\n${r.output}`);
    assert.match(r.output, /be\/x\.js/, scope);
  }
});

test('CP-88-EC6 Soi đến (be) narrows to a Phạm vi entry written with ./', () => {
  const root = workspace({ scope: './be/x.js' });
  const be = path.join(root, 'be');
  git(be, ['checkout', '-q', '-b', 'alpha']);
  put(be, 'x.js', 'export const x = 1\n');
  put(be, 'y.js', 'export const y = 1\n');
  const end = commit(be, 'task');
  put(be, 'z.js', 'export const z = 1\n');
  commit(be, 'sau');
  setSpec(root, { scope: './be/x.js', head: `Soi đến (be): ${end}\n` });
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  const brief = briefOf(root);
  const diff = brief.slice(brief.lastIndexOf('\n## Diff\n'));
  assert.match(diff, /a\/be\/x\.js/);
  assert.doesNotMatch(diff, /be\/y\.js|be\/z\.js/);
});

test('CP-88-E3 a skipped repo named with ./ in Phạm vi is refused, not skipped', () => {
  const root = workspace({ repos: { be: {}, hub: {} }, scope: 'be/a.js, ./hub/h.js' });
  hubOutside(root);
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Repo "hub" có git nằm ngoài gốc Compass/);
});

test('CP-88-V3 Gốc soi for a skipped repo says why it is skipped', () => {
  const root = workspace({ repos: { be: {}, hub: {} }, head: 'Gốc soi (hub): HEAD\n' });
  hubOutside(root);
  const r = review(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /`Gốc soi \(hub\):` — repo "hub" có git nằm ngoài gốc Compass/);
});

test('CP-88-S2 Phạm vi written as the repo path keeps the repo in scope for secrets', () => {
  const root = workspace({ repos: { be: {}, web: { path: 'apps/web' } }, scope: 'apps/web/x.js' });
  const web = path.join(root, 'apps', 'web');
  initGit(web);
  put(web, 'a.js', 'export const a = 1\n');
  commit(web, 'web');
  git(web, ['checkout', '-q', '-b', 'alpha']);
  put(web, 'x.js', readsEnv);
  commit(web, 'task');
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /apps\/web\/x\.js/);
});
