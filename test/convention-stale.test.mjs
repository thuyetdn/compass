import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conventionCommand, conventionDraftCommand } from '../commands/convention.mjs';
import { initCommand } from '../commands/init.mjs';
import { collectContext } from '../lib/review-context.mjs';
import { conventionStatus } from '../lib/convention-draft.mjs';
import { execFileSync } from 'node:child_process';
import { makeRepo, put, codeFile, codeFiles, manyFiles, gitAdd } from './helpers/convention-repo.mjs';
import { withinBudget } from './helpers/timing.mjs';

// CP-82 — convention đã chốt có thể cũ đi. Việc kiểm tra chạy tự động ở `init`, ở
// gate `convention` và trong brief soi code, không đợi ai bảo "check".

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRAFT = path.join('.compass', 'conventions-draft.md');
const DECIDED = path.join('.knowledge', 'decided', 'conventions.md');
const PRETTIER = JSON.stringify({ singleQuote: true, semi: false }, null, 2);

const gate = (root) => conventionCommand({ cwd: root, taskId: 'T-1' });
const linesMatching = (output, re) => output.split(/\r?\n/).filter((l) => re.test(l));

// Soạn bản nháp rồi chốt nó, như người duyệt làm.
function adopt(root) {
  const r = conventionDraftCommand({ cwd: root, force: true });
  assert.equal(r.exitCode, 0, r.output);
  put(root, DECIDED, readFileSync(path.join(root, DRAFT), 'utf8'));
  return root;
}

test('CP-82-H6 the gate on a repo with no conventions points at --draft in one line', () => {
  const r = gate(makeRepo(codeFiles(20)));
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(linesMatching(r.output, /compass convention --draft/).length, 1, r.output);
  assert.match(r.output, /Chưa có \.knowledge\/decided\/conventions\.md/);
});

test('CP-82-H7 adopted conventions with nothing changed raise no stale line', () => {
  const root = adopt(makeRepo({ '.prettierrc': PRETTIER, ...codeFiles(30) }));
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.deepEqual(linesMatching(r.output, /có thể đã cũ|compass convention --draft/), [], r.output);
});

test('CP-82-H8 init prints the same missing or stale line, and still creates the task', () => {
  const bare = makeRepo(codeFiles(20));
  const first = initCommand({ cwd: bare, taskId: 'T-2', type: 'bug' });
  assert.equal(first.exitCode, 0, first.output);
  assert.ok(existsSync(path.join(bare, '.compass', 'T-2', 'spec.md')));
  assert.equal(linesMatching(first.output, /Chưa có \.knowledge\/decided\/conventions\.md/).length, 1, first.output);

  const root = adopt(makeRepo({ '.prettierrc': PRETTIER, ...codeFiles(30) }));
  writeFileSync(path.join(root, '.prettierrc'), JSON.stringify({ singleQuote: false }));
  const second = initCommand({ cwd: root, taskId: 'T-3', type: 'bug' });
  assert.equal(second.exitCode, 0, second.output);
  assert.ok(existsSync(path.join(root, '.compass', 'T-3', 'spec.md')));
  assert.match(second.output, /có thể đã cũ/);
  assert.match(second.output, /`\.prettierrc` đã đổi/);
});

