import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewCommand } from '../commands/review.mjs';
import { secretsCommand } from '../commands/secrets.mjs';

// CP-101 — issue #5. Git for Windows coi junction là thư mục thường, nên `ls-files
// --others` liệt kê từng file phía sau nó, và brief từng mang nguyên nội dung của file
// nằm ngoài repo. Trên Linux và macOS git liệt kê chính symlink, nên phần đo "git đi
// xuyên link" chỉ chạy được ở nơi git làm vậy; chỗ khác test in một dòng chẩn đoán.

const LINK = process.platform === 'win32' ? 'junction' : 'dir';
const OUTSIDE = 'OUTSIDE_CONTENT_101';

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

const SPEC = ({ scope, head }) => `# T-1: sửa b
Loại: fix
Phạm vi: ${scope}
${head}
## Mục tiêu
Thêm b.

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

// Thư mục ngoài repo, mỗi file một dòng nội dung mang dấu OUTSIDE.
function outsideDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-cp101-out-'));
  for (const [rel, body] of Object.entries(files)) put(dir, rel, body ?? `${OUTSIDE} ${rel}\n`);
  return dir;
}

// Repo một git: `src/a.js` đã commit, task thêm `src/b.js` (chưa commit).
function singleRepo({ change = true, tracked = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp101-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
  put(root, 'src/a.js', 'export function a() { return 1; }\n');
  for (const [rel, body] of Object.entries(tracked)) put(root, rel, body);
  const base = commit(root, 'base');
  if (change) put(root, 'src/b.js', 'export function b() { return 2; }\n');
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'src/', head: `Gốc soi: ${base}\n` }));
  return { root, base };
}

function review(cwd) {
  const r = reviewCommand({ cwd, taskId: 'T-1' });
  const briefFile = path.join(cwd, '.compass', 'T-1', 'review-brief.md');
  let brief = null;
  try { brief = readFileSync(briefFile, 'utf8'); } catch { /* chưa sinh */ }
  return { ...r, brief };
}

// Số file brief nói nó chứa, đọc từ dòng "Brief: … (N file, id)" của output.
function briefFiles(output) {
  const m = output.match(/\((\d+) file, [0-9a-f]+\)/);
  return m ? Number(m[1]) : null;
}

const linkNotes = (output) => output.split('\n').filter((l) => l.startsWith('ℹ') && /junction/.test(l));

// Git ở đây có đi xuyên link mà liệt kê file phía sau không (Windows: có; Linux, macOS: không).
const listsThrough = (root, dir) => git(root, ['ls-files', '--others', '--exclude-standard']).split('\n').some((f) => f.startsWith(`${dir}/`));

function section(brief, name) {
  const start = brief.indexOf(`### ${name}`);
  assert.ok(start >= 0, `không thấy mục ${name}`);
  const next = brief.indexOf('\n### ', start + 4);
  return brief.slice(start, next < 0 ? undefined : next);
}

// ---------------------------------------------------------------- Happy

test('CP-101-H1 an untracked file behind a junction to an outside folder stays out of the brief', (t) => {
  const { root } = singleRepo();
  symlinkSync(outsideDir({ 'notes/secret.txt': null }), path.join(root, 'linked'), LINK);
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.ok(!r.brief.includes(OUTSIDE), 'nội dung file ngoài repo lọt vào brief');
  assert.ok(!r.brief.includes('linked/notes/secret.txt'), 'file sau junction có tên trong brief');
  assert.match(r.brief, /^- src\/b\.js$/m);
  if (!listsThrough(root, 'linked')) {
    // Linux, macOS: git liệt kê chính symlink, diff chỉ chứa đường dẫn đích. Nó vẫn
    // phải vào brief: chỉ thư mục ở giữa đường dẫn mới bị kiểm, đoạn cuối thì không.
    t.diagnostic('git ở đây không đi xuyên link; phần "đúng 1 file" chỉ đo được trên Windows');
    assert.match(r.brief, /^- linked$/m);
    return;
  }
  assert.equal(briefFiles(r.output), 1, r.output);
});

test('CP-101-H2 review names the link directory once, and the brief is the one built without it', (t) => {
  const { root } = singleRepo();
  const before = review(root);
  assert.equal(before.exitCode, 1, before.output);
  assert.deepEqual(linkNotes(before.output), [], 'không có link mà vẫn có dòng ghi chú');

  const link = path.join(root, 'linked');
  symlinkSync(outsideDir({ 'notes/secret.txt': null }), link, LINK);
  const after = review(root);
  assert.equal(after.exitCode, 1, after.output);
  if (!listsThrough(root, 'linked')) {
    t.diagnostic('git ở đây không đi xuyên link; phần ghi chú chỉ đo được trên Windows');
    return;
  }
  assert.equal(after.brief, before.brief, 'brief đổi chỉ vì có junction');
  const notes = linkNotes(after.output);
  assert.equal(notes.length, 1, after.output);
  assert.match(notes[0], /`linked`/);
  assert.ok(!notes[0].includes('secret.txt'), 'ghi chú nêu tên file bên trong link');

  rmSync(link, { recursive: false, force: true });
  const gone = review(root);
  assert.deepEqual(linkNotes(gone.output), []);
});

