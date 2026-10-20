import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getSalt } from '../lib/signature.mjs';
import { initCommand } from '../commands/init.mjs';

// CP-59 — `init` và `getSalt` từng viết hai nội dung `.compass/.gitignore` khác
// nhau, và `init` luôn chạy trước. Mọi ca dưới đây hỏi git thật
// (`git check-ignore`) chứ không so chuỗi mẫu, như CP-30.

const ignorePath = (root) => path.join(root, '.compass', '.gitignore');

function thuMuc() {
  return mkdtempSync(path.join(tmpdir(), 'compass-cp59-'));
}

function gitInit(root) {
  execFileSync('git', ['init', '-q', '.'], { cwd: root, stdio: 'ignore' });
  return root;
}

// Dự án đã có sẵn (config + `.gitignore` do bản cũ để lại), trong một repo git.
function duAnCu(noiDungIgnore, { git = true } = {}) {
  const root = thuMuc();
  if (git) gitInit(root);
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'npm test' }));
  if (noiDungIgnore !== undefined) writeFileSync(ignorePath(root), noiDungIgnore);
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

const dongNhac = (output, re) => output.split(/\r?\n/).filter((l) => re.test(l));
const dongGitignore = (output) => dongNhac(output, /\.compass\/\.gitignore|data\//);

test('CP-59-H1 init ở repo mới che cả data/ lẫn .salt', () => {
  const root = gitInit(thuMuc());
  const r = initCommand({ cwd: root, taskId: 'T-1', type: 'bug' });
  mkdirSync(path.join(root, '.compass', 'T-1', 'data'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'T-1', 'data', 'T-1-q-1015.csv'), 'email\nkhach@vd.vn\n');
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  const data = biBoQua(root, '.compass/T-1/data/T-1-q-1015.csv');
  const salt = biBoQua(root, '.compass/.salt');
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.equal(noiDung, '.salt\ndata/\nreview-brief.md\n');
  assert.ok(data, 'kết quả query phải bị git bỏ qua — nó có email khách hàng');
  assert.ok(salt, '.salt phải bị git bỏ qua');
});

test('CP-59-H2 dự án mở bằng init và dự án mở bằng getSalt có cùng .gitignore', () => {
  const a = thuMuc();
  initCommand({ cwd: a, taskId: 'T-1', type: 'bug' });
  const b = duAnCu(undefined, { git: false });
  getSalt(b);
  const noiDungA = readFileSync(ignorePath(a), 'utf8');
  const noiDungB = readFileSync(ignorePath(b), 'utf8');
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });

  assert.equal(noiDungA, '.salt\ndata/\nreview-brief.md\n');
  assert.equal(noiDungA, noiDungB, 'hai lệnh viết hai nội dung khác nhau — lệnh chạy trước thắng');
});

