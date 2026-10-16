// CP-60 — gate không đi vào worktree liên kết nằm trong repo.
//
// Claude Code chạy agent ở `.claude/worktrees/<tên>/`, ngay trong repo. Mỗi thư
// mục đó là một bản checkout đầy đủ, và trước bản sửa này ba bộ duyệt cây
// (`scanComponents`, `runRules`, `hashSource`) đi thẳng vào đó, còn `collectDiff`
// thì `add -N` nó thành một gitlink. Mọi fixture ở đây dựng worktree thật bằng
// `git worktree add` — worktree giả bằng tay thì không đo được thứ git ghi ra đĩa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { knowledgeCommand } from '../commands/knowledge.mjs';
import { conventionCommand } from '../commands/convention.mjs';
import { secretsCommand } from '../commands/secrets.mjs';
import { readGate } from '../lib/gate-store.mjs';
import { scanComponents } from '../lib/knowledge-scan.mjs';
import { runRules } from '../lib/rule-runner.mjs';
import { parseRules } from '../lib/rule-parser.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { collectDiff } from '../lib/review-brief.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { initRepo } from './helpers/git-repo.mjs';

// Giá trị HEAD (a369838) tính cho đúng hai file này. Cây không có worktree phải
// giữ nguyên nó, nếu không mọi bản ghi gate viết trước bản sửa đều hoá cũ.
const FIXED_HASH = 'sha256:dceccdfb18c073cfb213b9dc8fffb003d92c2b539741d23254d676e653fde46c';
const APP = 'export function Button({ label }) { return label; }\n';
const A_JS = 'export const a = 1;\n';

const CONVENTIONS = [
  '## Không để debugger',
  '',
  '```rule',
  'id: no-debugger',
  'type: forbid-pattern',
  'pattern: debugger',
  'scope: "**/*.js"',
  'severity: error',
  '```',
  '',
].join('\n');
const RULES = parseRules(CONVENTIONS).rules;

const specText = ({ base = null, scope = 'src/' } = {}) => [
  '# T-1: Worktree trong repo',
  'Loại: bug',
  ...(base ? [`Gốc soi: ${base}`] : []),
  `Phạm vi: ${scope}`,
  '',
  '## Mục tiêu', 'Làm gì đó.', '',
  '## Ràng buộc', 'Không có.', '',
  '## Rủi ro hồi quy', 'Không có.', '',
  '## Test cases',
  '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
  '|----|-----|-------|---------|---------|',
  '| H1 | Happy | Case một | Đúng | P0 |',
  '',
].join('\n');

const dirs = [];

test.after(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function tempDir(prefix) {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const posix = (p) => p.split(path.sep).join('/');

// Repo nháp như lúc đo trên HEAD: `src/App.jsx` (Button), `src/a.js`, luật cấm
// `debugger` cho `**/*.js`, `.knowledge/` đã sync. Mọi thứ đã commit, nên
// `git worktree add` sau đó chép ra một bản checkout đầy đủ.
function makeScratch({ files = {}, knowledge = true } = {}) {
  const root = initRepo(tempDir('compass-cp60-'));
  write(root, '.compass/config.json', JSON.stringify({ test: 'node -e 0' }));
  write(root, '.knowledge/decided/conventions.md', CONVENTIONS);
  write(root, 'src/App.jsx', APP);
  write(root, 'src/a.js', A_JS);
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'work');
  const base = git(root, 'rev-parse', 'HEAD').trim();
  write(root, '.compass/T-1/spec.md', specText({ base }));
  if (knowledge) assert.equal(knowledgeCommand({ cwd: root, sync: true }).exitCode, 0);
  return { root, base };
}

function addWorktree(repo, rel, branch) {
  git(repo, 'worktree', 'add', '-q', '-b', branch, rel);
  const wt = path.join(repo, rel);
  assert.ok(statSync(path.join(wt, '.git')).isFile(), 'worktree liên kết có .git là file');
  return wt;
}

test('CP-60-H1 a linked worktree under .claude/worktrees leaves the knowledge gate green', () => {
  const { root } = makeScratch();
  const wt = addWorktree(root, '.claude/worktrees/agent-x', 'agent-x');
  write(wt, 'src/Extra.jsx', 'export function Extra({ y }) { return y; }\n');

  const result = knowledgeCommand({ cwd: root });
  assert.equal(result.exitCode, 0, result.output);

  const scan = scanComponents(root);
  assert.deepEqual(scan.files.filter((f) => f.startsWith('.claude/worktrees/')), []);
  assert.equal(scan.components.Button.path, 'src/App.jsx');
  assert.equal(scan.components.Extra, undefined);
});

test('CP-60-H2 convention ignores a debugger line inside the worktree, not one in the project', () => {
  const { root } = makeScratch();
  const wt = addWorktree(root, '.claude/worktrees/agent-x', 'agent-x');
  write(wt, 'src/agent.js', 'debugger;\n');

  const first = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(first.exitCode, 0, first.output);

  write(root, 'src/b.js', 'debugger;\n');
  const second = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(second.exitCode, 1, second.output);
  assert.match(second.output, /src[\\/]b\.js:1/);
  assert.deepEqual(second.output.split(/\r?\n/).filter((l) => l.includes('worktrees')), []);
});

test('CP-60-H3 hashSource keeps the HEAD value and ignores the worktree, but sees the project', () => {
  const root = initRepo(tempDir('compass-cp60h-'));
  write(root, 'src/App.jsx', APP);
  write(root, 'src/a.js', A_JS);
  assert.equal(hashSource(root), FIXED_HASH, 'cây không có worktree giữ đúng giá trị HEAD');

  write(root, '.compass/config.json', JSON.stringify({ test: 'node -e 0' }));
  write(root, '.compass/T-1/spec.md', specText());
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'work');
  const wt = addWorktree(root, '.claude/worktrees/agent-x', 'agent-x');
  assert.equal(hashSource(root), FIXED_HASH, 'thêm worktree không đổi hash');

  write(wt, 'src/a.js', 'export const a = 2;\n');
  write(wt, 'src/agent.js', 'debugger;\n');
  assert.equal(hashSource(root), FIXED_HASH, 'sửa trong worktree không đổi hash');

  // Tầng lệnh: bản ghi mà `done` sẽ so lấy đúng hash đó.
  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  const record = readGate(root, 'T-1', 'knowledge');
  assert.equal(record.sourceHash, hashSource(root));
  assert.equal(record.sourceHash, FIXED_HASH);

  write(root, 'src/a.js', 'export const a = 3;\n');
  assert.notEqual(hashSource(root), FIXED_HASH, 'sửa code của dự án thì hash đổi');
});

