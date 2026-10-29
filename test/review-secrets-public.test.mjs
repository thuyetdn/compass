import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewCommand } from '../commands/review.mjs';
import { secretsPublicSection, briefSecretsPublic, SECRETS_PUBLIC_HEADING } from '../lib/review-brief.mjs';
import { parseSecretsPublic } from '../lib/secrets-scan.mjs';
import { briefIdIn, playReviewer } from './helpers/review.mjs';
import { measureGrowth } from './helpers/growth.mjs';

// CP-93 — diff của brief bỏ `.compass/**`, nên một task tự khai file `.env` của mình
// vào `secretsPublic` thì người soi không thấy. Brief giờ liệt kê lời khai, đánh dấu
// dòng nào task thêm so với config.json ở gốc soi.

const SECRET = 'SECRET_VALUE_93';

function put(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
function initGit(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'core.autocrlf', 'false']);
}
function commit(dir, msg) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

const SPEC = (base) => `# T-1: việc nhỏ
Loại: feature-s
${base ? `Gốc soi: ${base}\n` : ''}Phạm vi: src/a.js

## Mục tiêu
Đổi a.

## Ràng buộc
Không.

## Rủi ro hồi quy
Không.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
`;

const config = (secretsPublic) => JSON.stringify(secretsPublic === undefined ? { test: 'true' } : { test: 'true', secretsPublic });

// Một git ở gốc theo dõi cả `.compass/config.json`. `base` là config lúc commit gốc soi
// (chuỗi thô, để viết được JSON hỏng); `baseFiles` commit cùng lúc; `now` là
// `secretsPublic` của config hiện tại.
function repo({ base = config(), now, baseFiles = {}, trackConfig = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp93-'));
  initGit(root);
  put(root, 'src/a.js', 'export const a = 1\n');
  for (const [f, body] of Object.entries(baseFiles)) put(root, f, body);
  if (trackConfig) put(root, '.compass/config.json', base);
  const sha = commit(root, 'base');
  put(root, '.compass/config.json', config(now));
  put(root, '.compass/T-1/spec.md', SPEC(sha));
  put(root, 'src/a.js', 'export const a = 2\n');
  return root;
}

const review = (root) => reviewCommand({ cwd: root, taskId: 'T-1' });
const brief = (root) => readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
const lineFor = (text, p) => text.split('\n').filter((l) => l.startsWith(`- \`${p}\``));
function section(root) {
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  const text = brief(root);
  const at = text.indexOf(SECRETS_PUBLIC_HEADING);
  return at < 0 ? '' : text.slice(at, text.indexOf('\n---\n', at));
}

test('CP-93-H1 a path the task adds to secretsPublic is listed and marked new', () => {
  const s = section(repo({ now: ['be/.env'] }));
  assert.ok(s, 'brief thiếu mục secretsPublic');
  const [line] = lineFor(s, 'be/.env');
  assert.match(line, /\*\*mới\*\*/);
});

test('CP-93-H2 a path already declared at the base is marked existing', () => {
  const s = section(repo({ base: config(['be/.env']), now: ['be/.env'] }));
  const [line] = lineFor(s, 'be/.env');
  assert.match(line, /có từ trước/);
  assert.doesNotMatch(line, /mới|không biết/);
});

test('CP-93-H3 an existing and an added path are marked apart', () => {
  const s = section(repo({ base: config(['be/.env']), now: ['be/.env', 'be/.env.alpha'] }));
  assert.match(lineFor(s, 'be/.env')[0], /có từ trước/);
  assert.match(lineFor(s, 'be/.env.alpha')[0], /\*\*mới\*\*/);
});

function reopensAfter(change) {
  const root = repo({ base: config(['be/.env']), now: ['be/.env', 'be/.env.alpha'] });
  const passed = playReviewer(root, 'T-1');
  assert.equal(passed.exitCode, 0, passed.output);
  const oldId = briefIdIn(root, 'T-1');

  put(root, '.compass/config.json', config(change));
  const reopened = review(root);
  assert.equal(reopened.exitCode, 1, reopened.output);
  assert.match(reopened.output, /secretsPublic[^\n]*đã đổi/);
  assert.notEqual(briefIdIn(root, 'T-1'), oldId, 'id brief phải đổi theo danh sách khai');

  // findings.json cũ vẫn nằm đó: chạy lại không được xanh.
  const again = review(root);
  assert.notEqual(again.exitCode, 0, again.output);
  const text = brief(root);

  // Pha một (chưa ai nộp findings) cũng nói đúng thứ đã đổi.
  rmSync(path.join(root, '.compass', 'T-1', 'evidence', 'findings.json'));
  put(root, '.compass/config.json', config([...change, 'be/.env.phase1']));
  const phaseOne = review(root);
  assert.equal(phaseOne.exitCode, 1, phaseOne.output);
  assert.match(phaseOne.output, /secretsPublic[^\n]*đã đổi — brief cũ/);
  return text;
}

test('CP-93-H4 adding a declared path after a review reopens it, and old findings do not pass', () => {
  const text = reopensAfter(['be/.env', 'be/.env.alpha', 'be/.env.prod']);
  assert.match(lineFor(text, 'be/.env.prod')[0], /\*\*mới\*\*/);
});

test('CP-93-H5 removing a declared path after a review reopens it', () => {
  const text = reopensAfter(['be/.env']);
  assert.equal(lineFor(text, 'be/.env.alpha').length, 0);
});

test('CP-93-H6 no secretsPublic, or an empty one, leaves the brief and its id untouched', () => {
  // Cùng một repo: sha gốc soi nằm trong spec, nên hai repo tạm commit khác giây có id khác.
  const root = repo();
  assert.equal(review(root).exitCode, 1);
  const before = brief(root);
  const id = briefIdIn(root, 'T-1');
  assert.doesNotMatch(before, /secretsPublic|File \.env gate secrets/);
  // Khối giữa "Các file đã đổi" và "Ngữ cảnh do máy dò" đúng như trước CP-93.
  assert.match(before, /\n- src\/a\.js\n\n---\n\n## Ngữ cảnh do máy dò/);

  put(root, '.compass/config.json', JSON.stringify({ test: 'true', secretsPublic: [] }));
  const again = review(root);
  assert.match(again.output, /chưa ai nộp findings/, 'danh sách rỗng không được làm brief cũ thành cũ');
  assert.equal(brief(root), before);
  assert.equal(briefIdIn(root, 'T-1'), id);
});

test('CP-93-V1 an invalid secretsPublic is named in the brief and review still runs', () => {
  const root = repo({ now: 'be/.env' });
  const s = section(root);
  assert.match(s, /không hợp lệ/);
  assert.match(s, /compass secrets/);
  assert.equal(lineFor(s, 'be/.env').length, 0);
});

test('CP-93-V2 a Windows-style entry is listed normalised and matched to the base', () => {
  const s = section(repo({ base: config(['be/.env']), now: ['.\\be\\.env'] }));
  assert.match(lineFor(s, 'be/.env')[0], /có từ trước/);
});

test('CP-93-V3 a path declared twice is listed once', () => {
  const s = section(repo({ now: ['be/.env', 'be/.env'] }));
  assert.equal(lineFor(s, 'be/.env').length, 1);
});

test('CP-93-E1 a workspace whose root is not a git marks every path unknown', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp93-ws-'));
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { be: { test: 'true' } }, secretsPublic: ['be/.env', 'be/.env.alpha'] }));
  put(root, '.compass/T-1/spec.md', SPEC(null).replace('Phạm vi: src/a.js', 'Phạm vi: be/b.js'));
  const be = path.join(root, 'be');
  put(be, 'b.js', 'export const b = 1\n');
  initGit(be);
  commit(be, 'be');
  put(be, 'b.js', 'export const b = 2\n');
  const s = section(root);
  for (const p of ['be/.env', 'be/.env.alpha']) {
    assert.match(lineFor(s, p)[0], /\*\*không biết\*\*[^\n]*không nằm trong git/);
  }
});

