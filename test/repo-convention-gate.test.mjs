import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { conventionCommand, conventionDraftCommand, conventionApproveCommand } from '../commands/convention.mjs';
import { checkCommand } from '../commands/check.mjs';
import { testCommand } from '../commands/test.mjs';
import { doneCommand } from '../commands/done.mjs';
import { initCommand } from '../commands/init.mjs';
import { statusCommand } from '../commands/status.mjs';
import { knowledgeCommand } from '../commands/knowledge.mjs';
import { readGate } from '../lib/gate-store.mjs';
import { gatePath } from '../lib/paths.mjs';
import { rulesTouching } from '../lib/rule-runner.mjs';
import { measureGrowth, assertLinear } from './helpers/growth.mjs';

// CP-103 — issue #6. Ở workspace nhiều repo, gate `convention` chạy luật của gốc (về
// `.compass/scripts`) trên code của repo con và ghi xanh, trong khi repo con chưa có
// convention nào. Test dựng workspace thật trong thư mục tạm: gốc có git riêng, mỗi repo
// con có git riêng, như bố cục của issue.

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const LINK = process.platform === 'win32' ? 'junction' : 'dir';

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

function commit(dir, message = 'base') {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
}

const ruleBlock = ({ id, pattern, scope, severity = 'error' }) => [
  '```rule', `id: ${id}`, 'type: forbid-pattern', `pattern: "${pattern}"`, `scope: ${scope}`, `severity: ${severity}`, '```', '',
].join('\n');

// Luật ở gốc của workspace trong issue: chỉ nói về `.compass/scripts`.
const SCRIPTS_RULES = `# Quy ước của workspace\n\n${ruleBlock({ id: 'scripts-no-console-error', pattern: 'console\\.error', scope: '.compass/scripts/**', severity: 'warn' })}`;
const NO_LOG = ruleBlock({ id: 'no-console-log', pattern: 'console\\.log', scope: 'src/**' });

const OK_TESTS = 'node -e "console.log(\'ok 1 - T-1-H1 x\'); console.log(\'ok 2 - T-1-H2 x\')"';

const SPEC = ({ type = 'fix', scope = 'be/' } = {}) => `# T-1: sửa be
Loại: ${type}
Phạm vi: ${scope}

## Mục tiêu
Sửa be.

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

const BE_FILES = {
  'src/a.ts': 'export function a() {\n  return 1;\n}\n',
  'src/b.ts': 'export function b() {\n  return 2;\n}\n',
  'test/a.test.ts': "import { a } from '../src/a';\n",
};

// Workspace: gốc có git (bỏ qua thư mục repo con), mỗi repo con có git riêng.
//   repos   — tên repo → file của nó (`null` = khai trong config mà không có thư mục)
//   own     — tên repo → nội dung `conventions/<repo>.md`
function workspace({ repos = { be: BE_FILES }, own = {}, rootRules = SCRIPTS_RULES, type = 'fix', scope = 'be/', extra = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp103-'));
  initGit(root);
  const names = Object.keys(repos);
  put(root, '.gitignore', names.map((n) => `/${n}/`).join('\n') + '\n');
  put(root, '.compass/config.json', JSON.stringify({ test: OK_TESTS, repos: Object.fromEntries(names.map((n) => [n, { test: OK_TESTS }])) }));
  if (rootRules !== null) put(root, '.knowledge/decided/conventions.md', rootRules);
  for (const [name, body] of Object.entries(own)) put(root, `.knowledge/decided/conventions/${name}.md`, body);
  for (const [rel, body] of Object.entries(extra)) put(root, rel, body);
  commit(root, 'workspace');
  for (const [name, files] of Object.entries(repos)) {
    if (files === null) continue;
    const dir = path.join(root, name);
    initGit(dir);
    for (const [rel, body] of Object.entries(files)) put(dir, rel, body);
    commit(dir);
  }
  put(root, '.compass/T-1/spec.md', SPEC({ type, scope }));
  return root;
}

const gate = (root, extra = {}) => conventionCommand({ cwd: root, taskId: 'T-1', ...extra });
const draftPath = (root, repo = 'be') => path.join(root, '.compass', 'conventions-draft', `${repo}.md`);
const ownPath = (root, repo = 'be') => path.join(root, '.knowledge', 'decided', 'conventions', `${repo}.md`);

// Điền bản nháp như agent sẽ điền: mỗi tiêu chí một câu kèm bằng chứng. `skip`: số tiêu
// chí để nguyên dấu chờ; `answer(n)`: câu trả lời; `decide`: đánh dấu mọi `- [ ]` là đã quyết.
function fillDraft(text, { skip = [], answer = () => 'Theo `src/a.ts`.', decide = true } = {}) {
  let cur = null;
  return text.split('\n').map((line) => {
    const m = /^### (\d+)\. /.exec(line);
    if (m) cur = Number(m[1]);
    else if (/^### /.test(line)) cur = null;
    if (cur !== null && line.includes('compass-fill') && !skip.includes(cur)) return answer(cur);
    if (decide && /^\s*- \[ \]/.test(line)) return line.replace('- [ ]', '- [x]');
    return line;
  }).join('\n');
}

function draftAndFill(root, repo = 'be', opts = {}) {
  const d = conventionDraftCommand({ cwd: root, repo });
  assert.equal(d.exitCode, 0, d.output);
  const filled = fillDraft(readFileSync(draftPath(root, repo), 'utf8'), opts);
  writeFileSync(draftPath(root, repo), filled);
  return filled;
}

// ---------------------------------------------------------------- Happy

test('CP-103-H1 the gate runs the repo\'s own rules on its code', () => {
  const root = workspace({
    repos: { be: { ...BE_FILES, 'src/a.ts': 'export function a() {\n  console.log(1);\n}\n' } },
    own: { be: `# be\n\n${NO_LOG}` },
  });
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /be[\\/]src[\\/]a\.ts:2/);
  assert.match(r.output, /no-console-log/);
  assert.equal(readGate(root, 'T-1', 'convention', 'be').exitCode, 1);
});

