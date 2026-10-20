import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getSalt } from '../lib/signature.mjs';
import { initCommand } from '../commands/init.mjs';

// CP-80 — `.compass/.gitignore` mặc định chưa che `review-brief.md`, nên ở dự án
// mới mỗi brief `compass review` sinh ra đều hiện trong `git status`. Như CP-59,
// các ca hỏi git thật (`git check-ignore`) chứ không chỉ so chuỗi mẫu.

const MAC_DINH = '.salt\ndata/\nreview-brief.md\n';
const ignorePath = (root) => path.join(root, '.compass', '.gitignore');

function thuMuc() {
  return mkdtempSync(path.join(tmpdir(), 'compass-cp80-'));
}

function gitInit(root) {
  execFileSync('git', ['init', '-q', '.'], { cwd: root, stdio: 'ignore' });
  return root;
}

function duAnCu(noiDungIgnore) {
  const root = gitInit(thuMuc());
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'npm test' }));
  writeFileSync(ignorePath(root), noiDungIgnore);
  return root;
}

function biBoQua(cwd, rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const dongGitignore = (output) => output.split(/\r?\n/).filter((l) => /\.compass\/\.gitignore|review-brief/.test(l));

test('CP-80-H1 init ở repo mới che review-brief.md mà không che bằng chứng', () => {
  const root = gitInit(thuMuc());
  const r = initCommand({ cwd: root, taskId: 'T-1', type: 'bug' });
  const ev = path.join(root, '.compass', 'T-1', 'evidence');
  mkdirSync(ev, { recursive: true });
  writeFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), '# brief\n');
  writeFileSync(path.join(ev, 'findings.json'), '{}\n');
  writeFileSync(path.join(ev, 'gate.json'), '{}\n');
  const brief = biBoQua(root, '.compass/T-1/review-brief.md');
  const findings = biBoQua(root, '.compass/T-1/evidence/findings.json');
  const gate = biBoQua(root, '.compass/T-1/evidence/gate.json');
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.ok(brief, 'brief soi code phải bị git bỏ qua');
  assert.ok(!findings, 'findings.json là bằng chứng, phải review được');
  assert.ok(!gate, 'gate.json là bằng chứng, phải review được');
});

test('CP-80-H2 .gitignore mặc định hai dòng của bản trước được nâng và báo một dòng', () => {
  const root = duAnCu('.salt\ndata/\n');
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.equal(noiDung, MAC_DINH);
  const dong = dongGitignore(r.output);
  assert.equal(dong.length, 1, `phải đúng một dòng báo nâng: ${JSON.stringify(r.output)}`);
  assert.match(dong[0], /Đã nâng/);
  assert.match(dong[0], /review-brief\.md/);
  assert.doesNotMatch(dong[0], /data\//, 'file đã che data/ thì không được nói là vừa thêm data/');
});

test('CP-80-V1 mặc định hai dòng kèm CRLF hoặc không xuống dòng cuối cũng được nâng', () => {
  for (const cu of ['.salt\r\ndata/\r\n', '.salt\ndata/']) {
    const root = duAnCu(cu);
    const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
    const noiDung = readFileSync(ignorePath(root), 'utf8');
    rmSync(root, { recursive: true, force: true });

    assert.equal(r.exitCode, 0, r.output);
    assert.equal(noiDung, MAC_DINH, `không nâng file ${JSON.stringify(cu)}`);
  }
});

test('CP-80-V2 .gitignore của người dùng giữ nguyên byte, không nhắc gì về brief', () => {
  const root = duAnCu('.salt\ndata/\n*.log\n');
  const truoc = readFileSync(ignorePath(root));
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  const sau = readFileSync(ignorePath(root));
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.ok(sau.equals(truoc), `file của người dùng bị đổi: ${JSON.stringify(sau.toString())}`);
  assert.deepEqual(dongGitignore(r.output), [], r.output);
});

test('CP-80-E1 mặc định hai dòng chỉ đọc thì init vẫn tạo task và không khai đã nâng', () => {
  const root = duAnCu('.salt\ndata/\n');
  chmodSync(ignorePath(root), 0o444);
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  const coSpec = existsSync(path.join(root, '.compass', 'T-2', 'spec.md'));
  chmodSync(ignorePath(root), 0o644);
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.ok(coSpec, 'spec phải được tạo');
  assert.equal(noiDung, '.salt\ndata/\n');
  assert.doesNotMatch(r.output, /Đã nâng/);
});

test('CP-80-EC1 init, getSalt, init, getSalt ghi review-brief.md đúng một lần', () => {
  const root = thuMuc();
  initCommand({ cwd: root, taskId: 'T-1', type: 'bug' });
  getSalt(root);
  initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  getSalt(root);
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  rmSync(root, { recursive: true, force: true });

  assert.equal(noiDung.split('\n').filter((l) => l === 'review-brief.md').length, 1);
  assert.equal(noiDung, MAC_DINH);
});

test('CP-80-EC2 file một dòng .salt của bản cũ nhất được nâng thẳng lên mặc định mới', () => {
  const root = duAnCu('.salt\n');
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  const brief = biBoQua(root, '.compass/T-2/review-brief.md');
  const data = biBoQua(root, '.compass/T-2/data/x.csv');
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.equal(noiDung, MAC_DINH);
  assert.ok(brief && data, 'sau khi nâng, git phải bỏ qua cả brief lẫn data/');
  const dong = dongGitignore(r.output);
  assert.equal(dong.length, 1, r.output);
  assert.match(dong[0], /data\//);
  assert.match(dong[0], /review-brief\.md/);
});