test('CP-93-E2 a config.json not tracked at the base marks every path unknown', () => {
  const s = section(repo({ trackConfig: false, now: ['be/.env'] }));
  assert.match(lineFor(s, 'be/.env')[0], /\*\*không biết\*\*[^\n]*không nằm trong git ở gốc soi/);
});

test('CP-93-E3 an invalid config.json at the base marks every path unknown, without a crash', () => {
  const root = repo({ base: '{ "test": ', now: ['be/.env'] });
  const s = section(root);
  assert.match(lineFor(s, 'be/.env')[0], /\*\*không biết\*\*[^\n]*JSON/);
});

test('CP-93-EC1 a single-commit repo reviewed from the empty tree marks every path unknown', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp93-one-'));
  initGit(root);
  put(root, '.compass/config.json', config(['be/.env']));
  put(root, '.compass/T-1/spec.md', SPEC(null));
  put(root, 'src/a.js', 'export const a = 1\n');
  commit(root, 'only');
  put(root, 'src/a.js', 'export const a = 2\n');
  const s = section(root);
  assert.match(lineFor(s, 'be/.env')[0], /\*\*không biết\*\*[^\n]*cây rỗng/);
});

test('CP-93-EC2 a base entry in another case does not count as existing', () => {
  const s = section(repo({ base: config(['BE/.env']), now: ['be/.env'] }));
  assert.match(lineFor(s, 'be/.env')[0], /\*\*mới\*\*/);
});

test('CP-93-EC3 a base secretsPublic that is not a list marks every path unknown', () => {
  const s = section(repo({ base: config('be/.env'), now: ['be/.env'] }));
  assert.match(lineFor(s, 'be/.env')[0], /\*\*không biết\*\*[^\n]*không phải danh sách/);
});

test('CP-93-EC4 a declared path git does not track is still listed with its mark', () => {
  const root = repo({ now: ['be/.env.missing'] });
  assert.equal(existsSync(path.join(root, 'be', '.env.missing')), false);
  const s = section(root);
  assert.match(lineFor(s, 'be/.env.missing')[0], /\*\*mới\*\*/);
});

