import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { secretsCommand } from '../commands/secrets.mjs';
import { checkCommand } from '../commands/check.mjs';
import { doneCommand } from '../commands/done.mjs';
import { readGate, verifyAllGates } from '../lib/gate-store.mjs';
import { collectDiff } from '../lib/review-brief.mjs';
import { initRepo } from './helpers/git-repo.mjs';

const SPEC = `# T-S: Gate secrets
Loại: fix
Phạm vi: src/

## Mục tiêu
Làm gì đó.

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

const GREEN = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\')"';

const dirs = [];

function git(root, args) {
  execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
}

// A repo with one real commit, so a diff exists to scan. `files` lands in the
// working tree first; `commit` decides whether it becomes history.
function makeRepo({ spec = SPEC, files = {}, commit = true, gitignore = null } = {}) {
  const root = initRepo(mkdtempSync(path.join(tmpdir(), 'compass-sec-')));
  dirs.push(root);
  mkdirSync(path.join(root, '.compass', 'T-S', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(root, '.compass', 'T-S', 'spec.md'), spec);
  if (gitignore !== null) writeFileSync(path.join(root, '.gitignore'), gitignore);

  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  if (commit && Object.keys(files).length) {
    git(root, ['add', '-A', '--force']);
    git(root, ['commit', '-q', '-m', 'work']);
  }
  return root;
}

test.after(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

test('CP-40-H4 check runs secrets for a fix task and records it', async () => {
  const root = makeRepo({ files: { 'src/a.mjs': 'export const a = 1;\n' } });
  const result = await checkCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /Gate secrets PASSED/);
  assert.ok(readGate(root, 'T-S', 'secrets'), 'phải có bản ghi secrets');
});

test('CP-40-H5 done closes after every gate including secrets is green', async () => {
  const root = makeRepo({ files: { 'src/a.mjs': 'export const a = 1;\n' } });
  await checkCommand({ cwd: root, taskId: 'T-S' });
  const result = doneCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 0, result.output);
});

test('CP-40-H6 the record carries sourceHash, specHash and a signature that verifies', () => {
  const root = makeRepo({ files: { 'src/a.mjs': 'export const a = 1;\n' } });
  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 0, result.output);

  const record = readGate(root, 'T-S', 'secrets');
  assert.match(record.sourceHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(record.specHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(record.diffHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(record.exitCode, 0);
  assert.equal(verifyAllGates(root, 'T-S').ok, true);
});

test('CP-40-H7 this repo scans clean against its own history', () => {
  // The gate must pass on a project that has no .env — including this one, on the
  // range the spec names. A gate that is red out of the box gets switched off.
  const result = secretsCommand({ cwd: process.cwd(), taskId: 'CP-40' });
  assert.equal(result.exitCode, 0, result.output);
});

test('CP-40-V1 a declaration with no reason is a usage error', () => {
  const spec = SPEC.replace('Phạm vi: src/', 'Phạm vi: src/\nDùng .env:');
  const root = makeRepo({ spec, files: { 'src/a.mjs': 'const a = 1;\n' } });
  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 2, result.output);
  assert.match(result.output, /không nêu lý do/);
});

test('CP-40-V2 a declaration below the first heading does not count as consent', () => {
  const spec = SPEC.replace('## Mục tiêu\nLàm gì đó.', '## Mục tiêu\nDùng .env: lý do đặt sai chỗ\nLàm gì đó.');
  const root = makeRepo({
    spec,
    files: { 'src/config.mjs': "import 'dotenv/config';\n" },
  });
  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /dotenv|\.env/);
});

test('CP-40-V3 a missing task id is a usage error naming the argument', () => {
  const result = secretsCommand({ cwd: process.cwd(), taskId: undefined });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /compass secrets <id>/);
});

test('CP-40-E6 a directory that is not a git repo is red, never green', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-nogit-'));
  dirs.push(root);
  mkdirSync(path.join(root, '.compass', 'T-S', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(root, '.compass', 'T-S', 'spec.md'), SPEC);

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /không đọc được diff/i);
});

test('CP-40-S3 the gate never reads a .env file from disk', () => {
  // Structural, not a promise: the two modules import no reader for these paths.
  // A gate that leaks the secret it guards is worse than no gate.
  // Đo import, không đo chữ trong file. Module này nói *về* `readFileSync('.env')`
  // trong chính lời giải thích của nó, nên quét chữ thì phải bỏ comment trước — mà
  // bỏ comment bằng regex lại đúng kiểu cắt mù vừa gây ra một Major ở đây. Danh
  // sách import thì đo được: không import hàm đọc file nào thì không đọc được file.
  const scan = readFileSync(path.join(process.cwd(), 'lib', 'secrets-scan.mjs'), 'utf8');
  const imports = scan.match(/^import\s[\s\S]*?from\s+['"][^'"]+['"];/gm) ?? [];
  assert.deepEqual(imports, [], 'lib/secrets-scan.mjs không được import gì — kể cả node:fs');

  // Với `commands/secrets.mjs` thì đo hành vi, không đo chữ: nó có đọc file thật
  // (spec, config), nên danh sách import không nói được gì, còn quét chuỗi lại
  // bắt nhầm chính đoạn comment ghi lại vì sao luật này tồn tại. Chạy gate trên
  // một repo có `.env` mang giá trị nhận dạng được rồi tìm giá trị đó ở khắp nơi
  // là phép đo thẳng vào điều cần bảo đảm.
  const root = makeRepo({
    files: { 'src/a.mjs': 'const a = 1;\n', '.env': 'TOKEN=zq7x9marker\n' },
    gitignore: '',
  });
  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, 'phải đỏ vì .env đã bị commit');
  assert.equal(result.output.includes('zq7x9marker'), false, 'giá trị lọt ra output');

  const gatePath = path.join(root, '.compass', 'T-S', 'evidence', 'gate.json');
  const ledger = readFileSync(gatePath, 'utf8');
  assert.equal(ledger.includes('zq7x9marker'), false, 'giá trị lọt vào bản ghi gate');

  // Tìm chuỗi đánh dấu là chưa đủ: một bản băm SHA-256 của nội dung cũng thoả
  // phép thử đó trong khi vẫn mang thông tin về file bí mật vào bản ghi đã ký.
  // Đo thẳng: đổi nội dung `.env` mà giữ nguyên độ dài, mọi trường trong bản ghi
  // phải y nguyên. Đây là đường mà `hashSource` từng đọc `.env` thật.
  const truoc = JSON.parse(readFileSync(gatePath, 'utf8'));
  // Cùng độ dài với giá trị cũ: `hashSource` băm kích thước file `.env` thay cho
  // nội dung, nên đổi độ dài là hash đổi hợp lệ và phép thử mất ý nghĩa.
  writeFileSync(path.join(root, '.env'), 'TOKEN=aa0b0marker\n');
  secretsCommand({ cwd: root, taskId: 'T-S' });
  const sau = JSON.parse(readFileSync(gatePath, 'utf8'));

  for (const truong of ['sourceHash', 'specHash']) {
    assert.equal(sau.secrets?.[truong] ?? sau[truong], truoc.secrets?.[truong] ?? truoc[truong],
      `${truong} đổi theo nội dung .env — tức là gate đã đọc file đó`);
  }

  // `diffHash` thì KHÁC, và cố ý: nó băm diff, mà diff của một file `.env` đã bị
  // commit thì chứa nội dung file đó — git đưa vào, không phải gate đọc. Gỡ nó ra
  // khỏi bản ghi là mất khả năng biết diff đã đổi, mà đó là thứ buộc bằng chứng
  // vào một bản code. Ranh giới: giá trị không bao giờ ở dạng đọc được.
  const dump = readFileSync(gatePath, 'utf8');
  assert.equal(dump.includes('aa0b0marker'), false, 'giá trị mới lọt vào bản ghi');
  assert.equal(dump.includes('zq7x9marker'), false, 'giá trị cũ lọt vào bản ghi');
});

test('CP-40-S4 a base ref starting with - is refused, never passed to git', () => {
  const spec = SPEC.replace('Phạm vi: src/', 'Phạm vi: src/\nGốc soi: --upload-pack=touch');
  const root = makeRepo({ spec, files: { 'src/a.mjs': 'const a = 1;\n' } });
  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);

  // Bản đầu viết `A && !B` với B khớp cả chữ "không" — mà output nào cũng có chữ
  // đó, nên assertion luôn đúng và không đo gì. Đo thẳng vào điều cần bảo đảm:
  // ref bị từ chối, và không file nào tên `touch` được tạo ra trong repo.
  assert.equal(existsSync(path.join(root, 'touch')), false, 'ref đã được git thực thi');
  assert.match(result.output, /không đọc được diff|Gốc soi/i);
});

test('CP-40-P2 scanning this repo end to end stays under 3 s', () => {
  const t0 = Date.now();
  const result = secretsCommand({ cwd: process.cwd(), taskId: 'CP-40' });
  const ms = Date.now() - t0;
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(ms < 3000, `mất ${ms}ms, phải dưới 3000ms`);
});

test('CP-40-E7 a committed .env fails the real command and names the path', () => {
  const root = makeRepo({
    files: { 'src/a.mjs': 'const a = 1;\n', '.env.production': 'KEY=abc\n' },
    gitignore: '',
  });
  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /\.env\.production/);
  assert.equal(result.output.includes('abc'), false, 'giá trị không được lọt ra output');
});

test('CP-40-EC10 check stops at secrets, so later gates never run on a leak', async () => {
  const root = makeRepo({
    files: { 'src/a.mjs': 'const a = 1;\n', '.env': 'K=v\n' },
    gitignore: '',
  });
  const result = await checkCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /Gate secrets FAILED/);
  assert.equal(/Gate test/.test(result.output), false, 'gate test không được chạy sau khi secrets đỏ');
});

test('CP-40-E8 an uncommitted .env gets the gitignore advice, not the git rm advice', () => {
  // `collectDiff` dựng index tạm có cả file chưa theo dõi, nên `.env` chưa commit
  // lần nào vẫn hiện "trong diff" và người dùng nhận lời khuyên "gỡ khỏi commit"
  // cho một commit không tồn tại. Hai trạng thái, hai cách sửa khác hẳn nhau.
  const root = makeRepo({ files: { 'src/a.mjs': 'const a = 1;\n' } });
  writeFileSync(path.join(root, '.env'), 'KEY=v\n');

  const chuaCommit = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(chuaCommit.exitCode, 1, chuaCommit.output);
  assert.match(chuaCommit.output, /not ignored/);
  assert.match(chuaCommit.output, /\.gitignore/);
  assert.equal(/git rm --cached/.test(chuaCommit.output), false, 'chưa commit thì đừng bảo gỡ khỏi commit');

  git(root, ['add', '-A', '--force']);
  git(root, ['commit', '-q', '-m', 'leak']);

  const daCommit = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(daCommit.exitCode, 1, daCommit.output);
  assert.match(daCommit.output, /tracked by git/);
  assert.match(daCommit.output, /git rm --cached/);
});

test('CP-40-EC17 a compass root nested inside a git repo reports one file, not two', () => {
  // `ls-files` trả đường dẫn tương đối với thư mục nó chạy, `collectDiff` trả
  // tương đối với gốc GIT. Hai gốc trùng nhau là bố cục duy nhất các test khác
  // dựng, nên lệch này không lộ ra: cùng một `.env` hiện hai lần dưới hai tên,
  // và mục đầu còn kèm lời khuyên sai.
  const gitRoot = mkdtempSync(path.join(tmpdir(), 'compass-nest-'));
  dirs.push(gitRoot);
  execFileSync('git', ['init', '-q'], { cwd: gitRoot, stdio: 'ignore' });
  for (const kv of [['user.email', 't@e.com'], ['user.name', 'T'], ['commit.gpgsign', 'false']]) {
    execFileSync('git', ['config', ...kv], { cwd: gitRoot, stdio: 'ignore' });
  }
  writeFileSync(path.join(gitRoot, 'README.md'), 'root\n');
  execFileSync('git', ['add', '-A'], { cwd: gitRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: gitRoot, stdio: 'ignore' });

  const sub = path.join(gitRoot, 'sub');
  mkdirSync(path.join(sub, '.compass', 'T-S', 'evidence'), { recursive: true });
  mkdirSync(path.join(sub, 'src'), { recursive: true });
  writeFileSync(path.join(sub, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(sub, '.compass', 'T-S', 'spec.md'), SPEC);
  writeFileSync(path.join(sub, 'src', 'a.mjs'), 'const a = 1;\n');
  writeFileSync(path.join(sub, '.env'), 'KEY=v\n');
  execFileSync('git', ['add', '-A', '--force'], { cwd: gitRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'work'], { cwd: gitRoot, stdio: 'ignore' });

  const result = secretsCommand({ cwd: sub, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /1 vấn đề/, 'một file phải ra một vấn đề: ' + result.output);
  assert.match(result.output, /sub\/\.env/);
  assert.equal(/Remove it from the commit/.test(result.output), false, 'file đã commit thì lời khuyên phải là git rm --cached');
});

test('CP-40-S5 a Soi đến line cannot hide a read that sits at HEAD', () => {
  // `Soi đến` cắt đuôi phạm vi y như `Phạm vi` cắt bề ngang. Gate này không được
  // nhận cả hai: một dòng hợp lệ trong spec là đủ để đẩy dòng đọc `.env` ra khỏi
  // tầm nhìn, mà lý do 3 lại là chỗ duy nhất có chốt xin phép của người duyệt.
  const root = makeRepo({ files: { 'src/a.mjs': 'const a = 1;\n' } });
  const B = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  writeFileSync(path.join(root, 'src', 'leak.mjs'), "readFileSync('.env');\n");
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'leak']);

  const spec = SPEC.replace('Phạm vi: src/', `Phạm vi: src/\nSoi đến: ${B}`);
  writeFileSync(path.join(root, '.compass', 'T-S', 'spec.md'), spec);

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, 'khai Soi đến không được làm gate mù: ' + result.output);
  assert.match(result.output, /leak\.mjs/);
});

// CP-50: một base commit đã có sẵn `files`, rồi spec khai `Gốc soi` vào đúng
// commit đó. Gốc mặc định là commit rỗng đầu tiên, mà từ đó nhìn thì `.env` của
// base là file task THÊM vào — tức không dựng được trạng thái "task gỡ file".
function repoWithBase({ files = {}, spec = SPEC } = {}) {
  const root = makeRepo();
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(root, ['add', '-A', '--force']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  writeFileSync(
    path.join(root, '.compass', 'T-S', 'spec.md'),
    spec.replace('Phạm vi: src/', `Phạm vi: src/\nGốc soi: ${base}`),
  );
  return { root, base };
}

// Đúng lời khuyên gate đưa cho `.env` đã bị theo dõi: `git rm --cached`, thêm vào
// `.gitignore`. `commit` quyết định việc gỡ đã vào lịch sử hay mới nằm ở index.
function untrackAsAdvised(root, { commit }) {
  git(root, ['rm', '-q', '--cached', '.env']);
  writeFileSync(path.join(root, '.gitignore'), '.env\n');
  git(root, ['add', '.gitignore']);
  if (commit) git(root, ['commit', '-q', '-m', 'untrack .env']);
}

const DECLARED = SPEC.replace('Phạm vi: src/', 'Phạm vi: src/\nDùng .env: chạy local');
const READ_ONLY = 'cho phép ĐỌC';

test('CP-50-H1 removing a tracked .env as the gate advises, committed, turns the gate green', () => {
  const { root } = repoWithBase({ files: { 'src/a.mjs': 'const a = 1;\n', '.env': 'TOKEN=abc\n' } });
  untrackAsAdvised(root, { commit: true });

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /PASSED/);
  assert.equal(result.output.includes('secret file'), false, result.output);
});

test('CP-50-H2 the same removal staged but not committed is green too', () => {
  const { root } = repoWithBase({ files: { 'src/a.mjs': 'const a = 1;\n', '.env': 'TOKEN=abc\n' } });
  untrackAsAdvised(root, { commit: false });

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /PASSED/);
});

test('CP-50-H3 a declared task sees the read-only warning for a new unignored .env file', () => {
  // Đi qua lệnh thật, không qua `scanSecrets`: file mới chưa commit thì
  // `ls-files --others` luôn liệt kê nó, nên nó là lý do 2 — trạng thái mà
  // CP-40-E5 không dựng, và bug chỉ sống trong đó.
  const root = makeRepo({ spec: DECLARED, files: { 'src/a.mjs': 'const a = 1;\n' } });
  writeFileSync(path.join(root, '.env.local'), 'K=v\n');

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.ok(result.output.includes('secret file not ignored: .env.local'), result.output);
  assert.ok(
    result.output.includes('Lời khai "Dùng .env: chạy local" cho phép ĐỌC, không cho phép commit.'),
    result.output,
  );
});

test('CP-50-V1 without a declaration a reason 2 failure carries no read-only warning', () => {
  const root = makeRepo({ files: { 'src/a.mjs': 'const a = 1;\n' } });
  writeFileSync(path.join(root, '.env.local'), 'K=v\n');

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.ok(result.output.includes('not ignored: .env.local'), result.output);
  assert.equal(result.output.includes(READ_ONLY), false, result.output);
});

test('CP-50-V2 a declared read with no .env file passes without the read-only warning', () => {
  const root = makeRepo({ spec: DECLARED, files: { 'src/config.mjs': "import 'dotenv/config';\n" } });

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.output.includes(READ_ONLY), false, result.output);
});

test('CP-50-E1 a .env the task adds and commits still fails as tracked', () => {
  const { root } = repoWithBase({ files: { 'src/a.mjs': 'const a = 1;\n', '.gitignore': '' } });
  writeFileSync(path.join(root, '.env'), 'TOKEN=abc\n');
  git(root, ['add', '-A', '--force']);
  git(root, ['commit', '-q', '-m', 'leak']);

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.ok(result.output.includes('secret file tracked by git: .env'), result.output);
});

test('CP-50-E2 a tracked .env the task edits and commits still fails as tracked', () => {
  const { root } = repoWithBase({ files: { 'src/a.mjs': 'const a = 1;\n', '.env': 'TOKEN=abc\n' } });
  writeFileSync(path.join(root, '.env'), 'TOKEN=abc\nOTHER=def\n');
  git(root, ['add', '-A', '--force']);
  git(root, ['commit', '-q', '-m', 'edit']);

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /tracked by git: \.env$/m);
});

test('CP-50-E3 a declared task that stages a .env file keeps the read-only warning', () => {
  const root = makeRepo({ spec: DECLARED, files: { 'src/a.mjs': 'const a = 1;\n' } });
  writeFileSync(path.join(root, '.env.local'), 'K=v\n');
  git(root, ['add', '.env.local']);

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.ok(result.output.includes('tracked by git: .env.local'), result.output);
  assert.ok(result.output.includes(READ_ONLY), result.output);
});

test('CP-50-EC1 untracking without ignoring leaves a reason 2 file, not a deleted one', () => {
  const { root } = repoWithBase({ files: { 'src/a.mjs': 'const a = 1;\n', '.env': 'TOKEN=abc\n' } });
  git(root, ['rm', '-q', '--cached', '.env']);

  // Cả hai trạng thái: gỡ mới nằm ở index, rồi gỡ đã commit. File vẫn trên đĩa
  // và chưa ignore, nên lần `git add -A` sau là nó quay lại — bộ lọc file đã xoá
  // không được nuốt nó ở trạng thái nào.
  for (const lan of ['staged', 'committed']) {
    if (lan === 'committed') git(root, ['commit', '-q', '-m', 'untrack only']);
    const result = secretsCommand({ cwd: root, taskId: 'T-S' });
    assert.equal(result.exitCode, 1, `${lan}: ${result.output}`);
    assert.ok(result.output.includes('secret file not ignored: .env'), `${lan}: ${result.output}`);
    assert.ok(result.output.includes('.gitignore'), `${lan}: ${result.output}`);
    assert.equal(result.output.includes('in the diff'), false, `${lan}: ${result.output}`);
  }
});

test('CP-50-EC2 a .env.production removed with git rm and committed passes', () => {
  const { root } = repoWithBase({
    files: { 'src/a.mjs': 'const a = 1;\n', '.env.production': 'TOKEN=abc\n' },
  });
  git(root, ['rm', '-q', '.env.production']);
  git(root, ['commit', '-q', '-m', 'remove']);
  assert.equal(existsSync(path.join(root, '.env.production')), false, 'git rm phải xoá cả trên đĩa');

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 0, result.output);
});

test('CP-50-EC3 a .env moved with git mv still fails under its new path', () => {
  const { root } = repoWithBase({ files: { 'src/a.mjs': 'const a = 1;\n', '.env': 'TOKEN=abc\n' } });
  mkdirSync(path.join(root, 'config'));
  git(root, ['mv', '.env', 'config/.env']);
  git(root, ['commit', '-q', '-m', 'move']);

  const result = secretsCommand({ cwd: root, taskId: 'T-S' });
  assert.equal(result.exitCode, 1, result.output);
  assert.ok(result.output.includes('config/.env'), result.output);
});

test('CP-50-EC4 collectDiff still lists the removed .env in files, and only it in deleted', () => {
  const { root, base } = repoWithBase({ files: { 'src/a.mjs': 'const a = 1;\n', '.env': 'TOKEN=abc\n' } });
  untrackAsAdvised(root, { commit: true });

  // Đúng bộ tham số `secrets` truyền vào.
  const collected = collectDiff(root, {
    baseRef: base,
    baseFrom: 'spec',
    endRef: null,
    endFrom: 'spec',
    scopePaths: [],
  });
  assert.equal(collected.ok, true, collected.reason);
  assert.ok(collected.files.includes('.env'), collected.files.join(', '));
  assert.ok(collected.files.includes('.gitignore'), collected.files.join(', '));
  assert.deepEqual(collected.deleted, ['.env']);
});

test('CP-50-S1 neither the removal nor the declared warning prints a value from the .env file', () => {
  const MARKER = 'zq7x9marker';

  const { root: daGo } = repoWithBase({
    files: { 'src/a.mjs': 'const a = 1;\n', '.env': `TOKEN=${MARKER}\n` },
  });
  untrackAsAdvised(daGo, { commit: true });

  const daKhai = makeRepo({ spec: DECLARED, files: { 'src/a.mjs': 'const a = 1;\n' } });
  writeFileSync(path.join(daKhai, '.env.local'), `TOKEN=${MARKER}\n`);

  for (const [root, exit] of [[daGo, 0], [daKhai, 1]]) {
    const result = secretsCommand({ cwd: root, taskId: 'T-S' });
    assert.equal(result.exitCode, exit, result.output);
    assert.equal(result.output.includes(MARKER), false, 'giá trị lọt ra output');
    const ledger = readFileSync(path.join(root, '.compass', 'T-S', 'evidence', 'gate.json'), 'utf8');
    assert.equal(ledger.includes(MARKER), false, 'giá trị lọt vào bản ghi gate');
  }

  // Cùng phép đo với CP-40-S3: danh sách `deleted` là đường dẫn từ git, nên
  // module quét vẫn không cần import hàm đọc file nào.
  const scan = readFileSync(path.join(process.cwd(), 'lib', 'secrets-scan.mjs'), 'utf8');
  const imports = scan.match(/^import\s[\s\S]*?from\s+['"][^'"]+['"];/gm) ?? [];
  assert.deepEqual(imports, [], 'lib/secrets-scan.mjs không được import gì');
});