test('CP-60-H4 collectDiff keeps new files and drops the worktree gitlink, real index untouched', () => {
  const { root, base } = makeScratch();
  addWorktree(root, '.claude/worktrees/agent-x', 'agent-x');
  write(root, 'src/new.js', 'export const n = 1;\n');

  // Sanity: git thấy worktree là một thư mục lồng, đúng thứ bộ lọc phải xử lý.
  assert.ok(git(root, 'ls-files', '--others', '--exclude-standard').split('\n').includes('.claude/worktrees/agent-x/'));

  const indexFile = path.join(root, '.git', 'index');
  const before = readFileSync(indexFile);
  const result = collectDiff(root, { baseRef: base, baseFrom: 'spec' });
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.files.includes('src/new.js'), JSON.stringify(result.files));
  assert.ok(!result.files.some((f) => f.startsWith('.claude/worktrees/agent-x')), JSON.stringify(result.files));
  assert.ok(!result.diff.includes('Subproject commit'));
  assert.ok(!result.diff.includes('160000'));
  assert.deepEqual(readFileSync(indexFile), before);
});

test('CP-60-V1 a submodule is still scanned and hashed, as on HEAD', () => {
  const { root } = makeScratch({ knowledge: false });
  const lib = initRepo(tempDir('compass-cp60lib-'));
  write(lib, 'Widget.jsx', 'export function Widget({ x }) { return x; }\n');
  git(lib, 'add', '-A');
  git(lib, 'commit', '-q', '-m', 'lib');
  git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', posix(lib), 'vendor/lib');

  // Fixture phải tới được predicate: `.git` là file, nhưng thư mục quản trị không có `commondir`.
  const sub = path.join(root, 'vendor', 'lib');
  const dotGit = readFileSync(path.join(sub, '.git'), 'utf8');
  assert.match(dotGit, /^gitdir: /);
  const admin = path.resolve(sub, dotGit.split(/\r?\n/)[0].slice('gitdir: '.length).trim());
  assert.ok(existsSync(admin) && !existsSync(path.join(admin, 'commondir')));

  assert.ok(scanComponents(root).files.includes('vendor/lib/Widget.jsx'));
  const before = hashSource(root);
  write(sub, 'Widget.jsx', 'export function Widget({ x, y }) { return x + y; }\n');
  assert.notEqual(hashSource(root), before);
});

