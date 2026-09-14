import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanSecrets,
  isSecretFile,
  isExemptExample,
  readsEnv,
  addedLines,
  normalisePath,
} from '../lib/secrets-scan.mjs';

// A unified diff, built the way git writes one, so the parser is measured
// against real shape rather than a convenient stub.
function diffOf(file, addedText) {
  const lines = String(addedText).split('\n');
  return [
    `diff --git a/${file} b/${file}`,
    '--- /dev/null',
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join('\n');
}

const CLEAN = { diff: '', diffFiles: [], trackedFiles: [], untrackedUnignored: [] };

test('CP-40-H1 a diff with no .env anywhere passes', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('src/a.mjs', "const x = 1;\nexport default x;"),
    diffFiles: ['src/a.mjs'],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
});

test('CP-40-H2 .env.example in the diff is exempt and named as an example', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('.env.example', 'API_KEY=your-key-here'),
    diffFiles: ['.env.example'],
  });
  assert.equal(r.ok, true);
  assert.ok(r.notes.some((n) => n.includes('.env.example')), 'phải nói rõ là file ví dụ');
});

test('CP-40-H3 a declared read passes and the reason is reported', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('src/config.mjs', "import 'dotenv/config';"),
    diffFiles: ['src/config.mjs'],
    declared: 'local dev only',
  });
  assert.equal(r.ok, true);
  assert.equal(r.reads.length, 1);
  assert.ok(r.notes.some((n) => n.includes('local dev only')));
});

test('CP-40-E1 a secret file in the diff fails, and no value leaks', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('.env.production', 'KEY=abc'),
    diffFiles: ['.env.production'],
  });
  assert.equal(r.ok, false);
  const one = r.problems.find((p) => p.reason === 1);
  assert.ok(one, 'phải có vấn đề loại 1');
  assert.ok(one.message.includes('.env.production'));
  assert.equal(JSON.stringify(r).includes('abc'), false, 'giá trị trong file không được lọt ra');
});

test('CP-40-E2 a tracked .env fails even when the diff is clean', () => {
  const r = scanSecrets({ ...CLEAN, trackedFiles: ['.env'] });
  assert.equal(r.ok, false);
  const one = r.problems.find((p) => p.reason === 1);
  assert.ok(one.message.includes('tracked'));
  assert.ok(one.hint.includes('git rm --cached'));
});

test('CP-40-E3 an untracked, unignored .env fails with the gitignore line', () => {
  const r = scanSecrets({ ...CLEAN, untrackedUnignored: ['.env'] });
  assert.equal(r.ok, false);
  const two = r.problems.find((p) => p.reason === 2);
  assert.ok(two, 'phải có vấn đề loại 2');
  assert.ok(two.hint.includes('.gitignore'));
});

test('CP-40-E4 an undeclared read fails and names file and line', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('src/config.mjs', "const t = readFileSync('.env');"),
    diffFiles: ['src/config.mjs'],
  });
  assert.equal(r.ok, false);
  const three = r.problems.find((p) => p.reason === 3);
  assert.ok(three.message.includes('src/config.mjs:1'), three.message);
  assert.ok(three.hint.includes('Dùng .env:'));
});

test('CP-40-E5 a declaration covers reading, not committing', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('.env.local', 'K=v'),
    diffFiles: ['.env.local'],
    declared: 'local dev only',
  });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.reason === 1));
});

test('CP-40-EC1 process.env is not a file read', () => {
  assert.equal(readsEnv('const k = process.env.API_KEY'), null);
  assert.equal(readsEnv('const k = import.meta.env.VITE_X'), null);
});

test('CP-40-EC2 env.mjs and .environment are not secret files', () => {
  assert.equal(readsEnv("import { x } from './env.mjs'"), null);
  assert.equal(isSecretFile('.environment'), false);
  assert.equal(isSecretFile('src/env.mjs'), false);
  assert.equal(isSecretFile('.envrc'), false);
});