test('CP-103-H2 a root rule aimed at a repo stops the gate and says where to move it', () => {
  const root = workspace({
    repos: { be: { ...BE_FILES, 'src/a.ts': 'export function a() {\n  console.log(1);\n}\n' } },
    rootRules: `# gốc\n\n${ruleBlock({ id: 'be-no-log', pattern: 'console\\.log', scope: 'be/src/**' })}`,
    own: { be: '# be\n\nViết tay, chưa có luật.\n' },
  });
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /`be-no-log`/);
  assert.match(r.output, /\.knowledge\/decided\/conventions\/be\.md/);
  assert.doesNotMatch(r.output, /vi phạm mức error/, 'luật của gốc không được chạy trên be');
});

test('CP-103-H3 a repo in Phạm vi without its own convention turns the gate red', () => {
  const root = workspace({ type: 'feature-m' });
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Repo `be` chưa có convention đã duyệt/);
  assert.match(r.output, /compass convention --draft --repo=be/);
  assert.match(r.output, /compass convention --approve --repo=be/);
  assert.match(r.output, /DỪNG và hỏi người dùng/);
  assert.equal(readGate(root, 'T-1', 'convention', 'be').exitCode, 1);
});

test('CP-103-H4 a fix task is stopped the same way by check', async () => {
  const root = workspace({ type: 'fix' });
  assert.equal(knowledgeCommand({ cwd: root, sync: true }).exitCode, 0);
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /\[be\] ✗ Gate convention FAILED/);
  assert.match(r.output, /Repo `be` chưa có convention đã duyệt/);
});

test('CP-103-H5 init names each repo without its own convention', () => {
  const root = workspace({ repos: { be: BE_FILES, fe: BE_FILES, ops: BE_FILES }, own: { ops: '# ops\n' } });
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'fix' });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /Repo `be` chưa có convention đã duyệt.*--repo=be/);
  assert.match(r.output, /Repo `fe` chưa có convention đã duyệt.*--repo=fe/);
  assert.doesNotMatch(r.output, /Repo `ops`/);
});