test('CP-60-V2 a nested repo with a .git directory stays in every gate', () => {
  const root = initRepo(tempDir('compass-cp60mr-'));
  write(root, '.compass/config.json', JSON.stringify({ test: 'node -e 0', repos: { 'store/backend': {} } }));
  write(root, '.compass/T-1/spec.md', specText({ scope: 'store/backend' }));
  write(root, '.knowledge/decided/conventions.md', CONVENTIONS);
  const backend = path.join(root, 'store', 'backend');
  mkdirSync(backend, { recursive: true });
  git(backend, 'init', '-q');
  assert.ok(statSync(path.join(backend, '.git')).isDirectory());
  write(backend, 'src/api.js', 'debugger;\n');
  write(backend, 'src/Card.jsx', 'export function Card({ a }) { return a; }\n');

  const conv = conventionCommand({ cwd: root, taskId: 'T-1', repo: 'store/backend', gateRoot: root });
  assert.equal(conv.exitCode, 1, conv.output);
  assert.match(conv.output, /store[\\/]backend[\\/]src[\\/]api\.js:1/);
  assert.equal(readGate(root, 'T-1', 'convention', 'store/backend').exitCode, 1);

  assert.ok(scanComponents(root).files.includes('store/backend/src/Card.jsx'));
  const before = hashSource(root);
  write(backend, 'src/Card.jsx', 'export function Card({ a, b }) { return a + b; }\n');
  assert.notEqual(hashSource(root), before);
});

test('CP-60-V3 a worktree outside .claude is skipped too: the rule follows structure, not a name', () => {
  const { root, base } = makeScratch();
  const before = hashSource(root);
  const wt = addWorktree(root, '.worktrees/feature', 'feature');
  write(wt, 'src/Feature.jsx', 'export function Feature({ f }) { return f; }\n');
  write(wt, 'src/feature.js', 'debugger;\n');

  assert.deepEqual(scanComponents(root).files.filter((f) => f.startsWith('.worktrees/')), []);
  assert.deepEqual(runRules(root, RULES).violations, []);
  assert.equal(hashSource(root), before);

  const diff = collectDiff(root, { baseRef: base, baseFrom: 'spec' });
  // Không còn gì ngoài worktree, nên diff rỗng là đúng; gitlink mà lọt vào thì có diff.
  const files = diff.ok ? diff.files : [];
  assert.ok(diff.ok || diff.ly_do === 'empty', diff.reason);
  assert.ok(!files.some((f) => f.startsWith('.worktrees/')), JSON.stringify(files));
});

test('CP-60-E1 a .git file without a gitdir line is scanned, not skipped, and nothing throws', () => {
  const { root } = makeScratch();
  write(root, 'odd/.git', 'hello\n');
  write(root, 'odd/x.js', 'debugger;\n');
  write(root, 'odd/Odd.jsx', 'export function Odd({ o }) { return o; }\n');

  const conv = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(conv.exitCode, 1, conv.output);
  assert.match(conv.output, /odd[\\/]x\.js:1/);
  assert.ok(scanComponents(root).files.includes('odd/x.js'));
  const before = hashSource(root);
  write(root, 'odd/x.js', 'debugger; // đổi\n');
  assert.notEqual(hashSource(root), before);
});

test('CP-60-E2 an orphaned worktree is scanned by all three walkers and its .env is named by secrets', () => {
  const { root } = makeScratch();
  const wt = addWorktree(root, '.claude/worktrees/agent-y', 'agent-y');
  write(wt, 'src/o.js', 'debugger;\n');
  write(wt, '.env', 'SECRET=1\n');
  rmSync(path.join(root, '.git', 'worktrees', 'agent-y'), { recursive: true, force: true });

  assert.ok(scanComponents(root).files.includes('.claude/worktrees/agent-y/src/App.jsx'));
  const hits = runRules(root, RULES).violations.map((v) => posix(v.file));
  assert.ok(hits.includes('.claude/worktrees/agent-y/src/o.js'), JSON.stringify(hits));
  const before = hashSource(root);
  write(wt, 'src/o.js', 'debugger; // đổi\n');
  assert.notEqual(hashSource(root), before);

  const sec = secretsCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(sec.exitCode, 1, sec.output);
  assert.match(sec.output, /secret file not ignored: \.claude\/worktrees\/agent-y\/\.env/);
});