test('CP-82-H9 SKILL.md tells the agent to redraft unasked, before the spec, and wait', () => {
  const skill = readFileSync(path.join(ROOT, 'skills', 'compass', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const i = skill.indexOf('### Convention thiếu hoặc đã cũ');
  assert.ok(i >= 0, 'thiếu mục "Convention thiếu hoặc đã cũ"');
  const end = skill.indexOf('\n### ', i + 1);
  const part = skill.slice(i, end < 0 ? undefined : end);
  assert.match(part, /không chờ ai bảo/);
  assert.match(part, /compass convention --draft/);
  assert.match(part, /trước khi viết spec/);
  assert.match(part, /chờ người duyệt/);
  assert.match(part, /không tự sửa `\.knowledge\/decided\/`/i);
});

test('CP-82-EC5 a .prettierrc edited after adoption makes the gate warn, not fail', () => {
  const root = adopt(makeRepo({ '.prettierrc': PRETTIER, ...codeFiles(30) }));
  writeFileSync(path.join(root, '.prettierrc'), JSON.stringify({ singleQuote: true, semi: true }));
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /có thể đã cũ/);
  assert.match(r.output, /`\.prettierrc` đã đổi từ lúc soạn/);
});

test('CP-82-EC6 code that drifted from a counted convention is named with both splits', () => {
  const files = codeFiles(38);
  files['src/x-one.js'] = codeFile({ quote: 'double' });
  files['src/x-two.js'] = codeFile({ quote: 'double' });
  const root = adopt(makeRepo(files));
  for (let i = 0; i < 10; i += 1) {
    writeFileSync(path.join(root, 'src', `part-${String(i).padStart(4, '0')}.js`), codeFile({ quote: 'double', name: `fn${i}` }));
  }
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /- Nháy: lúc soạn nháy đơn 38 \/ 40 file, giờ nháy đơn 28 \/ 40 file/);
});

test('CP-82-EC7 a config that appears after adoption is reported', () => {
  const root = adopt(makeRepo(codeFiles(30)));
  put(root, '.editorconfig', 'root = true\n[*]\nindent_style = space\n');
  gitAdd(root);
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /`\.editorconfig` mới xuất hiện/);
});

test('CP-82-V10 a config created but not added after adoption raises no stale line', () => {
  const root = adopt(makeRepo(codeFiles(30)));
  put(root, '.prettierrc', JSON.stringify({ singleQuote: false }));
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.doesNotMatch(r.output, /có thể đã cũ/, r.output);
});

test('CP-82-EC14 paths with spaces round-trip through the mark', () => {
  const files = codeFiles(20);
  for (let i = 0; i < 25; i += 1) files[`my tests/unit-${i}.test.js`] = codeFile({ name: `t${i}` });
  const single = adopt(makeRepo(files));
  const a = gate(single);
  assert.equal(a.exitCode, 0, a.output);
  assert.doesNotMatch(a.output, /hỏng|có thể đã cũ/, a.output);

  const root = makeRepo({}, { git: false });
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { web: { path: 'web app' } } }));
  put(root, '.compass/T-1/spec.md', readFileSync(path.join(root, '.compass/T-1/spec.md'), 'utf8').replace('Phạm vi: src/', 'Phạm vi: web/'));
  const dir = path.join(root, 'web app');
  for (const [rel, body] of Object.entries({ '.prettierrc': PRETTIER, ...codeFiles(25) })) put(dir, rel, body);
  execFileSync('git', ['init', '-q', '.'], { cwd: dir, stdio: 'ignore' });
  gitAdd(dir);
  adopt(root);
  assert.match(readFileSync(path.join(root, DECIDED), 'utf8'), /^source web%20app\/\.prettierrc [0-9a-f]{16}$/m);
  const b = gate(root);
  assert.equal(b.exitCode, 0, b.output);
  assert.doesNotMatch(b.output, /hỏng|có thể đã cũ/, b.output);
});

test('CP-82-EC9 test files at the repo root give a mark that parses back as fresh', () => {
  const files = codeFiles(20);
  for (let i = 0; i < 25; i += 1) files[`unit-${i}.test.js`] = codeFile({ name: `t${i}` });
  const root = adopt(makeRepo(files));
  assert.match(readFileSync(path.join(root, DECIDED), 'utf8'), /^stat test-dir \.\/ 25\/25$/m);
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.doesNotMatch(r.output, /hỏng|có thể đã cũ/, r.output);
});