test('CP-93-EC5 issue #3 layout without Gốc soi: a path declared at the root base is existing', () => {
  // Git gốc chỉ theo dõi `.compass/`, nên diff của nó luôn rỗng; việc nằm ở `be`.
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp93-i3-'));
  initGit(root);
  put(root, '.gitignore', '/*\n!/.compass/\n!/.gitignore\n');
  put(root, '.compass/config.json', JSON.stringify({ test: 'true', repos: { be: { test: 'true' } }, secretsPublic: ['be/.env'] }));
  commit(root, 'workspace');
  put(root, '.compass/notes.md', 'ghi chú\n');
  commit(root, 'notes');
  put(root, '.compass/T-1/spec.md', SPEC(null).replace('Phạm vi: src/a.js', 'Phạm vi: be/b.js'));
  const be = path.join(root, 'be');
  put(be, 'b.js', 'export const b = 1\n');
  put(be, '.env', `K=${SECRET}\n`);
  initGit(be);
  commit(be, 'be');
  put(be, 'b.js', 'export const b = 2\n');
  const s = section(root);
  assert.match(lineFor(s, 'be/.env')[0], /có từ trước/, s);
});

test('CP-93-EC6 a spec quoting the section heading is not read back as the section', () => {
  const root = repo();
  put(root, '.compass/T-1/spec.md', readFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), 'utf8')
    .replace('Đổi a.', `Đổi a.\n\n${SECRETS_PUBLIC_HEADING}\n\ntrích dẫn\n\n---\n\nhết`));
  assert.equal(review(root).exitCode, 1);
  const text = brief(root);
  assert.ok(text.includes(`\n${SECRETS_PUBLIC_HEADING}\n`), 'spec phải trích nguyên dòng heading');
  assert.equal(briefSecretsPublic(text), '');
});

test('CP-93-S1 neither the brief nor gate.json carries the contents of a declared file', () => {
  const root = repo({
    base: config(['be/.env']),
    now: ['be/.env', 'be/.env.alpha'],
    baseFiles: { 'be/.env': `K=${SECRET}\n`, 'be/.env.alpha': `K=${SECRET}\n` },
  });
  section(root);
  assert.doesNotMatch(brief(root), new RegExp(SECRET));
  assert.doesNotMatch(readFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'gate.json'), 'utf8'), new RegExp(SECRET));
});

test('CP-93-S2 the section tells the reviewer to report a new path as a security finding', () => {
  const s = section(repo({ now: ['be/.env'] }));
  assert.match(s, /`be\/\.env`/);
  assert.match(s, /không quét/);
  assert.match(s, /finding `security`/);
  assert.match(s, /trừ khi spec/);
});

test('CP-93-S3 an entry with a newline cannot plant a heading in the brief', () => {
  const LS = String.fromCharCode(0x2028);
  for (const entry of ['be/.env\n## Spec', 'x\n## Spec\n/.env', `x${LS}## Spec${LS}/.env`]) {
    assert.equal(parseSecretsPublic([entry]).ok, false, JSON.stringify(entry));
    const root = repo({ now: [entry] });
    section(root);
    const headings = brief(root).split(/\n|\u2028/).filter((l) => l === '## Spec');
    assert.equal(headings.length, 1, JSON.stringify(entry));
  }
});

function gitCalls(root) {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-cp93-trace-'));
  const file = path.join(dir, 'trace.log');
  const old = process.env.GIT_TRACE;
  process.env.GIT_TRACE = file;
  try {
    review(root);
  } finally {
    if (old === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = old;
  }
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8').split('\n').filter((l) => /trace: built-in: git /.test(l)).length;
}

test('CP-93-P1 a declaration costs at most one more git process, none when absent', () => {
  const without = gitCalls(repo());
  const empty = repo();
  put(empty, '.compass/config.json', JSON.stringify({ test: 'true', secretsPublic: [] }));
  assert.equal(gitCalls(empty), without);
  const withList = gitCalls(repo({ now: ['be/.env', 'be/.env.alpha'] }));
  assert.ok(withList - without <= 1, `${withList} so với ${without}`);
  assert.ok(withList > 0);
});

test('CP-93-P2 building the section grows with the list, not with list × base', () => {
  const paths = (n, tag) => Array.from({ length: n }, (_, i) => `d${tag}${i}/.env`);
  const lists = new Map();
  const listFor = (n) => {
    if (!lists.has(n)) lists.set(n, { current: { ok: true, paths: paths(n, 'c') }, base: { ok: true, paths: paths(n, 'b') } });
    return lists.get(n);
  };
  const result = measureGrowth({
    // 500 dòng dựng xong dưới 1 ms; lặp 100 lần để mẫu nhỏ vượt xa 5 ms mà measureGrowth đòi.
    run: (n) => { const { current, base } = listFor(n); for (let i = 0; i < 100; i++) secretsPublicSection(current, base); },
    small: 500,
    large: 10_000,
    pairs: 5,
    warmup: 1,
  });
  assert.ok(result.ratio <= 40, `10000 / 500 dòng: tỉ số nhỏ nhất ${result.ratio.toFixed(2)} (các cặp: ${result.ratios.map((r) => r.toFixed(2)).join(', ')})`);
});
