import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CP-77 — `compass --version` in phiên bản của chính bản CLI đang chạy. Mọi test
// chạy CLI như một tiến trình con và chỉ đo thứ người dùng thấy được: stdout, mã
// thoát, stderr, và file trên đĩa.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'cli.mjs');
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function run(cli, args, { cwd = ROOT, env = process.env } = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const emptyDir = (prefix = 'compass-ver-') => mkdtempSync(path.join(tmpdir(), prefix));

// Chép một bản CLI ra thư mục tạm, để đổi package.json của bản chép mà không đụng
// package.json thật của repo.
function copyCli(parent = emptyDir('compass-dist-')) {
  const dist = path.join(parent, 'compass');
  mkdirSync(dist, { recursive: true });
  for (const entry of ['cli.mjs', 'package.json', 'lib', 'commands', 'templates']) {
    cpSync(path.join(ROOT, entry), path.join(dist, entry), { recursive: true });
  }
  return dist;
}

const setVersion = (dist, version) => {
  const file = path.join(dist, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...pkg, version }, null, 2));
};

// Spec: mọi case thành công kiểm tra đúng dòng phiên bản, mã thoát 0 và stderr
// rỗng. Lần soi đầu của CP-77 bắt được sáu case chỉ so stdout.
function assertVersion(r, expected = VERSION) {
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, `${expected}\n`);
  assert.equal(r.err, '');
}

test('CP-77-H1 --version from the Compass repository prints its package version', () => {
  assertVersion(run(CLI, ['--version']));
});

test('CP-77-H2 --version works from an empty directory and leaves it empty', () => {
  const dir = emptyDir();
  assertVersion(run(CLI, ['--version'], { cwd: dir }));
  assert.deepEqual(readdirSync(dir), []);
});

test('CP-77-H3 a copied CLI prints its own package version', () => {
  const dist = copyCli();
  setVersion(dist, '9.8.7-rc.1+build.42');
  assertVersion(run(path.join(dist, 'cli.mjs'), ['--version'], { cwd: emptyDir() }), '9.8.7-rc.1+build.42');
});

test('CP-77-V1 --version=1 is not the version flag', () => {
  const r = run(CLI, ['--version=1'], { cwd: emptyDir() });
  assert.equal(r.code, 2);
  assert.match(r.out, /Dùng:/);
  assert.notEqual(r.out, `${VERSION}\n`);
});

test('CP-77-V2 --version after init leaves init doing its job', () => {
  const dir = emptyDir();
  const r = run(CLI, ['init', 'SAMPLE', '--type=fix', '--version'], { cwd: dir });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Đã tạo task SAMPLE/);
  assert.ok(readFileSync(path.join(dir, '.compass', 'SAMPLE', 'spec.md'), 'utf8').length > 0);
});

test('CP-77-E1 a malformed package.json fails with the CLI diagnostic', () => {
  const dist = copyCli();
  writeFileSync(path.join(dist, 'package.json'), '{ "version": ');
  const r = run(path.join(dist, 'cli.mjs'), ['--version'], { cwd: emptyDir() });
  assert.equal(r.code, 2);
  assert.match(r.out, /Lệnh thất bại:/);
});

test('CP-77-E2 a missing package.json fails with the CLI diagnostic', () => {
  const dist = copyCli();
  rmSync(path.join(dist, 'package.json'));
  const r = run(path.join(dist, 'cli.mjs'), ['--version'], { cwd: emptyDir() });
  assert.equal(r.code, 2);
  assert.match(r.out, /Lệnh thất bại:/);
});

test('CP-77-EC1 a CLI installed under a path with spaces and Vietnamese prints its version', () => {
  const parent = path.join(emptyDir('compass-path-'), 'Thư mục có dấu cách');
  mkdirSync(parent, { recursive: true });
  const dist = copyCli(parent);
  assertVersion(run(path.join(dist, 'cli.mjs'), ['--version'], { cwd: emptyDir() }));
});

test('CP-77-EC2 a malformed project config does not stop --version and stays untouched', () => {
  const dir = emptyDir();
  mkdirSync(path.join(dir, '.compass'));
  const broken = '{ "test": ';
  writeFileSync(path.join(dir, '.compass', 'config.json'), broken);
  assertVersion(run(CLI, ['--version'], { cwd: dir }));
  assert.equal(readFileSync(path.join(dir, '.compass', 'config.json'), 'utf8'), broken);
});

test('CP-77-EC3 no arguments prints usage listing --version and keeps exit 2', () => {
  const r = run(CLI, [], { cwd: emptyDir() });
  assert.equal(r.code, 2);
  assert.match(r.out, /compass --version/);
  assert.match(r.out, /compass init <id> --type=/);

  // Rủi ro hồi quy thứ ba: đọc package.json sớm thì một bản cài thiếu file đó hỏng
  // mọi lệnh, không chỉ --version. Lần soi đầu chứng minh không test nào bắt được
  // điều này: thêm `version();` vào đầu main() mà cả suite vẫn xanh.
  const dist = copyCli();
  rmSync(path.join(dist, 'package.json'));
  const bare = run(path.join(dist, 'cli.mjs'), [], { cwd: emptyDir() });
  assert.equal(bare.code, 2);
  assert.match(bare.out, /Dùng:/, 'thiếu package.json vẫn phải in hướng dẫn');
  assert.ok(!/Lệnh thất bại/.test(bare.out), 'thiếu package.json không được làm hỏng lệnh khác');
});

test('CP-77-S1 an unrelated package.json in the working directory is ignored and untouched', () => {
  const dir = emptyDir();
  const other = JSON.stringify({ name: 'other', version: '99.99.99' });
  writeFileSync(path.join(dir, 'package.json'), other);
  assertVersion(run(CLI, ['--version'], { cwd: dir }));
  assert.equal(readFileSync(path.join(dir, 'package.json'), 'utf8'), other);
});

test('CP-77-S2 npm_package_version in the environment does not replace the real version', () => {
  assertVersion(run(CLI, ['--version'], { cwd: emptyDir(), env: { ...process.env, npm_package_version: '99.99.99' } }));
});

test('CP-77-S3 --version before a command only prints the version and creates nothing', () => {
  const dir = emptyDir();
  assertVersion(run(CLI, ['--version', 'init', 'SAMPLE', '--type=fix'], { cwd: dir }));
  assert.deepEqual(readdirSync(dir), []);
});