// Bố cục nhiều repo trong SKILL.md: gốc Compass không phải repo git, mỗi repo
// con là một repo git riêng.
function multiRepo() {
  const root = makeRepo({}, { git: false });
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { fe: { path: 'fe' }, be: { path: 'be' } } }));
  put(root, '.compass/T-1/spec.md', readFileSync(path.join(root, '.compass/T-1/spec.md'), 'utf8').replace('Phạm vi: src/', 'Phạm vi: fe/, be/'));
  for (const [name, files] of [['fe', { '.prettierrc': PRETTIER, ...codeFiles(15) }], ['be', codeFiles(15)]]) {
    const dir = path.join(root, name);
    for (const [rel, body] of Object.entries(files)) put(dir, rel, body);
    execFileSync('git', ['init', '-q', '.'], { cwd: dir, stdio: 'ignore' });
    gitAdd(dir);
  }
  return root;
}

test('CP-82-H10 a multi-repo root that is not a git repo is drafted from its repos', () => {
  const root = multiRepo();
  const r = conventionDraftCommand({ cwd: root, force: false });
  assert.equal(r.exitCode, 0, r.output);
  const text = readFileSync(path.join(root, DRAFT), 'utf8');
  assert.match(text, /Đếm trên 30 file code/);
  assert.match(text, /Prettier \(`fe\/\.prettierrc`\)/);
  put(root, DECIDED, text);
  assert.doesNotMatch(gate(root).output, /có thể đã cũ/);
  writeFileSync(path.join(root, 'fe', '.prettierrc'), JSON.stringify({ singleQuote: false }));
  const after = gate(root);
  assert.equal(after.exitCode, 0, after.output);
  assert.match(after.output, /`fe\/\.prettierrc` đã đổi từ lúc soạn/);
});

test('CP-82-EC10 in a multi-repo project the missing line is printed once per gate run', () => {
  const root = multiRepo();
  const all = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(linesMatching(all.output, /Chưa có \.knowledge\/decided\/conventions\.md/).length, 1, all.output);
  const perRepo = ['fe', 'be'].map((repo) => conventionCommand({ cwd: root, taskId: 'T-1', repo, gateRoot: root }).output).join('\n');
  assert.equal(linesMatching(perRepo, /Chưa có \.knowledge\/decided\/conventions\.md/).length, 1, perRepo);
});

test('CP-82-EC11 a draft alone is not read as declared conventions', () => {
  const root = makeRepo(codeFiles(25));
  assert.equal(conventionDraftCommand({ cwd: root, force: false }).exitCode, 0);
  const text = collectContext(root, { files: ['src/part-0000.js'] }).text;
  const conv = text.slice(text.indexOf('### convention'), text.indexOf('### impact'));
  assert.match(conv, /Repo chưa khai convention/);
  // Repo chưa có convention thì brief giữ đúng như trước CP-82: không dòng nào
  // của việc kiểm tra convention cũ lọt vào.
  assert.doesNotMatch(conv, /compass convention --draft|có thể đã cũ|dấu nguồn|Lưu ý/);
});

test('CP-82-EC15 in a multi-repo project the test folder is counted inside each repo', () => {
  const root = makeRepo({}, { git: false });
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { fe: { path: 'fe' }, be: { path: 'be' } } }));
  put(root, '.compass/T-1/spec.md', readFileSync(path.join(root, '.compass/T-1/spec.md'), 'utf8').replace('Phạm vi: src/', 'Phạm vi: fe/, be/'));
  const tests = (n, tag) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`test/${tag}-${i}.test.js`, codeFile({ name: `${tag}${i}` })]));
  for (const [name, files] of [['fe', tests(15, 'ui')], ['be', tests(15, 'api')]]) {
    const dir = path.join(root, name);
    for (const [rel, body] of Object.entries(files)) put(dir, rel, body);
    execFileSync('git', ['init', '-q', '.'], { cwd: dir, stdio: 'ignore' });
    gitAdd(dir);
  }
  adopt(root);
  assert.match(readFileSync(path.join(root, DECIDED), 'utf8'), /^stat test-dir test\/ 30\/30$/m);
  for (let i = 15; i < 20; i += 1) put(path.join(root, 'be'), `test/api-${i}.test.js`, codeFile({ name: `api${i}` }));
  gitAdd(path.join(root, 'be'));
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.doesNotMatch(r.output, /có thể đã cũ/, r.output);
});

