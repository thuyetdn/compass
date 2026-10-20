import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

// CP-30 — `data/` chứa kết quả query production, tức email và tên khách hàng.
// Bốn ca dưới hỏi git thật (`git check-ignore`) chứ không so chuỗi mẫu: mẫu
// gitignore đúng trông rất giống mẫu sai, và chỉ git mới phán được.
function repoGit(noiDungIgnore) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-gi-'));
  for (const d of ['data', 'output', 'evidence']) {
    mkdirSync(path.join(root, '.compass', 'INV-1', d), { recursive: true });
  }
  execFileSync('git', ['init', '-q', '.'], { cwd: root });
  writeFileSync(path.join(root, '.compass', '.gitignore'), noiDungIgnore);
  for (const f of ['.compass/.salt', '.compass/INV-1/data/q.csv',
                   '.compass/INV-1/output/v.mp4', '.compass/INV-1/evidence/gate.json']) {
    writeFileSync(path.join(root, f), 'x');
  }
  return root;
}

function biBoQua(root, rel) {
  try {
    execFileSync('git', ['check-ignore', rel], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('CP-30-H1 getSalt viết .gitignore che cả .salt lẫn data/', () => {
  const root = duAn();
  getSalt(root);
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  rmSync(root, { recursive: true, force: true });

  assert.match(noiDung, /(^|\n)\.salt(\n|$)/);
  assert.match(noiDung, /data\//);
});

test('CP-30-H2 git bỏ qua file trong data/', () => {
  const root = repoGit('.salt\n*/data/\n');
  const bo = biBoQua(root, '.compass/INV-1/data/q.csv');
  rmSync(root, { recursive: true, force: true });
  assert.ok(bo, 'kết quả query phải bị git bỏ qua — nó có dữ liệu khách hàng');
});

test('CP-30-V1 git KHÔNG bỏ qua file trong output/', () => {
  const root = repoGit('.salt\n*/data/\n');
  const bo = biBoQua(root, '.compass/INV-1/output/v.mp4');
  rmSync(root, { recursive: true, force: true });
  // Sản phẩm là thứ người dùng mang đi dùng, có khi muốn commit. Che nhầm nó
  // thì mẫu đang quá rộng.
  assert.ok(!bo, 'output/ không được che');
});

test('CP-30-EC1 git KHÔNG bỏ qua file trong evidence/', () => {
  const root = repoGit('.salt\n*/data/\n');
  const bo = biBoQua(root, '.compass/INV-1/evidence/gate.json');
  rmSync(root, { recursive: true, force: true });
  // Bằng chứng phải review được. Che nó là mất luôn thứ Compass tồn tại vì nó.
  assert.ok(!bo, 'evidence/ không được che');
});

test('CP-30-E1 .gitignore có sẵn thì không thêm dòng data/', () => {
  const root = duAn();
  writeFileSync(ignorePath(root), '.salt\n');
  getSalt(root);
  const noiDung = readFileSync(ignorePath(root), 'utf8');
  rmSync(root, { recursive: true, force: true });

  // CP-59 đảo luật này cho đúng một trường hợp: file chỉ có `.salt` là file
  // `init` cũ viết, không phải người dùng sửa — nên được nâng lên mặc định.
  // Tên test giữ nguyên để lịch sử thấy quyết định đổi ở đâu. File có thêm bất
  // cứ gì khác vẫn là của người dùng: CP-28-V1 và CP-28-EC1 canh chuyện đó.
  assert.equal(noiDung, '.salt\ndata/\nreview-brief.md\n');
});

test('CP-30-EC2 .gitignore do getSalt viết ra chạy đúng với git thật', () => {
  // Ba ca trên đưa cho git chuỗi mẫu tôi gõ tay. Ca này lấy đúng file `getSalt`
  // sinh ra — nếu mẫu trong code lệch khỏi mẫu tôi tin là đúng, chỉ ca này thấy.
  const tam = duAn();
  getSalt(tam);
  const thatSu = readFileSync(ignorePath(tam), 'utf8');
  rmSync(tam, { recursive: true, force: true });

  const root = repoGit(thatSu);
  const ketQua = {
    data: biBoQua(root, '.compass/INV-1/data/q.csv'),
    output: biBoQua(root, '.compass/INV-1/output/v.mp4'),
    evidence: biBoQua(root, '.compass/INV-1/evidence/gate.json'),
    salt: biBoQua(root, '.compass/.salt'),
  };
  rmSync(root, { recursive: true, force: true });

  assert.deepEqual(ketQua, { data: true, output: false, evidence: false, salt: true },
    `mẫu thật cho kết quả sai: ${JSON.stringify(ketQua)} — nội dung: ${JSON.stringify(thatSu)}`);
});