test('CP-103-H6 the repo draft carries the 12 criteria, each waiting, with real sample files', () => {
  const root = workspace();
  assert.equal(conventionDraftCommand({ cwd: root, repo: 'be' }).exitCode, 0);
  const text = readFileSync(draftPath(root), 'utf8');
  const at = text.indexOf('## Agent đọc và viết');
  assert.ok(at > 0, 'thiếu mục Agent đọc và viết');
  const section = text.slice(at, text.indexOf('\n## ', at + 5));
  const heads = [...section.matchAll(/^### (\d+)\. (.+)$/gm)].map((m) => Number(m[1]));
  assert.deepEqual(heads, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(section.split('compass-fill').length - 1, 12 + 2, 'mỗi tiêu chí một dấu chờ, cộng hai lần trong lời dặn');
  const samples = [...section.slice(section.indexOf('### File mẫu cần đọc'), section.indexOf('### 1.')).matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
  assert.ok(samples.length > 0, 'không có file mẫu');
  for (const f of samples) assert.ok(existsSync(path.join(root, 'be', f)), `${f} không có trong be`);
});

test('CP-103-H7 a filled draft is approved into place and the gate goes green', () => {
  const root = workspace();
  const filled = draftAndFill(root);
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(readFileSync(ownPath(root), 'utf8'), filled);
  assert.doesNotMatch(r.output, /knowledge --sync/, '.knowledge/ có sẵn thì không cần nhắc');
  const g = gate(root);
  assert.equal(g.exitCode, 0, g.output);
  assert.equal(readGate(root, 'T-1', 'convention', 'be').exitCode, 0);

  // Bằng chứng chỉ xét lúc duyệt: task sau xóa file từng được trích không làm gate đỏ.
  rmSync(path.join(root, 'be', 'src', 'a.ts'));
  assert.equal(gate(root).exitCode, 0);
});

test('CP-103-H8 a declared repo missing from disk and outside Phạm vi is skipped with a note', async () => {
  const root = workspace({ repos: { be: BE_FILES, x: null }, own: { be: '# be\n' } });
  const s = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(s.exitCode, 0, s.output);
  assert.match(s.output, /ℹ Bỏ qua repo "x"/);
  assert.equal(knowledgeCommand({ cwd: root, sync: true }).exitCode, 0);
  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(c.exitCode, 0, c.output);
  assert.match(c.output, /ℹ Bỏ qua repo "x": không tìm thấy thư mục x/);
  const d = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(d.exitCode, 0, d.output);
  assert.match(d.output, /ℹ Bỏ qua repo "x"/);
  const t = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(t.exitCode, 0, t.output);
  assert.match(t.output, /ℹ Bỏ qua repo "x"/);
});

test('CP-103-H9 a single-repo project without conventions.md still passes, fix and feature-s alike', () => {
  for (const type of ['fix', 'feature-s']) {
    const root = mkdtempSync(path.join(tmpdir(), 'compass-cp103-one-'));
    initGit(root);
    put(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
    put(root, 'src/a.ts', 'export const a = 1;\n');
    put(root, '.compass/T-1/spec.md', SPEC({ type, scope: 'src/' }));
    commit(root);
    const r = gate(root);
    assert.equal(r.exitCode, 0, `${type}: ${r.output}`);
    assert.match(r.output, /chưa có luật nào để kiểm tra/);
  }
});

test('CP-103-H10 a hand-written own convention without the agent section runs as is', () => {
  const root = workspace({ own: { be: `# Quy ước của be\n\nViết tay từ trước.\n\n${NO_LOG}` } });
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /1 luật, \d+ file, không vi phạm/);
  assert.ok(readGate(root, 'T-1', 'convention', 'be').scanned > 0);
});

// ---------------------------------------------------------------- Validation

test('CP-103-V1 approve refuses while criteria are unanswered', () => {
  const root = workspace();
  draftAndFill(root, 'be', { skip: [3, 7] });
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Chưa trả lời \(còn dòng compass-fill\): 3\. Cấu trúc thư mục, 7\. Lỗi và log\./);
  assert.ok(!existsSync(ownPath(root)), 'không được ghi file đã duyệt');

  // Một tiêu chí bị xóa mất heading cũng không qua được.
  const full = fillDraft(readFileSync(draftPath(root), 'utf8'));
  writeFileSync(draftPath(root), full.replace('### 12. Comment và tài liệu\n', ''));
  const gone = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(gone.exitCode, 1, gone.output);
  assert.match(gone.output, /Thiếu tiêu chí: 12\. Comment và tài liệu\./);

  // Heading lặp lại: dòng chờ điền ở lần xuất hiện nào cũng bị thấy.
  writeFileSync(draftPath(root), full.replace('### 5. Import', '### 4. Phụ thuộc giữa các lớp\n\n> Chờ điền (compass-fill).\n\n### 5. Import'));
  const twice = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(twice.exitCode, 1, twice.output);
  assert.match(twice.output, /Chưa trả lời \(còn dòng compass-fill\): 4\. Phụ thuộc giữa các lớp\./);
});

test('CP-103-V2 approve refuses while an item waits for the person', () => {
  const root = workspace();
  const filled = draftAndFill(root);
  writeFileSync(draftPath(root), `${filled}\n- [ ] Dùng tab hay dấu cách cho file SQL?\n`);
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /- \[ \] Dùng tab hay dấu cách cho file SQL\?/);
  assert.ok(!existsSync(ownPath(root)));

  // Kiểu viết lẫn lộn mà máy đếm ra cũng thành dòng chờ người quyết trong bản nháp một repo.
  const mixed = {};
  for (let i = 0; i < 24; i += 1) mixed[`src/m${String(i).padStart(2, '0')}.ts`] = `export function f${i}() {\n${i % 2 ? '\t' : '  '}return ${i};\n}\n`;
  const ws = workspace({ repos: { be: mixed } });
  draftAndFill(ws, 'be', { decide: false, answer: () => 'Theo `src/m00.ts`.' });
  assert.match(readFileSync(draftPath(ws), 'utf8'), /^- \[ \] Thụt lề/m);
  const held = conventionApproveCommand({ cwd: ws, repo: 'be' });
  assert.equal(held.exitCode, 1, held.output);
  assert.match(held.output, /- \[ \] Thụt lề/);
});

test('CP-103-V3 an answer citing only a file that does not exist lacks evidence', () => {
  const root = workspace();
  // Tiêu chí 3 không trích file nào: dòng "Đọc thêm:" máy sinh có `src/` có thật, nhưng không tính.
  draftAndFill(root, 'be', {
    // 7: "Không áp dụng" trần, không lý do, không tính; 9: có lý do thì tính.
    answer: (n) => ({
      3: 'Chia thư mục theo chức năng.',
      5: 'Import theo `src/nope.ts`.',
      6: 'Không thấy trong repo.',
      7: 'Không áp dụng.',
      9: 'Không áp dụng: repo không dùng framework nào.',
    })[n] ?? 'Theo `src/a.ts`.',
  });
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Không có bằng chứng.*3\. Cấu trúc thư mục, 5\. Import và export, 7\. Lỗi và log\./);
  assert.doesNotMatch(r.output, /6\. Kiểu dữ liệu/, '"Không thấy trong repo" là câu trả lời hợp lệ');
});

test('CP-103-V4 approve needs a declared repo with a safe name', () => {
  const root = workspace();
  const none = conventionApproveCommand({ cwd: root });
  assert.equal(none.exitCode, 2, none.output);
  const unknown = conventionApproveCommand({ cwd: root, repo: 'fe' });
  assert.equal(unknown.exitCode, 2, unknown.output);
  assert.match(unknown.output, /Repo đã khai: be/);
  const climb = conventionApproveCommand({ cwd: root, repo: '../x' });
  assert.equal(climb.exitCode, 2, climb.output);
  assert.ok(!existsSync(path.join(root, '.knowledge', 'decided', 'conventions')), 'không được tạo thư mục nào');
});

test('CP-103-V5 an approved file copied by hand with a criterion still waiting keeps the gate red', () => {
  const root = workspace();
  const filled = draftAndFill(root, 'be', { skip: [9] });
  put(root, '.knowledge/decided/conventions/be.md', filled);
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /9\. Theo framework/);
});