test('CP-60-EC1 Compass run inside the worktree itself scans its own code', () => {
  const main = initRepo(tempDir('compass-cp60main-'));
  write(main, 'src/App.jsx', APP);
  write(main, 'src/a.js', 'debugger;\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'work');
  const wt = path.join(tempDir('compass-cp60wt-'), 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'agent-z', posix(wt));
  assert.ok(statSync(path.join(wt, '.git')).isFile(), 'gốc là worktree liên kết');

  assert.ok(scanComponents(wt).files.includes('src/App.jsx'));
  const hits = runRules(wt, RULES).violations.map((v) => posix(v.file));
  assert.deepEqual(hits, ['src/a.js']);
  const before = hashSource(wt);
  write(wt, 'src/App.jsx', 'export function Button({ label, x }) { return label; }\n');
  assert.notEqual(hashSource(wt), before);
});

test('CP-60-EC2 a worktree inside a declared repo is skipped by convention and the knowledge scan', () => {
  const root = initRepo(tempDir('compass-cp60fe-'));
  write(root, '.compass/config.json', JSON.stringify({ test: 'node -e 0', repos: { fe: {} } }));
  write(root, '.compass/T-1/spec.md', specText({ scope: 'fe/src' }));
  write(root, '.knowledge/decided/conventions.md', CONVENTIONS);
  const fe = path.join(root, 'fe');
  mkdirSync(fe, { recursive: true });
  initRepo(fe);
  write(fe, 'src/App.jsx', APP);
  write(fe, 'src/a.js', A_JS);
  git(fe, 'add', '-A');
  git(fe, 'commit', '-q', '-m', 'fe');
  const wt = addWorktree(fe, '.claude/worktrees/x', 'x');
  write(wt, 'src/x.js', 'debugger;\n');
  write(wt, 'src/X.jsx', 'export function X({ q }) { return q; }\n');

  const conv = conventionCommand({ cwd: root, taskId: 'T-1', repo: 'fe', gateRoot: root });
  assert.equal(conv.exitCode, 0, conv.output);
  assert.ok(!conv.output.includes('worktrees'), conv.output);
  assert.equal(readGate(root, 'T-1', 'convention', 'fe').exitCode, 0);

  const files = scanComponents(root).files;
  assert.ok(files.includes('fe/src/App.jsx'));
  assert.deepEqual(files.filter((f) => f.startsWith('fe/.claude/')), []);
});

test('CP-60-EC3 a plain folder under .claude/worktrees without .git is scanned and its .env reported', () => {
  const { root } = makeScratch();
  write(root, '.claude/worktrees/notes/notes.js', 'debugger;\n');
  write(root, '.claude/worktrees/notes/.env', 'SECRET=1\n');

  const conv = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(conv.exitCode, 1, conv.output);
  assert.match(conv.output, /\.claude[\\/]worktrees[\\/]notes[\\/]notes\.js:1/);

  const sec = secretsCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(sec.exitCode, 1, sec.output);
  assert.match(sec.output, /secret file not ignored: \.claude\/worktrees\/notes\/\.env/);
});

test('CP-60-EC4 an untracked .env inside a live worktree stays unreported by secrets', () => {
  const { root } = makeScratch();
  const wt = addWorktree(root, '.claude/worktrees/agent-x', 'agent-x');
  write(wt, '.env', 'SECRET=1\n');

  const sec = secretsCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(sec.exitCode, 0, sec.output);
  assert.ok(!sec.output.includes('.claude/worktrees/agent-x/.env'), sec.output);
});

test('CP-60-EC5 a manifest synced with worktree paths goes red once under "Đã xóa", then green after --sync', () => {
  const { root } = makeScratch();
  addWorktree(root, '.claude/worktrees/agent-x', 'agent-x');
  // Trạng thái một lần sync trên HEAD để lại khi worktree còn đó.
  const stale = [
    ...scanComponents(root).files,
    '.claude/worktrees/agent-x/src/App.jsx',
    '.claude/worktrees/agent-x/src/a.js',
  ];
  writeFileSync(
    path.join(root, '.knowledge', 'derived', '.manifest'),
    JSON.stringify(buildManifest(root, stale), null, 2) + '\n',
  );

  const red = knowledgeCommand({ cwd: root });
  assert.equal(red.exitCode, 1, red.output);
  assert.match(red.output, /Đã xóa \(2\): \.claude\/worktrees\/agent-x\/src\/App\.jsx, \.claude\/worktrees\/agent-x\/src\/a\.js/);

  assert.equal(knowledgeCommand({ cwd: root, sync: true }).exitCode, 0);
  const green = knowledgeCommand({ cwd: root });
  assert.equal(green.exitCode, 0, green.output);
});

test('CP-60-EC6 three full worktrees add nothing to the knowledge scan', () => {
  const { root } = makeScratch();
  const count = scanComponents(root).files.length;
  for (const name of ['agent-1', 'agent-2', 'agent-3']) {
    addWorktree(root, `.claude/worktrees/${name}`, name);
  }

  assert.equal(scanComponents(root).files.length, count);
  const result = knowledgeCommand({ cwd: root });
  assert.equal(result.exitCode, 0, result.output);
});