test('CP-40-EC3 a .env named in a comment or a markdown file is not a read', () => {
  assert.equal(readsEnv("// reads '.env' at startup"), null);
  assert.equal(readsEnv("# see '.env'"), null);
  assert.equal(readsEnv("/* '.env' */"), null);
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('README.md', "Put keys in '.env'."),
    diffFiles: ['README.md'],
  });
  assert.equal(r.ok, true);
});

test('CP-40-EC8 a line inside a multi-line block comment is not a read', () => {
  // A diff hands over the inside of a block comment with no `/*` on the line.
  // The gate flagged three lines of its own doc comments this way.
  assert.equal(readsEnv(" * agreeing that a task may read '.env' is not consent"), null);
});

test('CP-40-EC4 package.json in the diff is noted, never failed', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('package.json', '    "dotenv": "^16.0.0",'),
    diffFiles: ['package.json'],
  });
  assert.equal(r.ok, true);
  assert.ok(r.notes.some((n) => n.includes('dotenv')));
});

test('CP-40-EC5 a backslash path is matched all the same', () => {
  assert.equal(normalisePath('src\\config\\.env'), 'src/config/.env');
  const r = scanSecrets({ ...CLEAN, untrackedUnignored: ['config\\.env'] });
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].path, 'config/.env');
});

test('CP-40-EC6 a .env mention under test/ is not a read', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('test/secrets.test.mjs', "assert(readsEnv(\"'.env'\"))"),
    diffFiles: ['test/secrets.test.mjs'],
  });
  assert.equal(r.ok, true);
});

test('CP-40-EC7 an ignored .env stays green while an unignored one next to it fails', () => {
  // Bản đầu truyền `untrackedUnignored: []` — giống hệt CLEAN, nên không phép sửa
  // nào ở logic ignore làm nó đỏ được. Đo bằng cách cho hai file cùng lúc: cái đã
  // được ignore không nằm trong danh sách, cái chưa thì có.
  const r = scanSecrets({
    ...CLEAN,
    diffFiles: ['.env.example'],
    untrackedUnignored: ['.env.staging'],
  });
  assert.equal(r.ok, false, '.env.staging chưa ignore thì phải đỏ');
  assert.deepEqual(r.problems.map((p) => p.path), ['.env.staging']);

  const sach = scanSecrets({ ...CLEAN, diffFiles: ['.env.example'] });
  assert.equal(sach.ok, true, 'file đã ignore không tới danh sách này nên xanh');
});

test('CP-40-EC11 a two-segment .env name is a secret file, not a miss', () => {
  // `.env.production.local` là tên Next.js/Vite chỉ định cho override local —
  // chỗ chứa khoá thật nhất họ nhà `.env`. Regex cũ chỉ cho một segment hậu tố
  // nên nó lọt cả ba lý do cùng lúc.
  for (const f of ['.env.production.local', '.env.development.local', 'app/.env.test.local']) {
    assert.equal(isSecretFile(f), true, f);
  }
  const r = scanSecrets({ ...CLEAN, trackedFiles: ['.env.production.local'] });
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].path, '.env.production.local');
});

test('CP-40-EC12 a hex colour or a URL on the same line does not hide a read', () => {
  // `stripComments` cắt mù ở `#` và `//` đầu tiên thì `"#fff"` và `"https://…"`
  // xoá sạch phần sau — gate xanh trên đúng dòng có lỗi, và tách hai dòng lại bắt
  // được. Hành vi phụ thuộc cách xuống dòng là lỗi, không phải giới hạn.
  assert.ok(readsEnv('const c = { color: "#fff", cfg: require("dotenv").config({ path: ".env" }) };'));
  assert.ok(readsEnv('fetch("https://api.example.com"); const k = readFileSync(".env.production", "utf8");'));

  // Comment thật vẫn phải bị cắt.
  assert.equal(readsEnv('const x = 1; // đọc ".env" lúc khởi động'), null);
  assert.equal(readsEnv('# đọc ".env"'), null);
});

