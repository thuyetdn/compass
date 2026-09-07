import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getSalt } from '../lib/signature.mjs';
import { initCommand } from '../commands/init.mjs';
import { investigateCommand } from '../commands/investigate.mjs';

function duAn() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-salt-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'npm test' }));
  return root;
}

const ignorePath = (root) => path.join(root, '.compass', '.gitignore');

test('CP-28-H1 getSalt tạo .gitignore che .salt khi chưa có', () => {
  const root = duAn();
  const salt = getSalt(root);
  const co = existsSync(ignorePath(root));
  const noiDung = co ? readFileSync(ignorePath(root), 'utf8') : '';
  rmSync(root, { recursive: true, force: true });

  assert.equal(typeof salt, 'string');
  assert.ok(salt.length > 0);
  assert.ok(co, '.compass/.gitignore phải được tạo');
  assert.match(noiDung, /(^|\n)\.salt(\n|$)/);
});

test('CP-28-H2 compass investigate ở dự án mới cũng che được salt', () => {
  const root = duAn();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  // Chỉ mở hồ sơ thì chưa ký gì; salt sinh ra khi có bản ghi gate đầu tiên.
  // Gọi getSalt là mô phỏng đúng lúc đó.
  getSalt(root);
  const co = existsSync(ignorePath(root));
  rmSync(root, { recursive: true, force: true });

  assert.ok(co, 'dự án mở bằng investigate vẫn phải có .gitignore');
});

test('CP-28-V1 .gitignore có sẵn nội dung người dùng thì giữ nguyên', () => {
  const root = duAn();
  writeFileSync(ignorePath(root), '*.log\nnode_modules/\n');
  getSalt(root);
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  rmSync(root, { recursive: true, force: true });

  // Ghi đè là xoá mất luật của người dùng. Salt trần đỡ tệ hơn mất cấu hình họ viết.
  assert.match(noiDung, /\*\.log/);
  assert.match(noiDung, /node_modules/);
});

test('CP-28-E1 không che được .gitignore thì getSalt vẫn ký được', () => {
  const root = duAn();

  // `.gitignore` là một THƯ MỤC: không ghi đè được, và `existsSync` trả true nên
  // `cheSalt` trả về sớm. Đây là ca "che không thành" đo được bằng test.
  //
  // Nhánh `catch` bên trong thì KHÔNG đo được: muốn tới đó phải qua `existsSync`
  // rồi mới hỏng ở `writeFileSync`, mà mọi cách làm hỏng đều khiến `existsSync`
  // trả true và chặn trước. Nó chỉ chạy khi quyền ghi mất giữa hai lệnh. Giữ
  // try/catch vì mất quyền là chuyện có thật, nhưng đừng tin ca này canh nó —
  // mutation bỏ try/catch sẽ sống sót, và sống sót đúng.
  mkdirSync(path.join(root, '.compass', '.gitignore'));

  let salt = null;
  assert.doesNotThrow(() => { salt = getSalt(root); }, 'getSalt không được ném');
  const saltCoThat = existsSync(path.join(root, '.compass', '.salt'));
  rmSync(root, { recursive: true, force: true });

  assert.equal(typeof salt, 'string');
  assert.ok(salt.length > 0, 'vẫn phải ký được dù không che được file');
  assert.ok(saltCoThat, '.salt phải được ghi — ký quan trọng hơn che');
});

test('CP-28-EC1 gọi getSalt lần hai không đổi salt, không ghi lại .gitignore', () => {
  const root = duAn();
  const a = getSalt(root);
  writeFileSync(ignorePath(root), '.salt\n# ghi chú của tôi\n');
  const b = getSalt(root);
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  rmSync(root, { recursive: true, force: true });

  assert.equal(a, b, 'salt phải giữ nguyên — đổi là mọi chữ ký cũ hỏng');
  assert.match(noiDung, /ghi chú của tôi/);
});

test('CP-28-EC2 compass init vẫn tạo .gitignore đúng một dòng .salt', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-salt-'));
  initCommand({ cwd: root, taskId: 'T-1', type: 'fix' });
  getSalt(root);
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  rmSync(root, { recursive: true, force: true });

  // Hai chỗ cùng ghi một file — nhân đôi dòng là dấu hiệu chúng đá nhau.
  const soDong = noiDung.split('\n').filter((l) => l.trim() === '.salt').length;
  assert.equal(soDong, 1, `.salt xuất hiện ${soDong} lần: ${JSON.stringify(noiDung)}`);
});