test('CP-103-V6 a broken rule in the repo\'s own file names that file', () => {
  const root = workspace({ own: { be: '# be\n\n```rule\nid: thieu-pattern\ntype: forbid-pattern\nscope: src/**\nseverity: error\n```\n' } });
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Luật khai báo sai trong \.knowledge\/decided\/conventions\/be\.md/);
});

test('CP-103-V7 a draft made before the 12 criteria is refused with how to redraft', () => {
  const root = workspace();
  put(root, '.compass/conventions-draft/be.md', '# Convention của repo `be` (bản nháp)\n\n## Từ file config\n\n- Không thấy file config nào.\n');
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /không có mục "Agent đọc và viết"/);
  assert.match(r.output, /compass convention --draft --repo=be --force/);
  assert.ok(!existsSync(ownPath(root)));
});

// ---------------------------------------------------------------- Error

test('CP-103-E1 approve without a draft says how to make one', () => {
  const root = workspace();
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /compass convention --draft --repo=be/);
});

test('CP-103-E2 approve never overwrites an approved file', () => {
  const root = workspace({ own: { be: '# be đã duyệt\n' } });
  draftAndFill(root);
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 2, r.output);
  assert.equal(readFileSync(ownPath(root), 'utf8'), '# be đã duyệt\n');
});