test('CP-40-S6 a value inside .env is never echoed as a read', () => {
  // `KEY="/srv/prod/.env.production"` là cú pháp dotenv bình thường. Quét nội
  // dung file `.env` làm gate in ra `new code reads /srv/prod/.env.production at
  // .env:2` — tức đưa nội dung file bí mật ra output, đúng điều spec case S2 cấm.
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('.env', 'A=1\nCONFIG_PATH="/srv/prod/.env.production"\nTOKEN=k9marker'),
    diffFiles: ['.env'],
  });
  assert.equal(r.ok, false, 'vẫn phải đỏ vì lý do 1');
  const dump = JSON.stringify(r);
  assert.equal(dump.includes('/srv/prod'), false, 'giá trị trong .env lọt ra ngoài');
  assert.equal(dump.includes('k9marker'), false, 'giá trị trong .env lọt ra ngoài');
  assert.equal(r.reads.length, 0, 'không được coi dòng trong .env là code đọc .env');
});

test('CP-40-S7 a line that looks like a diff header cannot re-point the file', () => {
  // `++ b/notes.md` trong code thành `+++ b/notes.md` trong diff. Đọc nó như tiêu
  // đề thì mọi dòng sau bị tính cho một file `.md`, mà `.md` thì lý do 3 bỏ qua.
  const coDongGia = scanSecrets({
    ...CLEAN,
    diff: diffOf('src/a.mjs', '++ b/notes.md\nreadFileSync(".env")'),
    diffFiles: ['src/a.mjs'],
  });
  assert.equal(coDongGia.ok, false, 'dòng giả tiêu đề không được che dòng đọc .env');

  const khongCo = scanSecrets({
    ...CLEAN,
    diff: diffOf('src/a.mjs', 'readFileSync(".env")'),
    diffFiles: ['src/a.mjs'],
  });
  assert.equal(khongCo.ok, false);
  assert.equal(coDongGia.problems.length, khongCo.problems.length, 'hai ca phải cho cùng kết quả');
});

test('CP-40-EC16 an escaped quote does not swallow a real read on the same line', () => {
  // `'don\\'t'` không đóng chuỗi ở dấu nháy thoát. Tách chuỗi bằng regex thì lệch
  // nhịp và mọi chuỗi sau đó trên cùng dòng bị bỏ, kể cả một `'.env'` thật.
  assert.equal(readsEnv(String.raw`const m = 'don\'t'; readFileSync('.env');`), '.env');
  assert.equal(readsEnv(String.raw`const m = "say \"hi\""; readFileSync(".env.local");`), '.env.local');
});

test('CP-40-EC14 readsEnv and isSecretFile agree on the same filename', () => {
  // Hai hàm từng tả hình dạng `.env` bằng hai regex riêng, và chúng lệch nhau:
  // `isSecretFile('.env.production.local')` true trong khi `readsEnv` cùng đường
  // dẫn trả null. Giờ chỉ còn một luật, nên mọi tên file phải cho cùng câu trả lời.
  for (const f of ['.env', '.env.local', '.env.production.local', '.env.development.local']) {
    assert.equal(isSecretFile(f), true, f);
    assert.equal(readsEnv(`readFileSync("${f}")`), f, `readsEnv bỏ sót ${f}`);
  }
});

test('CP-40-EC15 a URL ending in .env is not a file read', () => {
  // `"https://x.com/.env"` khớp mọi luật về tên file, nhưng mở nó là gọi mạng.
  assert.equal(readsEnv('const u = "https://x.com/.env";'), null);
  assert.equal(readsEnv('fetch("http://cfg.internal/.env.production")'), null);
  // Đường dẫn thật cùng dòng với URL vẫn phải bắt được.
  assert.ok(readsEnv('fetch("https://x.com/.env"); readFileSync(".env");'));
});

