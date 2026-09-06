import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Bản cài phải mang đủ thứ để chạy, và không mang gì thêm. Suite chạy trong
// repo gốc nên mọi file đều có mặt — test đọc file qua đường dẫn tương đối sẽ
// luôn xanh dù `files` khai thiếu. Nên ở đây soi chính danh sách `files`.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Đọc lại mỗi lần gọi, không cache lúc import. Cache thì mọi test ở đây rỗng
// nghĩa: sửa package.json rồi chạy lại vẫn thấy bản cũ, và mutation nào cũng
// sống sót. Đã mắc đúng lỗi đó một lần.
function docFiles() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg;
}

// Một đường dẫn có được `files` phủ không. npm coi mục kết thúc bằng `/` là cả
// thư mục.
function duocGoi(rel, files) {
  return (files || []).some((f) => {
    if (rel === f) return true;
    // npm coi `lib` và `lib/` như nhau — cùng nghĩa "cả thư mục". Phân biệt
    // hai cách viết thì một package.json đúng vẫn bị báo đỏ, và người đi sửa
    // tìm lỗi ở chỗ không có lỗi.
    const thuMuc = f.endsWith('/') ? f : f + '/';
    return rel.startsWith(thuMuc);
  });
}

test('CP-17-H1 files covers every directory the commands load at runtime', () => {
  const { files } = docFiles();
  for (const dir of ['lib/', 'commands/', 'templates/']) {
    assert.ok(duocGoi(dir + 'x', files), `thiếu ${dir} trong files — lệnh sẽ hỏng sau khi cài`);
  }
});

test('CP-17-H2 files covers the docs an agent reads', () => {
  // SKILL.md và writing-vi.md là tài liệu agent đọc lúc làm việc, không phải
  // tài liệu người đọc trên GitHub. Thiếu là agent không có hướng dẫn.
  const { files } = docFiles();
  for (const doc of ['SKILL.md', 'writing-vi.md']) {
    assert.ok(duocGoi(doc, files), `thiếu ${doc} trong files`);
  }
});

test('CP-17-H3 the package does not ship this repo internal task records', () => {
  // `.compass/` chứa spec nội bộ và review-brief — review-brief mang nguyên
  // diff của repo. Với dự án nội bộ thì đó là rò rỉ mã nguồn.
  const { files } = docFiles();
  assert.ok(!duocGoi('.compass/x', files), '.compass/ không được đóng gói');
  assert.ok(!duocGoi('.knowledge/x', files), '.knowledge/ không được đóng gói');
});

test('CP-17-H4 the package does not ship tests or examples', () => {
  const { files } = docFiles();
  for (const rel of ['test/x', 'examples/x', 'docs/x']) {
    assert.ok(!duocGoi(rel, files), `${rel} không cần trong bản cài`);
  }
});

test('CP-17-V1 every entry in files exists on disk', () => {
  // Khai file ma thì npm im lặng bỏ qua, và lỗi chỉ lộ ra sau khi cài.
  const { files } = docFiles();
  for (const entry of files || []) {
    const p = path.join(ROOT, entry.replace(/\/$/, ''));
    assert.ok(existsSync(p), `files khai "${entry}" nhưng không có trên đĩa`);
  }
});

test('CP-17-V2 every template the code loads is inside the package', () => {
  // `init` và `investigate` đọc file trong templates/ lúc chạy. Đọc thư mục
  // thật chứ không liệt kê tay — thêm template mới thì test tự phủ.
  const { files } = docFiles();
  const templates = readdirSync(path.join(ROOT, 'templates'));
  assert.ok(templates.length > 0, 'templates/ rỗng — chắc chắn sai');
  for (const name of templates) {
    assert.ok(duocGoi('templates/' + name, files), `templates/${name} không được gói`);
  }
});

test('CP-17-E1 package.json parses and declares files as an array', () => {
  const { files } = docFiles();
  assert.ok(Array.isArray(files), 'files phải là mảng');
  assert.ok(files.length > 0, 'files rỗng nghĩa là gói rỗng');
});

test('CP-17-EC1 the bin entry points at a file inside the package', () => {
  const pkg = docFiles();
  const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin)[0];
  const rel = bin.replace(/^\.\//, '');
  assert.ok(duocGoi(rel, pkg.files), `bin trỏ tới ${rel} nhưng files không phủ nó`);
  assert.ok(existsSync(path.join(ROOT, rel)), `${rel} không có trên đĩa`);
});