test('CP-101-H3 a junction inside a sub-repo with its own git is filtered with the repo prefix', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp101-ws-'));
  initGit(root);
  put(root, '.gitignore', '/be/\n');
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { be: { test: 'true' } } }));
  const rootBase = commit(root, 'workspace');
  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'src/a.js', 'export function a() { return 1; }\n');
  const beBase = commit(be, 'base');
  put(be, 'src/x.js', 'export function x() { return 2; }\n');
  symlinkSync(outsideDir({
    'notes/secret.txt': null,
    'use.js': `import { x } from '../src/x.js';\nx(); // ${OUTSIDE}\n`,
  }), path.join(be, 'linked'), LINK);
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/', head: `Gốc soi: ${rootBase}\nGốc soi (be): ${beBase}\n` }));

  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.ok(!r.brief.includes(OUTSIDE), 'nội dung file ngoài repo lọt vào brief');
  assert.match(r.brief, /^- be\/src\/x\.js$/m);
  assert.ok(!r.brief.includes('be/linked/'), 'file sau junction của repo con có tên trong brief');
  assert.ok(!section(r.brief, 'impact').includes('use.js'), 'file sau junction của repo con được đọc làm nơi gọi');
  if (!listsThrough(be, 'linked')) {
    t.diagnostic('git ở đây không đi xuyên link; phần ghi chú chỉ đo được trên Windows');
    return;
  }
  const notes = linkNotes(r.output);
  assert.equal(notes.length, 1, r.output);
  assert.match(notes[0], /`be\/linked`/);
});

// ---------------------------------------------------------------- Validation

test('CP-101-V1 a tracked file behind the junction keeps its diff; an untracked sibling does not', (t) => {
  const out = outsideDir({ 'notes/kept.txt': 'kept v1\n' });
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp101-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
  put(root, 'src/a.js', 'export function a() { return 1; }\n');
  symlinkSync(out, path.join(root, 'linked'), LINK);
  const base = commit(root, 'base');
  if (!git(root, ['ls-files']).split('\n').includes('linked/notes/kept.txt')) {
    t.diagnostic('git ở đây theo dõi chính symlink, không theo dõi file phía sau; case này chỉ đo được trên Windows');
    return;
  }
  writeFileSync(path.join(out, 'notes', 'kept.txt'), 'kept v2\n');
  put(out, 'notes/new.txt', `${OUTSIDE} new\n`);
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'linked/', head: `Gốc soi: ${base}\n` }));

  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.brief, /^\+kept v2$/m, 'file đã theo dõi sau junction mất khỏi diff');
  assert.ok(!r.brief.includes(OUTSIDE), 'file chưa theo dõi cạnh nó lọt vào brief');
});

// ---------------------------------------------------------------- Error

test('CP-101-E1 a dangling junction neither breaks review nor adds a note', () => {
  const { root } = singleRepo();
  const out = outsideDir({ 'notes/secret.txt': null });
  symlinkSync(out, path.join(root, 'linked'), LINK);
  rmSync(out, { recursive: true, force: true });
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.brief, /^- src\/b\.js$/m);
  assert.deepEqual(linkNotes(r.output), []);
});

test('CP-101-E2 when the only change is behind the junction, review says there is nothing and why', (t) => {
  const { root } = singleRepo({ change: false });
  symlinkSync(outsideDir({ 'notes/secret.txt': null }), path.join(root, 'linked'), LINK);
  if (!listsThrough(root, 'linked')) {
    t.diagnostic('git ở đây không đi xuyên link; case này chỉ đo được trên Windows');
    return;
  }
  const r = review(root);
  assert.notEqual(r.exitCode, 0);
  assert.match(r.output, /0 file|Không có thay đổi nào để soi/);
  assert.ok(!r.output.includes(OUTSIDE));
  const notes = linkNotes(r.output);
  assert.equal(notes.length, 1, r.output);
  assert.match(notes[0], /`linked`/);
});