test('CP-103-E3 a missing repo inside Phạm vi still stops check', async () => {
  const root = workspace({ repos: { be: BE_FILES, x: null }, own: { be: '# be\n' }, scope: 'be/, x/' });
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /repo "x" không tìm thấy thư mục/);
});

test('CP-103-E4 a broken root rule still stops a multi-repo task', () => {
  const root = workspace({ rootRules: '# gốc\n\n```rule\nid: hong\ntype: forbid-pattern\nscope: x/**\n```\n', own: { be: '# be\n' } });
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Luật khai báo sai trong \.knowledge\/decided\/conventions\.md/);
});

test('CP-103-E5 an own convention path that is a folder counts as missing', () => {
  const root = workspace();
  mkdirSync(ownPath(root), { recursive: true });
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /chưa có convention đã duyệt/);
});

// ---------------------------------------------------------------- Edge

test('CP-103-EC1 a nested repo name reads, drafts and approves its nested file', () => {
  const root = workspace({ repos: { 'tools/live-translator': BE_FILES }, scope: 'tools/live-translator/' });
  const red = gate(root);
  assert.match(red.output, /conventions\/tools\/live-translator\.md/);
  draftAndFill(root, 'tools/live-translator');
  const r = conventionApproveCommand({ cwd: root, repo: 'tools/live-translator' });
  assert.equal(r.exitCode, 0, r.output);
  assert.ok(existsSync(path.join(root, '.knowledge', 'decided', 'conventions', 'tools', 'live-translator.md')));
  assert.equal(gate(root).exitCode, 0);

  // Tên repo có dấu cách: lệnh gợi ý đặt tên trong nháy để chép ra chạy được.
  const spaced = workspace({ repos: { 'my app': BE_FILES }, scope: 'my app/' });
  assert.match(gate(spaced).output, /compass convention --draft --repo="my app"/);
});

test('CP-103-EC2 only the repo without a convention is red; the other one ran', () => {
  const root = workspace({ repos: { fe: BE_FILES, be: BE_FILES }, own: { fe: `# fe\n\n${NO_LOG}` }, scope: 'fe/, be/' });
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.equal(readGate(root, 'T-1', 'convention', 'fe').exitCode, 0);
  assert.equal(readGate(root, 'T-1', 'convention', 'be').exitCode, 1);
  assert.match(r.output, /Repo `be` chưa có convention/);
  assert.doesNotMatch(r.output, /Repo `fe` chưa có convention/);
});

test('CP-103-EC3 a root rule written repo-relative is caught too, not dropped', () => {
  const root = workspace({
    rootRules: `# gốc\n\n${ruleBlock({ id: 'src-no-log', pattern: 'console\\\\.log', scope: 'src/**' })}`,
    own: { be: '# be\n' },
  });
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /`src-no-log`/);
});