test('CP-40-EC13 a dynamic import of dotenv counts as a read', () => {
  assert.equal(readsEnv("const d = await import('dotenv');"), 'dotenv');
  assert.equal(readsEnv('import("dotenv/config");'), 'dotenv');
  assert.equal(readsEnv("import 'dotenv/config';"), 'dotenv');
  assert.equal(readsEnv("require('dotenv').config();"), 'dotenv');
});

test('CP-40-EC9 exempt suffixes are exactly example, sample and template', () => {
  assert.equal(isExemptExample('.env.example'), true);
  assert.equal(isExemptExample('.env.sample'), true);
  assert.equal(isExemptExample('.env.template'), true);
  assert.equal(isExemptExample('.env.production'), false);
  assert.equal(isSecretFile('.env.example'), false);
});

test('CP-40-EC18 the reason number matches the state, not just the wording', () => {
  // `CP-40-E8` kiểm lời văn, mà lời văn do biến khác quyết định — nên đổi
  // `reason: chuaIgnore ? 2 : 1` thành `reason: 1` vẫn xanh cả 49 test. Trường
  // `reason` là thứ gate dùng để nhóm và đếm vấn đề, nên nó phải được đo riêng.
  const chuaIgnore = scanSecrets({ ...CLEAN, untrackedUnignored: ['.env'] });
  assert.equal(chuaIgnore.problems[0].reason, 2, 'file chưa ignore là lý do 2');

  const daVaoGit = scanSecrets({ ...CLEAN, trackedFiles: ['.env'] });
  assert.equal(daVaoGit.problems[0].reason, 1, 'file đã theo dõi là lý do 1');

  const trongDiff = scanSecrets({ ...CLEAN, diffFiles: ['.env'] });
  assert.equal(trongDiff.problems[0].reason, 1, 'file trong diff là lý do 1');

  // Ca duy nhất chạy qua dòng phân loại `chuaIgnore ? 2 : 1`: file VỪA nằm trong
  // diff VỪA chưa được theo dõi. `collectDiff` dựng index tạm gồm file untracked
  // nên đây là hình dạng thật của một `.env` mới tạo, chưa commit, chưa ignore.
  // Ba ca trên đi qua nhánh khác, nên đổi dòng đó thành `reason: 1` vẫn xanh cả
  // ba — đúng lỗi mà chính test này sinh ra để chặn.
  const caHai = scanSecrets({ ...CLEAN, diffFiles: ['.env'], untrackedUnignored: ['.env'] });
  assert.equal(caHai.problems.length, 1, 'một file chỉ ra một vấn đề');
  assert.equal(caHai.problems[0].reason, 2, 'chưa theo dõi thì là lý do 2, không phải 1');
  assert.match(caHai.problems[0].hint, /\.gitignore/);
});

test('CP-40-S9 an uppercase .ENV is a secret file too', () => {
  // Trên Windows và macOS, `.ENV` CHÍNH LÀ file dotenv — hệ tệp không phân biệt
  // hoa thường. Luật phân biệt thì `.ENV` mang `AWS_SECRET_ACCESS_KEY` lọt sạch
  // cả ba lý do, và đây lại đúng là nền tảng dự án này đang chạy.
  for (const f of ['.ENV', '.Env', '.ENV.local', '.env.PRODUCTION']) {
    assert.equal(isSecretFile(f), true, f);
  }
  const r = scanSecrets({ ...CLEAN, trackedFiles: ['.ENV'] });
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].path, '.ENV');
});

test('CP-40-S10 a regex literal does not swallow a read on the same line', () => {
  // `/['"]/` chứa dấu nháy đơn có dấu đóng thật ở phía sau — dấu của `'.env'` —
  // nên trạng thái chuỗi treo tới hết dòng và nuốt luôn phần đọc. Cùng lớp lỗi
  // với ca mã màu và URL: kết quả phụ thuộc chỗ xuống dòng.
  assert.equal(readsEnv(String.raw`const Q = /['"]/g; readFileSync('.env');`), '.env');
  assert.equal(readsEnv(String.raw`const Q = /[']/g; readFileSync('.env');`), '.env');
  assert.equal(readsEnv(String.raw`const Q = /["]/g; readFileSync('.env');`), '.env');

  // Phép chia không được nhận nhầm thành regex — nhận nhầm thì nuốt code thật.
  assert.equal(readsEnv("const n = a / b; readFileSync('.env');"), '.env');
  assert.equal(readsEnv("const r = /abc/g; readFileSync('.env');"), '.env');
});