test('CP-101-E3 multi-repo: when every git is empty after the filter, the note still names the link', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp101-ws-'));
  initGit(root);
  put(root, '.gitignore', '/be/\n');
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { be: { test: 'true' } } }));
  const rootBase = commit(root, 'workspace');
  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'src/a.js', 'export function a() { return 1; }\n');
  const beBase = commit(be, 'base');
  symlinkSync(outsideDir({ 'notes/secret.txt': null }), path.join(be, 'linked'), LINK);
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'be/', head: `Gốc soi: ${rootBase}\nGốc soi (be): ${beBase}\n` }));
  if (!listsThrough(be, 'linked')) {
    t.diagnostic('git ở đây không đi xuyên link; case này chỉ đo được trên Windows');
    return;
  }
  const r = review(root);
  assert.notEqual(r.exitCode, 0);
  assert.match(r.output, /Không có thay đổi nào để soi, ở git nào/);
  assert.ok(!r.output.includes(OUTSIDE));
  const notes = linkNotes(r.output);
  assert.equal(notes.length, 1, r.output);
  assert.match(notes[0], /`be\/linked`/);
});

// ---------------------------------------------------------------- Edge

test('CP-101-EC1 a Compass root reached through a junction path still sees its own new files', () => {
  const { root } = singleRepo();
  const alias = path.join(mkdtempSync(path.join(tmpdir(), 'compass-cp101-alias-')), 'repo');
  symlinkSync(root, alias, LINK);
  const r = review(alias);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.brief, /^- src\/b\.js$/m);
  assert.deepEqual(linkNotes(r.output), []);
});

test('CP-101-EC2 a nested junction drops every file under it and is named once', (t) => {
  const { root } = singleRepo();
  mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
  symlinkSync(outsideDir({ 'x.txt': null, 'd1/y.txt': null, 'd1/d2/z.txt': null }), path.join(root, 'a', 'b', 'linked'), LINK);
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.ok(!r.brief.includes(OUTSIDE), 'nội dung file ngoài repo lọt vào brief');
  assert.ok(!r.brief.includes('a/b/linked/'));
  if (!listsThrough(root, 'a/b/linked')) {
    t.diagnostic('git ở đây không đi xuyên link; phần ghi chú chỉ đo được trên Windows');
    return;
  }
  const notes = linkNotes(r.output);
  assert.equal(notes.length, 1, r.output);
  assert.equal(notes[0].split('a/b/linked').length - 1, 1, notes[0]);
});

test('CP-101-EC3 a junction inside a .compass path declared in Phạm vi is filtered too', (t) => {
  const { root, base } = singleRepo({ tracked: { '.compass/scripts/run.mjs': 'console.log(1);\n' } });
  put(root, '.compass/scripts/new.mjs', 'console.log(2);\n');
  symlinkSync(outsideDir({ 'lib.mjs': null }), path.join(root, '.compass', 'scripts', 'vendor'), LINK);
  put(root, '.compass/T-1/spec.md', SPEC({ scope: 'src/, .compass/scripts/', head: `Gốc soi: ${base}\n` }));
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.brief, /^- \.compass\/scripts\/new\.mjs$/m);
  assert.ok(!r.brief.includes(OUTSIDE), 'nội dung file ngoài repo lọt vào brief');
  if (!git(root, ['ls-files', '--others', '--', '.compass/scripts/']).split('\n').some((f) => f.startsWith('.compass/scripts/vendor/'))) {
    t.diagnostic('git ở đây không đi xuyên link; phần ghi chú chỉ đo được trên Windows');
    return;
  }
  const notes = linkNotes(r.output);
  assert.equal(notes.length, 1, r.output);
  assert.match(notes[0], /`\.compass\/scripts\/vendor`/);
});

// ---------------------------------------------------------------- Security

test('CP-101-S1 an unignored .env behind the junction is still caught by secrets, never quoted', (t) => {
  const { root } = singleRepo();
  symlinkSync(outsideDir({ '.env': `DB_PASSWORD=${OUTSIDE}\n` }), path.join(root, 'linked'), LINK);
  if (!listsThrough(root, 'linked')) {
    t.diagnostic('git ở đây không đi xuyên link; case này chỉ đo được trên Windows');
    return;
  }
  const s = secretsCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(s.exitCode, 0, s.output);
  assert.match(s.output, /linked\/\.env/);
  assert.ok(!s.output.includes(OUTSIDE), 'secrets in nội dung .env');
  const r = review(root);
  assert.ok(!r.brief.includes(OUTSIDE), 'nội dung .env lọt vào brief');
});

test('CP-101-S2 a file behind the junction is not read as a caller in the impact section', () => {
  const { root } = singleRepo();
  symlinkSync(outsideDir({ 'use.js': `import { b } from '../src/b.js';\nb(); // ${OUTSIDE}\n` }), path.join(root, 'linked'), LINK);
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  const impact = section(r.brief, 'impact');
  assert.ok(!impact.includes('linked/use.js'), impact);
  assert.ok(!r.brief.includes(OUTSIDE));
});