test('CP-103-EC4 status without a task lists a missing repo and still succeeds', () => {
  const root = workspace({ repos: { be: BE_FILES, x: null } });
  const r = statusCommand({ cwd: root, taskId: undefined });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /^ {2}x$/m);
  assert.match(r.output, /không có trên máy này/);
  // Bản nháp chung đếm repo có trên máy, không rơi về cả gốc vì một repo chưa clone.
  assert.equal(conventionDraftCommand({ cwd: root }).exitCode, 0);
  assert.match(readFileSync(path.join(root, '.compass', 'conventions-draft.md'), 'utf8'), /Đếm trên 3 file code/);
});

test('CP-103-EC5 root rules about .compass/scripts do not touch the repo', () => {
  const root = workspace({ own: { be: '# be\n' } });
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-103-EC6 evidence with a line number counts; a path leaving the repo does not', () => {
  const root = workspace({ extra: { 'outside.txt': 'ngoài repo\n' } });
  // Đường dẫn đi qua một junction trong repo trỏ ra ngoài cũng không tính.
  const out = mkdtempSync(path.join(tmpdir(), 'compass-cp103-out-'));
  put(out, 'x.ts', 'ngoài repo\n');
  symlinkSync(out, path.join(root, 'be', 'linkout'), LINK);
  draftAndFill(root, 'be', {
    answer: (n) => (n === 2 ? 'Tên hàm ngắn, xem `../outside.txt`.' : n === 4 ? 'Theo `linkout/x.ts`.' : 'Theo `src/a.ts:2`.'),
  });
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Không có bằng chứng.*2\. Đặt tên, 4\. Phụ thuộc giữa các lớp\./);
  assert.doesNotMatch(r.output, /1\. Định dạng/);
});

test('CP-103-EC7 items ticked with a decision are accepted', () => {
  const root = workspace();
  const filled = draftAndFill(root);
  writeFileSync(draftPath(root), `${filled}\n- [x] Dùng dấu cách cho file SQL (người dùng chọn ngày 2026-11-10)\n`);
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 0, r.output);

  // Workspace chưa có `.knowledge/`: lệnh nhắc chạy knowledge --sync trước lần check sau.
  const fresh = workspace({ rootRules: null });
  draftAndFill(fresh);
  const first = conventionApproveCommand({ cwd: fresh, repo: 'be' });
  assert.equal(first.exitCode, 0, first.output);
  assert.match(first.output, /compass knowledge --sync/);
});

test('CP-103-EC8 a fix task without a convention record cannot close', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp103-ec8-'));
  initGit(root);
  put(root, '.compass/config.json', JSON.stringify({ test: OK_TESTS }));
  put(root, 'src/a.ts', 'export const a = 1;\n');
  put(root, '.compass/T-1/spec.md', SPEC({ type: 'fix', scope: 'src/' }));
  commit(root);
  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(c.exitCode, 0, c.output);
  // Bản ghi như của một task `fix` mở trước khi nâng cấp: đủ gate cũ, không có `convention`.
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  delete data.convention;
  writeFileSync(file, JSON.stringify(data, null, 2));
  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Gate "convention" chưa chạy/);
});

// ---------------------------------------------------------------- Security

test('CP-103-S1 .env files are never samples; only an .env example is listed', () => {
  const root = workspace({ repos: { be: { ...BE_FILES, '.env': 'DB_PASSWORD=SECRET_103\n', '.env.example': 'DB_PASSWORD=\n', 'src/.env.local': 'TOKEN=SECRET_103\n' } } });
  assert.equal(conventionDraftCommand({ cwd: root, repo: 'be' }).exitCode, 0);
  const text = readFileSync(draftPath(root), 'utf8');
  assert.ok(!text.includes('SECRET_103'), 'nội dung .env lọt vào bản nháp');
  assert.doesNotMatch(text, /`\.env`|`src\/\.env\.local`/);
  const c11 = text.slice(text.indexOf('### 11.'), text.indexOf('### 12.'));
  assert.match(c11, /`\.env\.example`/);
});