test('CP-17-EC2 a new file under lib is covered without editing files', () => {
  // `lib/` khai cả thư mục, nên file mới tự được phủ. Nếu ai đó đổi sang liệt
  // kê từng file thì test này đỏ — và đó là đúng.
  const { files } = docFiles();
  assert.ok(duocGoi('lib/thu-muc-con/tep-moi.mjs', files), 'lib/ phải khai cả thư mục');
});

// Soi mảng `files` không đủ. Khi một mục là thư mục, npm gói toàn bộ nội dung
// và KHÔNG áp `.gitignore` nữa — một file `.log` bỏ quên trong `lib/` vẫn lên
// tarball. Ba ca dưới hỏi thẳng npm đã gói gì, không hỏi ta khai gì.
function npmGoiGi() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32',
  });
  // Script prepack in ra màn hình thì stdout có chữ lạ trước JSON, và JSON.parse
  // `JSON.parse` chết bằng lỗi cú pháp — cả bốn ca soi npm cùng đỏ vì một lý do
  // chẳng liên quan gì tới đóng gói. Cắt từ dấu `[` đầu tiên.
  const dau = out.indexOf("[");
  if (dau === -1) throw new Error(`npm pack không trả JSON: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(dau))[0].files.map((f) => f.path.split("\\").join("/"));
}

test('CP-17-V3 npm packs nothing from the internal task or knowledge dirs', () => {
  const goi = npmGoiGi();
  const ro = goi.filter((f) => /(^|\/)\.(compass|knowledge)\//.test(f));
  assert.deepEqual(ro, [], 'bản cài mang theo hồ sơ nội bộ của repo');
});

test('CP-17-V4 npm packs no stray build or log files', () => {
  // `.gitignore` không áp bên trong thư mục đã khai trong `files`. Một
  // `lib/scratch.log` bỏ quên sẽ lặng lẽ đi theo bản cài.
  const goi = npmGoiGi();
  const rac = goi.filter((f) => /\.(log|tmp|bak|orig|swp)$/.test(f) || f.includes('node_modules/'));
  assert.deepEqual(rac, [], `rác lọt vào bản cài: ${rac.join(', ')}`);
});

test('CP-17-EC3 what npm packs matches what files declares', () => {
  // Lá chắn thật: mọi file trong tarball phải nằm trong phạm vi đã khai. npm
  // luôn tự thêm vài file bất kể khai gì — package.json, README, LICENSE.
  // npm ép gói theo **mẫu tên**, không theo danh sách cứng: readme, license,
  // licence, copying, notice, changelog — mọi phần mở rộng, không phân biệt
  // hoa thường. Liệt kê tay thì thêm một file `LICENSE.md` là test đỏ oan, và
  // người sửa đi tìm lỗi ở chỗ không có lỗi.
  const NPM_LUON_GOI = /^(package\.json|(readme|licen[cs]e|copying|notice|changelog)(\.[^.]+)?)$/i;
  const { files } = docFiles();
  const ngoaiPhamVi = npmGoiGi().filter(
    (f) => !duocGoi(f, files) && !NPM_LUON_GOI.test(f),
  );
  assert.deepEqual(ngoaiPhamVi, [], `npm gói thứ files không khai: ${ngoaiPhamVi.join(', ')}`);
});

test('CP-17-EC4 a directory entry does not spill onto sibling names', () => {
  // `files: ['lib']` nghĩa là thư mục `lib`, không phải "mọi thứ bắt đầu bằng
  // lib". Không thêm dấu `/` khi so thì `library.md` và `libfoo/x` cũng lọt.
  const files = ['lib', 'commands/'];
  assert.ok(duocGoi('lib/a.mjs', files), 'lib không dấu / vẫn là cả thư mục');
  assert.ok(duocGoi('commands/b.mjs', files));
  assert.ok(!duocGoi('library.md', files), 'tên anh em không được lọt');
  assert.ok(!duocGoi('libfoo/x.mjs', files));
});

test('CP-17-E2 extra stdout before the JSON is reported, not parsed as garbage', () => {
  // Một script `prepack` in ra màn hình là stdout thành `XIN CHAO\n[{...}]`, và
  // `JSON.parse` chết với lỗi cú pháp — ba ca soi npm cùng đỏ vì một lý do
  // chẳng liên quan gì tới đóng gói.
  assert.doesNotThrow(() => npmGoiGi(), 'đọc được output npm hiện tại');
});