test('CP-40-S8 only the last suffix segment can grant the example exemption', () => {
  // Bản trước dùng `.some()` nên chữ `example` ở BẤT KỲ vị trí nào là được miễn:
  // `.env.example.production` mang khoá production thật vẫn lọt cả ba lý do.
  // Quy ước đặt tên là phần đuôi cuối nói file dùng vào việc gì.
  assert.equal(isSecretFile('.env.example.production'), true, 'đuôi .production là file thật');
  assert.equal(isSecretFile('.env.example.local'), true, 'đuôi .local là file thật');

  const r = scanSecrets({ ...CLEAN, trackedFiles: ['.env.example.production'] });
  assert.equal(r.ok, false, 'file production đội lốt ví dụ vẫn phải đỏ');
  assert.equal(r.problems[0].path, '.env.example.production');

  // Đuôi cuối là `example` thì vẫn là ví dụ, dù phía trước có gì.
  assert.equal(isSecretFile('.env.production.example'), false);
});

test('CP-40-S1 no value from a .env file appears in the result', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('.env', 'SECRET=zzz9\nOTHER=qqq8'),
    diffFiles: ['.env'],
  });
  assert.equal(r.ok, false);
  const dump = JSON.stringify(r);
  assert.equal(dump.includes('zzz9'), false);
  assert.equal(dump.includes('qqq8'), false);
});

test('CP-40-S2 a path-shaped line inside a .env is never printed', () => {
  const r = scanSecrets({
    ...CLEAN,
    diff: diffOf('.env', 'x=/tmp/.env'),
    diffFiles: ['.env'],
  });
  const ones = r.problems.filter((p) => p.reason === 1);
  assert.equal(ones.length, 1, 'file được nêu đúng một lần');
  assert.equal(JSON.stringify(r).includes('/tmp/'), false);
});

test('CP-40-V4 added lines carry the file and the line number they landed on', () => {
  const diff = [
    'diff --git a/src/a.mjs b/src/a.mjs',
    '--- a/src/a.mjs',
    '+++ b/src/a.mjs',
    '@@ -10,2 +10,3 @@',
    ' context',
    "+const t = 1;",
    ' more',
  ].join('\n');
  const added = addedLines(diff);
  assert.equal(added.length, 1);
  assert.equal(added[0].file, 'src/a.mjs');
  assert.equal(added[0].line, 11);
});

test('CP-40-V5 a removed line is never treated as added', () => {
  const diff = [
    'diff --git a/src/a.mjs b/src/a.mjs',
    '--- a/src/a.mjs',
    '+++ b/src/a.mjs',
    '@@ -1,2 +1,1 @@',
    "-const t = readFileSync('.env');",
    ' kept',
  ].join('\n');
  assert.deepEqual(addedLines(diff), []);
});

test('CP-40-P1 a 300-file diff with 20k added lines scans under 500 ms', () => {
  const parts = [];
  for (let f = 0; f < 300; f++) {
    parts.push(diffOf(`src/f${f}.mjs`, Array.from({ length: 66 }, (_, i) => `const v${i} = ${i};`).join('\n')));
  }
  const diff = parts.join('\n');
  const files = Array.from({ length: 300 }, (_, f) => `src/f${f}.mjs`);
  const t0 = Date.now();
  const r = scanSecrets({ ...CLEAN, diff, diffFiles: files });
  const ms = Date.now() - t0;
  assert.equal(r.ok, true);
  assert.ok(ms < 500, `quét mất ${ms}ms, phải dưới 500ms`);
});