test('CP-82-EC12 init prints no convention line while adopted conventions are fresh', () => {
  const root = adopt(makeRepo({ '.prettierrc': PRETTIER, ...codeFiles(30) }));
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  assert.equal(r.exitCode, 0, r.output);
  assert.deepEqual(linesMatching(r.output, /conventions\.md|compass convention/), [], r.output);
});

test('CP-82-EC13 a brief with fresh conventions carries no stale note', () => {
  const root = adopt(makeRepo({ '.prettierrc': PRETTIER, ...codeFiles(30) }));
  const text = collectContext(root, { files: ['src/part-0000.js'] }).text;
  const conv = text.slice(text.indexOf('### convention'), text.indexOf('### impact'));
  const lines = conv.split('\n');
  assert.match(lines[2], /^Repo đã khai convention ở/);
  assert.equal(lines[3], '', 'sau dòng luật đã khai phải là dòng trống rồi tới file, không có lưu ý');
  assert.match(lines[4], /^# Convention của repo/);
  assert.doesNotMatch(conv, /có thể đã cũ/);
});

test('CP-82-EC8 a review brief states that the conventions in use look stale', () => {
  const root = adopt(makeRepo({ '.prettierrc': PRETTIER, ...codeFiles(30) }));
  writeFileSync(path.join(root, '.prettierrc'), JSON.stringify({ singleQuote: false }));
  const text = collectContext(root, { files: ['src/part-0000.js'] }).text;
  const conv = text.slice(text.indexOf('### convention'));
  assert.match(conv, /có thể đã cũ/);
  assert.match(conv, /`\.prettierrc` đã đổi/);
});

test('CP-82-V6 a hand-written conventions.md gets one info line and no stale verdict', () => {
  const root = makeRepo({ ...codeFiles(20), [DECIDED]: '# Quy ước\n\nViết code gọn.\n' });
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(linesMatching(r.output, /không có dấu nguồn/).length, 1, r.output);
  assert.doesNotMatch(r.output, /có thể đã cũ/);
});

test('CP-82-V7 a mark cut short gives one warning and no stale verdict', () => {
  const root = makeRepo({ ...codeFiles(20), [DECIDED]: '# Quy ước\n\n<!-- compass-convention-mark v1\nsource .prettierrc 0123456789abcdef\n' });
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(linesMatching(r.output, /Dấu nguồn .* hỏng/).length, 1, r.output);
  assert.doesNotMatch(r.output, /có thể đã cũ/);
});

test('CP-82-S4 mark entries naming paths outside the known configs are ignored and reported', () => {
  const mark = [
    '<!-- compass-convention-mark v1',
    'source ../../outside.json 0123456789abcdef',
    'source /etc/passwd 0123456789abcdef',
    '-->',
  ].join('\n');
  const root = makeRepo({ ...codeFiles(20), [DECIDED]: `# Quy ước\n\n${mark}\n` });
  const r = gate(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /`\.\.\/\.\.\/outside\.json`.*bỏ qua/);
  assert.match(r.output, /`\/etc\/passwd`.*bỏ qua/);
  assert.doesNotMatch(r.output, /outside\.json` đã/);
});

test('CP-82-P3 the stale check on 5,000 files stays within 10 s, and costs no counting without a mark', () => {
  const root = adopt(manyFiles(5000, codeFile({ extra: 60 })));
  const { value } = withinBudget({ run: () => conventionStatus(root), budgetMs: 10_000, tries: 2, label: 'stale check 5.000 file' });
  assert.equal(value.state, 'fresh', value.lines.join('\n'));
  assert.ok(value.counted > 0);

  put(root, DECIDED, '# Quy ước\n\nViết tay, không có dấu nguồn.\n');
  assert.equal(conventionStatus(root).counted, 0, 'không có dấu nguồn thì không được đếm file nào');
});