test('CP-59-H3 .gitignore một dòng .salt của bản cũ được init nâng lên', () => {
  const root = duAnCu('.salt\n');
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  const data = biBoQua(root, '.compass/T-2/data/x.csv');
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.equal(noiDung, '.salt\ndata/\nreview-brief.md\n');
  const dong = dongGitignore(r.output);
  assert.equal(dong.length, 1, `phải đúng một dòng báo nâng cấp: ${JSON.stringify(r.output)}`);
  assert.match(dong[0], /\.compass\/\.gitignore/);
  assert.match(dong[0], /data\//);
  assert.ok(data, 'sau khi nâng, git phải bỏ qua data/');
});

test('CP-59-V1 .salt kèm CRLF hoặc không xuống dòng cũng được nâng', () => {
  for (const cu of ['.salt\r\n', '.salt']) {
    const root = duAnCu(cu);
    const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
    const noiDung = readFileSync(ignorePath(root), 'utf8');
    rmSync(root, { recursive: true, force: true });

    assert.equal(r.exitCode, 0, r.output);
    assert.equal(noiDung, '.salt\ndata/\nreview-brief.md\n', `không nâng file ${JSON.stringify(cu)}`);
    assert.equal(dongGitignore(r.output).length, 1, r.output);
  }
});

test('CP-59-V2 .gitignore người dùng đã sửa thì giữ nguyên byte, chỉ cảnh báo', () => {
  const root = duAnCu('.salt\n*.log\n');
  const truoc = readFileSync(ignorePath(root));
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  const sau = readFileSync(ignorePath(root));
  const coSpec = existsSync(path.join(root, '.compass', 'T-2', 'spec.md'));
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.ok(coSpec, 'spec phải được tạo');
  assert.ok(sau.equals(truoc), `file của người dùng bị đổi: ${JSON.stringify(sau.toString())}`);
  const canhBao = dongGitignore(r.output);
  assert.equal(canhBao.length, 1, `phải đúng một dòng cảnh báo: ${JSON.stringify(r.output)}`);
  assert.match(canhBao[0], /data\//);
});

test('CP-59-V3 .gitignore gốc repo đã che data/ thì không cảnh báo', () => {
  const root = duAnCu('.salt\n# mine\n');
  writeFileSync(path.join(root, '.gitignore'), 'data/\n');
  const truoc = readFileSync(ignorePath(root));
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  const sau = readFileSync(ignorePath(root));
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.ok(sau.equals(truoc), 'file của người dùng bị đổi');
  assert.deepEqual(dongGitignore(r.output), [], 'git nói data/ đã được che — cảnh báo là báo sai');
});

test('CP-59-E1 .gitignore là thư mục thì init vẫn tạo task', () => {
  const root = duAnCu(undefined);
  mkdirSync(ignorePath(root));
  writeFileSync(path.join(ignorePath(root), 'giu.txt'), 'x');
  let r = null;
  assert.doesNotThrow(() => { r = initCommand({ cwd: root, taskId: 'T-1', type: 'bug' }); });
  const vanLaThuMuc = statSync(ignorePath(root)).isDirectory();
  const conFile = existsSync(path.join(ignorePath(root), 'giu.txt'));
  const coSpec = existsSync(path.join(root, '.compass', 'T-1', 'spec.md'));
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.ok(coSpec, 'spec phải được tạo');
  assert.ok(vanLaThuMuc && conFile, 'thư mục .gitignore phải còn nguyên');
});

test('CP-59-E2 init ngoài repo git vẫn viết đủ .gitignore, không lời git nào', () => {
  const root = thuMuc();
  const r = initCommand({ cwd: root, taskId: 'T-1', type: 'bug' });
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.equal(noiDung, '.salt\ndata/\nreview-brief.md\n');
  assert.deepEqual(dongGitignore(r.output), []);
  assert.doesNotMatch(r.output, /fatal|not a git repository|Cảnh báo/i);
});

test('CP-59-E3 .gitignore chỉ đọc thì init vẫn tạo task và cảnh báo thay vì báo đã nâng', () => {
  const root = duAnCu('.salt\n');
  chmodSync(ignorePath(root), 0o444);
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  const coSpec = existsSync(path.join(root, '.compass', 'T-2', 'spec.md'));
  chmodSync(ignorePath(root), 0o644);
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.ok(coSpec, 'spec phải được tạo');
  assert.equal(noiDung, '.salt\n');
  const dong = dongGitignore(r.output);
  assert.equal(dong.length, 1, r.output);
  assert.match(dong[0], /data\//);
  assert.match(dong[0], /chưa che/, `phải cảnh báo, không được khai đã nâng: ${dong[0]}`);
  assert.doesNotMatch(dong[0], /Đã nâng/);
});

test('CP-59-EC1 init, getSalt, init, getSalt không nhân đôi dòng nào', () => {
  const root = thuMuc();
  initCommand({ cwd: root, taskId: 'T-1', type: 'bug' });
  getSalt(root);
  initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  getSalt(root);
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  rmSync(root, { recursive: true, force: true });

  assert.equal(noiDung, '.salt\ndata/\nreview-brief.md\n');
});

test('CP-59-EC2 file init viết ra chạy đúng với git thật', () => {
  const root = gitInit(thuMuc());
  initCommand({ cwd: root, taskId: 'T-1', type: 'bug' });
  for (const d of ['data', 'output', 'evidence']) {
    mkdirSync(path.join(root, '.compass', 'T-1', d), { recursive: true });
  }
  for (const f of ['.compass/.salt', '.compass/T-1/data/q.csv',
                   '.compass/T-1/output/v.mp4', '.compass/T-1/evidence/gate.json']) {
    writeFileSync(path.join(root, f), 'x');
  }
  const thatSu = readFileSync(ignorePath(root), 'utf8');
  const ketQua = {
    data: biBoQua(root, '.compass/T-1/data/q.csv'),
    output: biBoQua(root, '.compass/T-1/output/v.mp4'),
    evidence: biBoQua(root, '.compass/T-1/evidence/gate.json'),
    salt: biBoQua(root, '.compass/.salt'),
  };
  rmSync(root, { recursive: true, force: true });

  assert.deepEqual(ketQua, { data: true, output: false, evidence: false, salt: true },
    `mẫu thật cho kết quả sai: ${JSON.stringify(ketQua)} — nội dung: ${JSON.stringify(thatSu)}`);
});

test('CP-59-EC3 .gitignore đã đúng mặc định thì init không đụng, không nói gì', () => {
  const root = duAnCu('.salt\ndata/\nreview-brief.md\n');
  const truoc = readFileSync(ignorePath(root));
  const r = initCommand({ cwd: root, taskId: 'T-2', type: 'bug' });
  const sau = readFileSync(ignorePath(root));
  rmSync(root, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.ok(sau.equals(truoc));
  assert.deepEqual(dongGitignore(r.output), []);
});

test('CP-59-EC4 dự án Compass lồng trong repo ngoài được nâng, git ngoài che data/', () => {
  const ngoai = gitInit(thuMuc());
  const sub = path.join(ngoai, 'sub');
  mkdirSync(path.join(sub, '.compass'), { recursive: true });
  writeFileSync(path.join(sub, '.compass', 'config.json'), JSON.stringify({ test: 'npm test' }));
  writeFileSync(ignorePath(sub), '.salt\n');
  const r = initCommand({ cwd: sub, taskId: 'T-1', type: 'bug' });
  const noiDung = readFileSync(ignorePath(sub), 'utf8');
  const data = biBoQua(ngoai, 'sub/.compass/T-1/data/x.csv');
  rmSync(ngoai, { recursive: true, force: true });

  assert.equal(r.exitCode, 0, r.output);
  assert.equal(noiDung, '.salt\ndata/\nreview-brief.md\n');
  assert.ok(data, 'từ gốc repo ngoài, data/ của dự án lồng phải bị bỏ qua');
});