test('CP-103-S2 an own convention reached through a junction counts as missing', (t) => {
  const root = workspace();
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp103-out-'));
  put(outside, 'be.md', '# OUTSIDE_103\n');
  mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });
  symlinkSync(outside, path.join(root, '.knowledge', 'decided', 'conventions'), LINK);
  const r = gate(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /chưa có convention đã duyệt/);
  assert.ok(!r.output.includes('OUTSIDE_103'));

  // Chính file `be.md` là symlink: Windows không có quyền thì không tạo được, nên phần này
  // chỉ đo ở Linux, macOS hay Windows có quyền.
  const direct = workspace();
  mkdirSync(path.join(direct, '.knowledge', 'decided', 'conventions'), { recursive: true });
  try {
    symlinkSync(path.join(outside, 'be.md'), ownPath(direct), 'file');
  } catch (err) {
    t.diagnostic(`không tạo được symlink file (${err.code}); phần file-là-symlink chưa đo trên máy này`);
    return;
  }
  const d = gate(direct);
  assert.equal(d.exitCode, 1, d.output);
  assert.match(d.output, /chưa có convention đã duyệt/);
});

test('CP-103-S3 approve does not write through a junction', () => {
  const root = workspace();
  draftAndFill(root);
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp103-out-'));
  mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });
  symlinkSync(outside, path.join(root, '.knowledge', 'decided', 'conventions'), LINK);
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 2, r.output);
  assert.ok(!existsSync(path.join(outside, 'be.md')), 'đã ghi ra ngoài repo qua junction');
});

test('CP-103-S4 approve does not read a draft reached through a junction', (t) => {
  const root = workspace();
  const outside = mkdtempSync(path.join(tmpdir(), 'compass-cp103-out-'));
  draftAndFill(root);
  writeFileSync(path.join(outside, 'be.md'), readFileSync(draftPath(root), 'utf8'));
  rmSync(path.join(root, '.compass', 'conventions-draft'), { recursive: true, force: true });
  symlinkSync(outside, path.join(root, '.compass', 'conventions-draft'), LINK);
  const r = conventionApproveCommand({ cwd: root, repo: 'be' });
  assert.equal(r.exitCode, 2, r.output);
  assert.ok(!existsSync(ownPath(root)));

  // Chính file bản nháp là symlink (chỉ đo được nơi tạo được symlink file).
  const direct = workspace();
  mkdirSync(path.join(direct, '.compass', 'conventions-draft'), { recursive: true });
  try {
    symlinkSync(path.join(outside, 'be.md'), draftPath(direct), 'file');
  } catch (err) {
    t.diagnostic(`không tạo được symlink file (${err.code}); phần file-là-symlink chưa đo trên máy này`);
    return;
  }
  const d = conventionApproveCommand({ cwd: direct, repo: 'be' });
  assert.equal(d.exitCode, 2, d.output);
  assert.ok(!existsSync(ownPath(direct)));
});

// ---------------------------------------------------------------- Performance

test('CP-103-P1 matching root rules against a repo grows linearly with its files', () => {
  const dirs = {};
  for (const n of [500, 2000]) {
    const dir = mkdtempSync(path.join(tmpdir(), `compass-cp103-p1-${n}-`));
    for (let i = 0; i < n; i += 1) put(dir, `src/d${i % 50}/f${i}.ts`, '');
    dirs[n] = dir;
  }
  const rules = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, scope: `.compass/scripts${i}/**` }));
  const result = measureGrowth({ run: (n) => rulesTouching(dirs[n], rules, { prefix: 'be' }), small: 500, large: 2000, pairs: 3, warmup: 1 });
  assertLinear(result, 8);
});

test('CP-103-P2 the sample list stays at 20 files from 10 folders on a large repo', () => {
  const files = {};
  for (let d = 0; d < 200; d += 1) for (let i = 0; i < 10; i += 1) files[`src/m${String(d).padStart(3, '0')}/f${i}.ts`] = `export const v${i} = ${i};\n`;
  const root = workspace({ repos: { be: files } });
  assert.equal(conventionDraftCommand({ cwd: root, repo: 'be' }).exitCode, 0);
  const text = readFileSync(draftPath(root), 'utf8');
  const list = text.slice(text.indexOf('### File mẫu cần đọc'), text.indexOf('### 1. '));
  const samples = [...list.matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
  assert.ok(samples.length <= 20, `${samples.length} file mẫu`);
  assert.ok(new Set(samples.map((f) => path.posix.dirname(f))).size <= 10);
  assert.ok(samples.length > 0);
});
