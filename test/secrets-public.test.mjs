import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { secretsCommand } from '../commands/secrets.mjs';
import { statusCommand } from '../commands/status.mjs';
import { testCommand } from '../commands/test.mjs';
import { doneCommand } from '../commands/done.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { scanSecrets, isExemptExample } from '../lib/secrets-scan.mjs';
import { sha256 } from '../lib/hash.mjs';
import { measureGrowth } from './helpers/growth.mjs';

// CP-91 — issue #3. `secretsPublic` trong config.json miễn lý do 1 cho file `.env`
// đã commit có chủ ý (cấu hình public); đuôi `.dist` là file mẫu như `.example`.

const SECRET = 'SECRET_VALUE_91';
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

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
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
}

const SPEC = (scope) => `# T-1: việc trong fe
Loại: fix
Phạm vi: ${scope}

## Mục tiêu
Đổi fe.

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

const PASSING_TEST = `node -e "console.log('ok 1 - H1 a'); console.log('ok 2 - H2 b')"`;

function writeConfig(root, extra = {}) {
  const config = {
    test: PASSING_TEST,
    repos: { be: { test: PASSING_TEST }, fe: { test: PASSING_TEST } },
    ...extra,
  };
  if (config.secretsPublic === undefined) delete config.secretsPublic;
  put(root, '.compass/config.json', JSON.stringify(config));
}

// Bố cục issue #3: gốc chỉ theo dõi `.compass/`; `be` đã commit `.env` public từ lâu;
// task sửa `fe` (một thay đổi chưa commit).
function workspace({
  secretsPublic,
  scope = 'fe/a.js',
  beFiles = { '.env': `K=${SECRET}\n`, '.env.alpha': `K=${SECRET}\n` },
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp91-'));
  writeConfig(root, { secretsPublic });
  put(root, '.compass/T-1/spec.md', SPEC(scope));
  initGit(root);
  put(root, '.gitignore', '/*\n!/.compass/\n!/.gitignore\n');
  commit(root, 'workspace');

  const be = path.join(root, 'be');
  initGit(be);
  put(be, 'b.js', 'export const b = 1\n');
  for (const [f, body] of Object.entries(beFiles)) put(be, f, body);
  commit(be, 'be');

  const fe = path.join(root, 'fe');
  initGit(fe);
  put(fe, 'a.js', 'export const a = 1\n');
  commit(fe, 'fe');
  put(fe, 'a.js', 'export const a = 2\n');
  return { root, be, fe };
}

const secrets = (root) => secretsCommand({ cwd: root, taskId: 'T-1' });
const gateJson = (root) => readFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'gate.json'), 'utf8');
const infoLines = (out) => out.split('\n').filter((l) => l.startsWith('ℹ'));

test('CP-91-H1 tracked .env files declared public in an out-of-scope repo pass, one ℹ line each', () => {
  // Đối chứng: cùng bố cục, chưa khai thì đỏ trên cả hai file.
  const { root } = workspace();
  const red = secrets(root);
  assert.equal(red.exitCode, 1, red.output);
  assert.match(red.output, /secret file tracked by git: be\/\.env\n/);
  assert.match(red.output, /secret file tracked by git: be\/\.env\.alpha/);

  writeConfig(root, { secretsPublic: ['be/.env', 'be/.env.alpha'] });
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
  const info = infoLines(r.output);
  assert.equal(info.filter((l) => /be\/\.env(?![.\w])/.test(l)).length, 1, r.output);
  assert.equal(info.filter((l) => /be\/\.env\.alpha/.test(l)).length, 1, r.output);
  // Dòng PASSED không được nói index sạch: hai file đó vẫn nằm trong index, chỉ là không quét.
  const passed = r.output.split('\n').find((l) => l.includes('PASSED'));
  assert.doesNotMatch(passed, /không thấy file \.env nào[^\n]*trong index/, passed);
  assert.match(passed, /2 file[^\n]*public/, passed);
});

test('CP-91-H2 tracked .env.dist and .env.docker.dist are example files', () => {
  const { root, be } = workspace({
    scope: 'be/b.js',
    beFiles: { 'backend/.env.dist': 'K=x\n', 'backend/.env.docker.dist': 'K=y\n' },
  });
  put(be, 'backend/.env.dist', 'K=x2\n');
  put(be, 'backend/.env.docker.dist', 'K=y2\n');
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /example file, exempt: .*be\/backend\/\.env\.dist/);
  assert.match(r.output, /example file, exempt: .*be\/backend\/\.env\.docker\.dist/);
});

test('CP-91-H3 single-git project with a tracked .env declared public passes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp91-one-'));
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', secretsPublic: ['.env'] }));
  put(root, '.compass/T-1/spec.md', SPEC('a.js'));
  initGit(root);
  put(root, '.env', `K=${SECRET}\n`);
  put(root, 'a.js', 'export const a = 1\n');
  commit(root, 'one');
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(infoLines(r.output).filter((l) => l.includes('.env')).length, 1, r.output);
});

test('CP-91-H4 the declaration holds for a repo inside Phạm vi whose public .env the task edits', () => {
  const { root, be } = workspace({ scope: 'be/b.js', secretsPublic: ['be/.env', 'be/.env.alpha'] });
  put(be, '.env.alpha', 'K=changed\n');
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /be\/\.env\.alpha/);
});

test('CP-91-H5 status lists the declared public files', () => {
  const { root } = workspace({ secretsPublic: ['be/.env', 'be/.env.alpha'] });
  // Đối chứng: chưa khai thì output kết thúc như trước, không có dòng nào về secretsPublic.
  writeConfig(root);
  const before = statusCommand({ cwd: root });
  assert.doesNotMatch(before.output, /secretsPublic/);
  assert.match(before.output, /sai ở đây thì gate `test` đỏ mà không rõ vì sao\.$/);

  writeConfig(root, { secretsPublic: ['be/.env', 'be/.env.alpha'] });
  const r = statusCommand({ cwd: root });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /secretsPublic/);
  assert.match(r.output, /be\/\.env\n/);
  assert.match(r.output, /be\/\.env\.alpha/);
});

test('CP-91-V1 secretsPublic that is not an array is refused', () => {
  const { root } = workspace({ secretsPublic: 'be/.env' });
  const r = secrets(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /secretsPublic/);
  assert.match(r.output, /danh sách/);
  // `status` nói trước điều gate sẽ từ chối.
  const s = statusCommand({ cwd: root });
  assert.match(s.output, /⚠ secretsPublic có lỗi/);
  assert.match(s.output, /danh sách/);
});

test('CP-91-V2 a wildcard entry is refused and the message says to list each file', () => {
  const { root } = workspace({ secretsPublic: ['be/.env*'] });
  const r = secrets(root);
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /be\/\.env\*/);
  assert.match(r.output, /từng file/);
});

test('CP-91-V3 empty, non-string, absolute, parent and dash entries are each refused', () => {
  for (const [entry, shows] of [
    ['', /mục 1/],
    [5, /mục 1/],
    ['/srv/.env', /\/srv\/\.env/],
    ['C:/x/.env', /C:\/x\/\.env/],
    ['be/../.env', /be\/\.\.\/\.env/],
    ['-be/.env', /-be\/\.env/],
  ]) {
    const { root } = workspace({ secretsPublic: [entry] });
    const r = secrets(root);
    assert.equal(r.exitCode, 2, `${JSON.stringify(entry)}\n${r.output}`);
    assert.match(r.output, shows, JSON.stringify(entry));
  }
});

test('CP-91-V4 an entry that names no blocked file is refused', () => {
  for (const entry of ['src/app.js', 'be/.env.example']) {
    const { root } = workspace({ secretsPublic: [entry] });
    const r = secrets(root);
    assert.equal(r.exitCode, 2, `${entry}\n${r.output}`);
    assert.match(r.output, new RegExp(entry.replace(/[.]/g, '\\.')));
  }
});

test('CP-91-V5 a backslash entry with a leading .\\ is read as the repo path', () => {
  const { root } = workspace({ secretsPublic: ['.\\be\\.env', '.\\be\\.env.alpha'] });
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-91-E1 a declared file git does not track changes nothing and is named in an ℹ line', () => {
  const { root } = workspace({ secretsPublic: ['be/.env', 'be/.env.alpha', 'be/.env.prod'] });
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
  const line = infoLines(r.output).find((l) => l.includes('be/.env.prod'));
  assert.ok(line, r.output);
  assert.match(line, /không theo dõi/);
});

test('CP-91-E2 an invalid secretsPublic does not stop the test gate', () => {
  const { root } = workspace({ secretsPublic: ['be/.env*'] });
  const r = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(secrets(root).exitCode, 2);
});

test('CP-91-E3 secretsPublic is read from a config loadConfig rejects, and a broken config is named', () => {
  const { root } = workspace();
  const file = path.join(root, '.compass', 'config.json');
  put(root, '.compass/config.json', JSON.stringify({
    repos: { be: { test: PASSING_TEST }, fe: { test: PASSING_TEST } },
    secretsPublic: ['be/.env', 'be/.env.alpha'],
  }));
  const r = secrets(root);
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(infoLines(r.output).filter((l) => /secretsPublic: không quét be\/\.env/.test(l)).length, 2, r.output);
  assert.equal(JSON.parse(gateJson(root)).secrets.configHash, sha256(readFileSync(file, 'utf8')));

  put(root, '.compass/config.json', '{ "secretsPublic": [');
  // Mã thoát ở đây không thuộc CP-91: config hỏng thì `repos` cũng mất, và repo con nào
  // được quét là chuyện của workspace-git. Chỉ đòi gate nói ra là lời khai không được đọc.
  const broken = secrets(root);
  assert.equal(infoLines(broken.output).filter((l) => /secretsPublic/.test(l) && /không đọc/.test(l)).length, 1, broken.output);
});

test('CP-91-EC1 an undeclared tracked .env next to a declared one still fails, alone', () => {
  const { root } = workspace({
    secretsPublic: ['be/.env'],
    beFiles: { '.env': `K=${SECRET}\n`, '.env.local': `K=${SECRET}\n` },
  });
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /secret file tracked by git: be\/\.env\.local/);
  assert.doesNotMatch(r.output, /secret file tracked by git: be\/\.env\n/);
  assert.match(r.output, /1 vấn đề/);
  // Gate đỏ vì file khác vẫn kể tên file nó không quét.
  assert.equal(infoLines(r.output).filter((l) => /be\/\.env(?![.\w])/.test(l)).length, 1, r.output);
});

test('CP-91-EC2 .env.dist.local is a local override, not an example', () => {
  const { root } = workspace({ beFiles: { '.env.dist.local': `K=${SECRET}\n` } });
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /be\/\.env\.dist\.local/);
});

test('CP-91-EC3 a declared path in another case does not exempt the file', () => {
  const { root } = workspace({ secretsPublic: ['BE/.env', 'be/.env.alpha'] });
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /secret file tracked by git: be\/\.env\n/);
});

test('CP-91-EC4 the last suffix decides whether a .env file is an example', () => {
  assert.equal(isExemptExample('.env.dist'), true);
  assert.equal(isExemptExample('a/.env.docker.dist'), true);
  assert.equal(isExemptExample('.env.DIST'), true);
  assert.equal(isExemptExample('.env.dist.local'), false);
  assert.equal(isExemptExample('.env.production.example'), true);
  assert.equal(isExemptExample('.env.example.production'), false);
});

test('CP-91-S1 a declared file removed from the index but left on disk unignored still fails', () => {
  const { root, be } = workspace({ secretsPublic: ['be/.env', 'be/.env.alpha'] });
  git(be, ['rm', '-q', '--cached', '.env']);
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /secret file not ignored: be\/\.env\n/);
});

test('CP-91-S2 a declared file that is untracked and unignored still fails', () => {
  const { root, fe } = workspace({ secretsPublic: ['be/.env', 'be/.env.alpha', 'fe/.env.local'] });
  put(fe, '.env.local', `K=${SECRET}\n`);
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /secret file not ignored: fe\/\.env\.local/);
});

test('CP-91-S3 new code reading a declared file still needs Dùng .env', () => {
  const { root, fe } = workspace({ secretsPublic: ['be/.env', 'be/.env.alpha'] });
  put(fe, 'a.js', "require('fs').readFileSync('../be/.env')\n");
  const r = secrets(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /new code reads/);
});

test('CP-91-S4 no value from a declared or undeclared file reaches the output or gate.json', () => {
  const ok = workspace({ secretsPublic: ['be/.env', 'be/.env.alpha'] });
  const green = secrets(ok.root);
  assert.equal(green.exitCode, 0, green.output);
  assert.doesNotMatch(green.output, new RegExp(SECRET));
  assert.doesNotMatch(gateJson(ok.root), new RegExp(SECRET));

  const bad = workspace({ secretsPublic: ['be/.env'], beFiles: { '.env': `K=${SECRET}\n`, '.env.local': `K=${SECRET}\n` } });
  const red = secrets(bad.root);
  assert.equal(red.exitCode, 1, red.output);
  assert.doesNotMatch(red.output, new RegExp(SECRET));
  assert.doesNotMatch(gateJson(bad.root), new RegExp(SECRET));
});

const configChanged = /config\.json đã đổi[^\n]*"secrets"|"secrets"[^\n]*config\.json đã đổi/;

test('CP-91-S5 removing a declaration after a green run makes done reject the secrets record', () => {
  const { root } = workspace({ secretsPublic: ['be/.env', 'be/.env.alpha'] });
  assert.equal(secrets(root).exitCode, 0);

  const before = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(before.output, configChanged, 'control: unchanged config is not reported');

  writeConfig(root);
  const after = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(after.exitCode, 0);
  assert.match(after.output, configChanged, after.output);
});

test('CP-91-S6 a secrets record without configHash is an old record', () => {
  const { root } = workspace({ secretsPublic: ['be/.env', 'be/.env.alpha'] });
  assert.equal(secrets(root).exitCode, 0);
  const record = JSON.parse(gateJson(root)).secrets;
  const { configHash, sig, ...rest } = record;
  writeGate(root, 'T-1', rest);
  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(r.exitCode, 0);
  assert.match(r.output, /"secrets" không ghi lại config\.json/, r.output);
});

test('CP-91-S7 a 3.1.2 secrets record, which hashed the parsed config, is rejected by done', () => {
  const { root } = workspace({ secretsPublic: ['be/.env', 'be/.env.alpha'] });
  // config.json thật thường viết thụt dòng, nên băm file khác băm JSON đã parse.
  const file = path.join(root, '.compass', 'config.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  put(root, '.compass/config.json', JSON.stringify(parsed, null, 2));
  assert.equal(secrets(root).exitCode, 0);
  const { sig, ...record } = JSON.parse(gateJson(root)).secrets;
  writeGate(root, 'T-1', { ...record, configHash: sha256(JSON.stringify(parsed)) });
  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(r.exitCode, 0);
  assert.match(r.output, configChanged, r.output);
  assert.match(r.output, /3\.1\.2/, r.output);
});

function gitCalls(root) {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-cp91-trace-'));
  const file = path.join(dir, 'trace.log');
  const old = process.env.GIT_TRACE;
  process.env.GIT_TRACE = file;
  try {
    secrets(root);
  } finally {
    if (old === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = old;
  }
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8').split('\n').filter((l) => /trace: built-in: git /.test(l)).length;
}

test('CP-91-P1 the declaration adds no git call', () => {
  const { root } = workspace();
  const without = gitCalls(root);
  writeConfig(root, { secretsPublic: ['be/.env', 'be/.env.alpha'] });
  const withList = gitCalls(root);
  assert.ok(without > 0, 'GIT_TRACE recorded nothing: the measurement did not happen');
  assert.equal(withList, without);
});

// Đo qua `measureGrowth` (CP-62: file test không đọc đồng hồ): năm cặp xen kẽ,
// lấy tỉ số nhỏ nhất. Đo 27/10/2026: tra cứu bằng Set đọc 0,76–1,30×; ba cách so
// từng cặp (`tracked.includes` ở hai danh sách lời khai, `publicFiles.includes` ở
// bộ lọc lý do 1) đọc 5,4–7,1×. Ngưỡng 3 nằm giữa, cách mỗi phía khoảng 2×.
// Mọi file theo dõi đều là `.env`: bản đầu để 19.000 file `.js` lẫn vào, chi phí
// lọc theo tên che mất chi phí tra cứu, và một matcher so từng cặp trên danh sách
// đã lọc chỉ đọc 1,2–1,7× — test xanh trên đúng bản hồi quy nó canh.
test('CP-91-P2 declared lookup does not grow with tracked × declared', () => {
  const tracked = [];
  for (let i = 0; i < 20_000; i++) tracked.push(`d${i}/.env`);
  // Khai từ CUỐI danh sách: khai từ đầu thì `includes` dừng sớm ở mỗi lần tra và
  // matcher so từng cặp cũng rẻ như Set.
  const declared = (n) => Array.from({ length: n }, (_, i) => `d${19_999 - i}/.env`);

  const result = measureGrowth({
    run: (n) => scanSecrets({ trackedFiles: tracked, publicFiles: declared(n) }),
    small: 500,
    large: 10_000,
    pairs: 5,
    warmup: 1,
  });
  assert.ok(result.ratio <= 3, `10000 khai / 500 khai: tỉ số nhỏ nhất ${result.ratio.toFixed(2)} (${result.ratios.map((x) => x.toFixed(2)).join(', ')})`);
});
