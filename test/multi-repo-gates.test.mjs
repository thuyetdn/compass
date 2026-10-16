// CP-56 — `convention`, `ui`, `visual` đo đúng repo và ghi sổ theo từng repo.
//
// Trước đây `check` gọi ba gate này một lần mỗi repo, nhưng gate không đọc tên
// repo: nó leo về gốc Compass, quét lại gốc, đọc config chung, rồi ghi vào khe
// trần. Luật viết theo repo không khớp file nào, repo này bị đổ lỗi cho file của
// repo kia, và hai repo chung một khe nên chỉ repo cuối còn bằng chứng.
//
// Không cần trình duyệt thật: một gói `playwright` giả nằm trong node_modules của
// repo, trả số đo và ảnh PNG dựng bằng lib/png.mjs. Dev server là một file node
// nhỏ trong thư mục repo, chạy bằng đường dẫn tương đối — chạy sai thư mục là
// không lên.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkCommand } from '../commands/check.mjs';
import { doneCommand } from '../commands/done.mjs';
import { conventionCommand } from '../commands/convention.mjs';
import { uiCommand } from '../commands/ui.mjs';
import { knowledgeCommand } from '../commands/knowledge.mjs';
import { readGates, readGate, writeGate } from '../lib/gate-store.mjs';
import { gatePath, specPath } from '../lib/paths.mjs';
import { hashFile } from '../lib/hash.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { initRepo } from './helpers/git-repo.mjs';
import { withinBudget, withDeadline, readMarker } from './helpers/timing.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG_URL = pathToFileURL(path.join(ROOT, 'lib', 'png.mjs')).href;

// feature-s: đòi `convention`, `ui`, `visual`, không đòi `review` — nên `done` xanh
// được mà không cần agent ngoài.
const IDS = ['H1', 'H2', 'H3', 'V1', 'V2', 'V3', 'E1', 'E2', 'X1', 'X2', 'X3', 'S1', 'S2'];
const LOP = { H: 'Happy', V: 'Validation', E: 'Error', X: 'Edge', S: 'Security' };

function specText({ type = 'feature-s', scope = 'be/src, fe/src' } = {}) {
  const rows = IDS.map((id, i) => `| ${id} | ${LOP[id[0]]} | Case ${i + 1} | Đúng | P0 |`);
  return [
    '# T-1: Đụng nhiều repo',
    `Loại: ${type}`,
    `Phạm vi: ${scope}`,
    '',
    '## Mục tiêu', 'Làm gì đó.', '',
    '## Ràng buộc', 'Không có.', '',
    '## Rủi ro hồi quy', 'Không có.', '',
    '## Test cases',
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
    ...rows,
    '',
  ].join('\n');
}

const lenhTest = (ids) =>
  `node -e "${ids.map((id, i) => `console.log('ok ${i + 1} - T-1-${id} x')`).join('; ')}"`;

// Mỗi repo in một nửa số ID: gate `test` gộp output rồi mới đối chiếu (CP-13-H7),
// còn hai repo cùng in một ID là đụng độ.
const TEST_THEO_REPO = { be: lenhTest(IDS.slice(0, 7)), fe: lenhTest(IDS.slice(7)) };

function makeRoot({ type, scope, repos, shared = {}, files = {} } = {}) {
  const root = initRepo(mkdtempSync(path.join(tmpdir(), 'compass-cp56-')));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  let config = { test: lenhTest(IDS), ...shared };
  if (repos) {
    const r = {};
    for (const [name, own] of Object.entries(repos)) {
      r[name] = TEST_THEO_REPO[name] ? { test: TEST_THEO_REPO[name], ...own } : { ...own };
      mkdirSync(path.join(root, own.path ?? name), { recursive: true });
    }
    config = { ...config, repos: r };
  }
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), specText({ type, scope }));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function setConfig(root, change) {
  const file = path.join(root, '.compass', 'config.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify(change(config), null, 2));
}

const rule = (scope) => `# Conventions

## Không hardcode mã màu

\`\`\`rule
id: no-hex-color
type: forbid-pattern
pattern: "#[0-9a-fA-F]{3,8}"
scope: ${scope}
severity: error
message: Dùng CSS variable thay vì mã màu
\`\`\`
`;

function writeRules(root, scope = 'src/**/*.jsx') {
  const dir = path.join(root, '.knowledge', 'decided');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'conventions.md'), rule(scope));
}

const CLEAN = 'export const App = () => null;\n';
const HEX = "export const c = '#fff';\n";

const CONTRACT = JSON.stringify({
  viewports: [{ name: 'desktop', width: 800, height: 600 }],
  elements: [{ name: 'Tiêu đề', selector: 'h1', properties: { 'padding-left': '20px' } }],
});

function writeContract(root) {
  writeFileSync(path.join(root, '.compass', 'T-1', 'design-contract.json'), CONTRACT);
}

// Thư mục ghi dấu nằm ngoài gốc: file mới trong gốc làm `sourceHash` đổi.
const markerDir = () => mkdtempSync(path.join(tmpdir(), 'compass-cp56-moc-'));

// Gói playwright giả, nạp bằng `findPlaywright(dir)`. `color` quyết định ảnh chụp;
// `marker` nhận nội dung trang mà `goto` thật sự lấy về.
function installStub(dir, { color = [200, 30, 30], marker = null } = {}) {
  const pkg = path.join(dir, 'node_modules', 'playwright');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
    name: 'playwright', version: '1.0.0', type: 'module', main: 'index.js',
  }));
  writeFileSync(path.join(pkg, 'index.js'), `
import { appendFileSync } from 'node:fs';
import { encodePng } from ${JSON.stringify(PNG_URL)};
const opts = ${JSON.stringify({ color, marker })};
function shot() {
  const w = 4, h = 4, px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = opts.color[0]; px[i * 4 + 1] = opts.color[1]; px[i * 4 + 2] = opts.color[2]; px[i * 4 + 3] = 255;
  }
  return encodePng(w, h, px);
}
const page = {
  async goto(url) {
    const body = await (await fetch(url)).text();
    if (opts.marker) appendFileSync(opts.marker, body + '\\n');
  },
  async evaluate() { return [{ selector: 'h1', found: true, values: { 'padding-left': '20px' } }]; },
  async screenshot() { return shot(); },
  async close() {},
};
export default { chromium: { async launch() { return { async newPage() { return page; }, async close() {} }; } } };
`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// `dev` là `node srv.cjs` — đường dẫn tương đối, nên chỉ lên khi chạy trong đúng
// thư mục repo. `cwdMarker` ghi lại thư mục nó thật sự chạy.
function writeServer(dir, { port, body = 'ok', cwdMarker = null, listen = true }) {
  mkdirSync(dir, { recursive: true });
  const lines = [];
  if (cwdMarker) lines.push(`require('fs').writeFileSync(${JSON.stringify(cwdMarker)}, process.cwd());`);
  if (listen) {
    lines.push(`require('http').createServer((q, s) => s.end(${JSON.stringify(body)})).listen(${port}, '127.0.0.1');`);
  }
  writeFileSync(path.join(dir, 'srv.cjs'), lines.join('\n') + '\n');
}

// Repo có trang để đo: dev server riêng, playwright giả riêng.
async function frontEnd(root, rel, { color, marker, cwdMarker, port } = {}) {
  const p = port ?? await freePort();
  const dir = path.join(root, rel);
  writeServer(dir, { port: p, body: rel, cwdMarker });
  installStub(dir, { color, marker });
  return { dev: 'node srv.cjs', devUrl: `http://127.0.0.1:${p}/`, devTimeoutMs: 20000 };
}

const same = (a, b) => realpathSync(a) === realpathSync(b);

function listAll(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      out.push(path.relative(dir, full));
      if (e.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

// ---------------------------------------------------------------- Happy

test('CP-56-H1 a repo-relative rule finds the violation in fe and blames fe, not be', async () => {
  const root = makeRoot({
    repos: { be: {}, fe: {} },
    files: { 'be/src/x.jsx': CLEAN, 'fe/src/App.jsx': HEX },
  });
  writeRules(root);

  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'convention' });
  assert.equal(r.exitCode, 1, r.output);

  const gates = readGates(root, 'T-1');
  assert.equal(gates['convention@be'].exitCode, 0);
  assert.equal(gates['convention@fe'].exitCode, 1);
  assert.equal(gates['convention@fe'].errorCount, 1);
  assert.equal(gates.convention, undefined, 'không còn khe trần');

  const where = `${path.join('fe', 'src', 'App.jsx')}:1`;
  const feAt = r.output.indexOf('[fe]');
  assert.ok(feAt !== -1, r.output);
  assert.ok(r.output.indexOf(where) > feAt, `vi phạm phải nằm dưới [fe]\n${r.output}`);
});

test('CP-56-H2 each repo scans its own files', async () => {
  const root = makeRoot({
    repos: { be: {}, fe: {} },
    files: { 'be/src/a.jsx': CLEAN, 'fe/src/a.jsx': CLEAN, 'fe/src/b.jsx': CLEAN },
  });
  writeRules(root);

  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'convention' });
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(readGate(root, 'T-1', 'convention', 'be').scanned, 1);
  assert.equal(readGate(root, 'T-1', 'convention', 'fe').scanned, 2);
});

test('CP-56-H3 ui measures fe with fe\'s own dev and devUrl', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  const fe = await frontEnd(root, 'fe');
  setConfig(root, (c) => ({ ...c, repos: { ...c.repos, fe: { ...c.repos.fe, ...fe } } }));
  writeContract(root);

  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'ui' });
  assert.equal(r.exitCode, 0, r.output);

  const gates = readGates(root, 'T-1');
  assert.equal(gates['ui@fe'].exitCode, 0);
  assert.equal(gates['ui@fe'].measured, 1);
  assert.equal(gates['ui@fe'].devUrl, fe.devUrl);
  assert.equal(gates['ui@be'].skipped, true);
  assert.equal(gates.ui, undefined, 'không còn khe trần');
});

test('CP-56-H4 visual keeps fe\'s baseline under the repo name', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  const fe = await frontEnd(root, 'fe');
  setConfig(root, (c) => ({ ...c, repos: { ...c.repos, fe: { ...c.repos.fe, ...fe } } }));
  writeContract(root);

  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'visual' });
  assert.equal(r.exitCode, 0, r.output);

  const base = path.join(root, '.compass', 'T-1', 'baseline');
  assert.ok(existsSync(path.join(base, 'fe', 'desktop.png')), 'baseline của fe nằm trong baseline/fe/');
  assert.equal(existsSync(path.join(base, 'desktop.png')), false, 'không có baseline chung');
  assert.deepEqual(readGate(root, 'T-1', 'visual', 'fe').createdBaselines, ['desktop']);
});

test('CP-56-H5 a full check then done closes a two-repo task and names be\'s skips', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  const fe = await frontEnd(root, 'fe');
  setConfig(root, (c) => ({ ...c, repos: { ...c.repos, fe: { ...c.repos.fe, ...fe } } }));
  writeContract(root);

  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(c.exitCode, 0, c.output);

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /ui@be/);
  assert.match(r.output, /visual@be/);
  assert.match(r.output, /chưa từng chạy: không khai devUrl/);
});

test('CP-56-H6 a single-repo project keeps bare slots and the old paths', async () => {
  const root = makeRoot({ scope: 'src/' });
  const own = await frontEnd(root, '.');
  setConfig(root, (c) => ({ ...c, ...own }));
  writeContract(root);

  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(c.exitCode, 0, c.output);

  const gates = readGates(root, 'T-1');
  for (const g of ['convention', 'ui', 'visual']) {
    assert.ok(gates[g], `khe ${g} vẫn là khe trần`);
    assert.equal('repo' in gates[g], false, `${g} không có trường repo`);
  }
  assert.equal(Object.keys(gates).some((k) => k.includes('@')), false, 'không khe nào mang @');
  assert.ok(existsSync(path.join(root, '.compass', 'T-1', 'baseline', 'desktop.png')));
  assert.ok(existsSync(path.join(root, '.compass', 'T-1', 'evidence', 'ui.json')));
  assert.equal(gates.ui.outputFile, 'evidence/ui.json');

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
});

// ---------------------------------------------------------------- Validation

// Bản ghi `convention` trần, xanh, ký thật: chạy khi dự án còn là một repo, rồi
// mới khai `repos`.
function bareConventionThenRepos() {
  const root = makeRoot({ files: { 'be/src/a.jsx': CLEAN, 'fe/src/a.jsx': CLEAN } });
  assert.equal(conventionCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
  assert.equal(readGate(root, 'T-1', 'convention').exitCode, 0);
  setConfig(root, (c) => ({ ...c, repos: { be: { test: TEST_THEO_REPO.be }, fe: { test: TEST_THEO_REPO.fe } } }));
  return root;
}

test('CP-56-V1 a bare convention record in a multi-repo task is stale, not a pass', () => {
  const root = bareConventionThenRepos();

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Gate "convention" có bản ghi không mang tên repo/);
  assert.match(r.output, /be, fe/);
  assert.match(r.output, /compass check T-1/);
  assert.equal(readGate(root, 'T-1', 'done'), null, 'không được tính là pass');
});

test('CP-56-V2 rerunning check replaces the stale bare slot with per-repo slots', async () => {
  const root = bareConventionThenRepos();

  const c = await checkCommand({ cwd: root, taskId: 'T-1', only: 'convention' });
  assert.equal(c.exitCode, 0, c.output);

  const gates = readGates(root, 'T-1');
  assert.equal(gates.convention, undefined, 'khe trần phải biến mất');
  assert.ok(gates['convention@be']);
  assert.ok(gates['convention@fe']);

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(r.output, /không mang tên repo/, r.output);
});

test('CP-56-V3 a repo that is not declared is refused by name and writes nothing', () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  const r = conventionCommand({ cwd: root, taskId: 'T-1', repo: 'khong-co', gateRoot: root });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /khong-co/);
  assert.deepEqual(readGates(root, 'T-1'), {}, 'không ghi bản ghi nào');
});

test('CP-56-V4 a bare ui slot on a task that does not require ui is still stale', () => {
  const root = makeRoot({ type: 'bug', repos: { be: {}, fe: {} } });
  writeGate(root, 'T-1', {
    gate: 'ui', exitCode: 0, measured: 0, driftCount: 0, contractHash: null,
    checkedAt: new Date().toISOString(),
    specHash: hashFile(specPath(root, 'T-1')), sourceHash: hashSource(root),
  });

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /Gate "ui" có bản ghi không mang tên repo/);
  assert.match(r.output, /compass ui T-1/);
  assert.match(r.output, /xoá khoá "ui"/);
});

// ---------------------------------------------------------------- Error

test('CP-56-E1 the dev server starts in fe, and a dead one fails ui with fe\'s command', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  const moc = path.join(markerDir(), 'cwd.txt');
  const port = await freePort();
  writeServer(path.join(root, 'fe'), { port, cwdMarker: moc, listen: false });
  installStub(path.join(root, 'fe'));
  // Server không bao giờ lắng nghe, nên gate đỏ "không phản hồi" với mọi hạn chờ;
  // hạn chờ chỉ quyết định nó kịp ghi dấu cwd trước khi bị giết hay không. Từ
  // spawn tới lúc ghi dấu đo được 62–272 ms khi máy rỗi nhưng 1146–1669 ms khi máy
  // bận (CP-62), nên 500 ms cũ là một cuộc đua. Đừng hạ số này "cho nhanh".
  const devTimeoutMs = 3000;
  setConfig(root, (c) => ({
    ...c,
    repos: { ...c.repos, fe: { ...c.repos.fe, dev: 'node srv.cjs', devUrl: `http://127.0.0.1:${port}/`, devTimeoutMs } },
  }));
  writeContract(root);

  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'ui' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /Dev server không phản hồi/);
  assert.match(r.output, /Lệnh: node srv\.cjs/);
  assert.ok(same(readMarker(moc, { devTimeoutMs }).trim(), path.join(root, 'fe')), 'dev server phải chạy trong fe/');
  const fe = readGate(root, 'T-1', 'ui', 'fe');
  assert.ok(!fe || fe.exitCode !== 0, 'không có ui@fe xanh');
});

test('CP-56-E2 fe does not borrow the Playwright installed in be', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  installStub(path.join(root, 'be'));
  const port = await freePort();
  writeServer(path.join(root, 'fe'), { port });
  setConfig(root, (c) => ({
    ...c,
    repos: { ...c.repos, fe: { ...c.repos.fe, dev: 'node srv.cjs', devUrl: `http://127.0.0.1:${port}/` } },
  }));
  writeContract(root);

  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'ui' });
  assert.equal(r.exitCode, 2, r.output);
  assert.match(r.output, /\[fe\]/);
  assert.match(r.output, /npm install -D playwright/);
  const fe = readGate(root, 'T-1', 'ui', 'fe');
  assert.ok(!fe || fe.exitCode !== 0);
});

test('CP-56-E3 a red be stops check before fe, and done names both', async () => {
  const root = makeRoot({
    repos: { be: {}, fe: {} },
    files: { 'be/src/App.jsx': HEX, 'fe/src/App.jsx': CLEAN },
  });
  writeRules(root);
  assert.equal(knowledgeCommand({ cwd: root, sync: true }).exitCode, 0);

  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(c.exitCode, 1, c.output);
  assert.equal(readGate(root, 'T-1', 'convention', 'fe'), null, 'fe chưa được chạy');

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Gate "convention@be" chưa pass \(exit code 1\)/, r.output);
  assert.match(r.output, /Gate "convention@fe" chưa chạy/, r.output);
});

test('CP-56-E4 an unreadable config leaves the three gates unrun, with no bare fallback', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  setConfig(root, (c) => ({
    ...c,
    repos: {
      be: { ...c.repos.be, dev: 'true', devUrl: 'http://127.0.0.1:9/' },
      fe: { ...c.repos.fe, dev: 'true', devUrl: 'http://127.0.0.1:9/' },
    },
  }));
  for (const g of ['convention', 'ui', 'visual']) {
    const c = await checkCommand({ cwd: root, taskId: 'T-1', only: g });
    assert.equal(c.exitCode, 0, c.output);
  }
  // Khe trần xanh, ký thật, nằm cạnh: nếu `done` lấy nó làm chỗ dựa khi config hỏng
  // thì ca này lộ ra.
  const specHash = readGate(root, 'T-1', 'convention', 'be').specHash;
  const sourceHash = readGate(root, 'T-1', 'convention', 'be').sourceHash;
  for (const g of ['convention', 'ui', 'visual']) {
    writeGate(root, 'T-1', { gate: g, exitCode: 0, checkedAt: new Date().toISOString(), specHash, sourceHash });
  }
  writeFileSync(path.join(root, '.compass', 'config.json'), '{ not json');

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1);
  for (const g of ['convention', 'ui', 'visual']) {
    assert.match(r.output, new RegExp(`Gate "${g}" chưa chạy`), r.output);
  }
});

// ---------------------------------------------------------------- Edge

test('CP-56-EC1 a root-relative rule still works and lands in fe', async () => {
  const root = makeRoot({
    repos: { be: {}, fe: {} },
    files: { 'be/src/x.jsx': CLEAN, 'fe/src/App.jsx': HEX },
  });
  writeRules(root, 'fe/src/**/*.jsx');

  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'convention' });
  assert.equal(r.exitCode, 1, r.output);
  assert.equal(readGate(root, 'T-1', 'convention', 'be').exitCode, 0);
  assert.equal(readGate(root, 'T-1', 'convention', 'fe').exitCode, 1);
  assert.equal(readGate(root, 'T-1', 'convention', 'fe').errorCount, 1);
  assert.match(r.output, /\[be\] [^\n]*PASSED/, 'be xanh, không bị đổ lỗi');
  assert.ok(r.output.indexOf(path.join('fe', 'src', 'App.jsx')) > r.output.indexOf('[fe]'), r.output);
});

test('CP-56-EC2 a repo outside the scope is neither run nor demanded', async () => {
  const root = makeRoot({
    scope: 'be/src',
    repos: { be: {}, fe: {} },
    files: { 'be/src/a.jsx': CLEAN, 'fe/src/a.jsx': CLEAN },
  });
  const c = await checkCommand({ cwd: root, taskId: 'T-1', only: 'convention' });
  assert.equal(c.exitCode, 0, c.output);

  const gates = readGates(root, 'T-1');
  assert.ok(gates['convention@be']);
  assert.equal(gates['convention@fe'], undefined);

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(r.output, /convention@fe/, r.output);
});

test('CP-56-EC3 a shared dev command starts in fe when only fe declares devUrl', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  const moc = path.join(markerDir(), 'cwd.txt');
  const port = await freePort();
  // Chỉ fe có srv.cjs: chạy `node srv.cjs` ở gốc là không lên.
  writeServer(path.join(root, 'fe'), { port, cwdMarker: moc });
  installStub(path.join(root, 'fe'));
  setConfig(root, (c) => ({
    ...c,
    dev: 'node srv.cjs',
    devTimeoutMs: 20000,
    repos: { ...c.repos, fe: { ...c.repos.fe, devUrl: `http://127.0.0.1:${port}/` } },
  }));
  writeContract(root);

  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'ui' });
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(readGate(root, 'T-1', 'ui', 'fe').measured, 1);
  assert.ok(same(readFileSync(moc, 'utf8').trim(), path.join(root, 'fe')));
});

test('CP-56-EC4 a nested repo key gets nested slots and a nested baseline', async () => {
  const root = makeRoot({ scope: 'store/frontend/src', repos: { 'store/frontend': {} } });
  const fe = await frontEnd(root, path.join('store', 'frontend'));
  setConfig(root, (c) => ({ ...c, repos: { 'store/frontend': fe } }));
  writeContract(root);

  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(c.exitCode, 0, c.output);

  const gates = readGates(root, 'T-1');
  assert.equal(gates['ui@store/frontend'].exitCode, 0);
  assert.equal(gates['visual@store/frontend'].exitCode, 0);
  assert.ok(existsSync(path.join(root, '.compass', 'T-1', 'baseline', 'store', 'frontend', 'desktop.png')));
  assert.ok(existsSync(path.join(root, '.compass', 'T-1', 'evidence', 'repos', 'store', 'frontend', 'ui.json')));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-56-EC5 a bare call in a multi-repo project writes per-repo slots, never a bare one', async () => {
  const root = makeRoot({
    repos: { be: {}, fe: { dev: 'true', devUrl: 'http://127.0.0.1:9/' } },
    files: { 'be/src/a.jsx': CLEAN, 'fe/src/a.jsx': CLEAN },
  });

  const conv = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(conv.exitCode, 0, conv.output);
  const ui = await uiCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(ui.exitCode, 0, ui.output);

  const gates = readGates(root, 'T-1');
  assert.equal(gates.convention, undefined);
  assert.equal(gates.ui, undefined);
  assert.ok(gates['convention@be']);
  assert.ok(gates['convention@fe']);
  assert.equal(gates['ui@fe'].exitCode, 0);
  assert.notEqual(gates['ui@fe'].skipped, true);

  // Bản ghi bỏ qua phải giống hệt bản `check` ghi: so với chính bản đó.
  const tuGoi = gates['ui@be'];
  await checkCommand({ cwd: root, taskId: 'T-1', only: 'ui' });
  const quaCheck = readGate(root, 'T-1', 'ui', 'be');
  const bo = ({ checkedAt, sig, ...rest }) => rest;
  assert.equal(tuGoi.skipped, true);
  assert.deepEqual(bo(tuGoi), bo(quaCheck));
});

test('CP-56-EC6 two repos with devUrl and no contract each get their own slots', async () => {
  const root = makeRoot({
    repos: {
      be: { dev: 'true', devUrl: 'http://127.0.0.1:9/' },
      fe: { dev: 'true', devUrl: 'http://127.0.0.1:9/' },
    },
  });
  for (const g of ['ui', 'visual']) {
    const c = await checkCommand({ cwd: root, taskId: 'T-1', only: g });
    assert.equal(c.exitCode, 0, c.output);
  }
  const gates = readGates(root, 'T-1');
  for (const slot of ['ui@be', 'ui@fe', 'visual@be', 'visual@fe']) {
    assert.equal(gates[slot]?.exitCode, 0, slot);
  }
  assert.equal(gates.ui, undefined);
  assert.equal(gates.visual, undefined);
});

test('CP-56-EC7 SKILL.md says what multi-repo projects can now trust', () => {
  const skill = readFileSync(path.join(ROOT, 'skills', 'compass', 'SKILL.md'), 'utf8');
  assert.equal(skill.includes('chỉ nên tin `test` và `knowledge`'), false);
  assert.equal(skill.includes('vẫn quét đúng thư mục'), false);
  assert.match(skill, /`<gate>@<repo>`/);
  for (const g of ['convention', 'ui', 'visual']) assert.ok(skill.includes(`\`${g}@<repo>\``), g);
  assert.ok(skill.includes('.compass/<id>/baseline/<repo>/<viewport>.png'));
});

// ---------------------------------------------------------------- Security

test('CP-56-S1 a be record copied into the fe slot is refused, and fe is unrun', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  await checkCommand({ cwd: root, taskId: 'T-1', only: 'convention' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data['convention@fe'] = data['convention@be'];
  writeFileSync(file, JSON.stringify(data, null, 2));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /"convention@fe" không thuộc slot này/, r.output);
  assert.match(r.output, /Gate "convention@fe" chưa chạy/, r.output);
});

test('CP-56-S2 a red fe slot plus a restored green bare slot is reported twice', async () => {
  const root = makeRoot({ files: { 'be/src/a.jsx': CLEAN, 'fe/src/App.jsx': HEX } });
  assert.equal(conventionCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0, 'chưa có luật thì xanh');
  const cu = readGates(root, 'T-1').convention;

  setConfig(root, (c) => ({ ...c, repos: { be: { test: TEST_THEO_REPO.be }, fe: { test: TEST_THEO_REPO.fe } } }));
  writeRules(root);
  const c = await checkCommand({ cwd: root, taskId: 'T-1', only: 'convention' });
  assert.equal(c.exitCode, 1, c.output);

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.convention = cu;
  writeFileSync(file, JSON.stringify(data, null, 2));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Gate "convention@fe" chưa pass \(exit code 1\)/, r.output);
  assert.match(r.output, /Gate "convention" có bản ghi không mang tên repo/, r.output);
});

test('CP-56-S3 a repo key that climbs out of its folder is refused before anything is written', async () => {
  const root = makeRoot({ scope: '../x/src', repos: { '../x': { path: 'fe' } } });
  const fe = await frontEnd(root, 'fe');
  setConfig(root, (c) => ({ ...c, repos: { '../x': { path: 'fe', ...fe } } }));
  writeContract(root);

  const compass = path.join(root, '.compass');
  const truoc = listAll(compass);
  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'visual' });
  assert.equal(r.exitCode, 2, r.output);
  assert.ok(r.output.includes('../x'), r.output);
  assert.deepEqual(listAll(compass), truoc, 'không file hay thư mục mới nào dưới .compass/');
  assert.equal(existsSync(path.join(compass, 'T-1', 'x')), false);
  assert.equal(existsSync(path.join(compass, 'x')), false);
});

test('CP-56-S4 an edit in be invalidates fe\'s records too', async () => {
  const root = makeRoot({
    repos: { be: {}, fe: { dev: 'true', devUrl: 'http://127.0.0.1:9/' } },
    files: { 'be/src/a.jsx': CLEAN, 'fe/src/a.jsx': CLEAN },
  });
  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(c.exitCode, 0, c.output);
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  writeFileSync(path.join(root, 'be', 'src', 'moi.mjs'), 'export const x = 1;\n');
  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Code đã thay đổi sau khi gate "ui@fe"/, r.output);
  assert.match(r.output, /Code đã thay đổi sau khi gate "convention@fe"/, r.output);
});

test('CP-56-S5 two repos with the same viewport keep two baselines', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  const be = await frontEnd(root, 'be', { color: [200, 30, 30] });
  const fe = await frontEnd(root, 'fe', { color: [30, 30, 200] });
  setConfig(root, (c) => ({
    ...c,
    repos: { be: { ...c.repos.be, ...be }, fe: { ...c.repos.fe, ...fe } },
  }));
  writeContract(root);

  const dau = await checkCommand({ cwd: root, taskId: 'T-1', only: 'visual' });
  assert.equal(dau.exitCode, 0, dau.output);

  const base = path.join(root, '.compass', 'T-1', 'baseline');
  const beImg = readFileSync(path.join(base, 'be', 'desktop.png'));
  const feImg = readFileSync(path.join(base, 'fe', 'desktop.png'));
  assert.equal(beImg.equals(feImg), false, 'mỗi repo một ảnh của chính nó');

  const sau = await checkCommand({ cwd: root, taskId: 'T-1', only: 'visual' });
  assert.equal(sau.exitCode, 0, sau.output);
  for (const repo of ['be', 'fe']) {
    const rec = readGate(root, 'T-1', 'visual', repo);
    assert.equal(rec.exitCode, 0, repo);
    assert.deepEqual(rec.createdBaselines, [], `${repo} lần hai phải so, không tạo mới`);
  }
});

// ---------------------------------------------------------------- Performance

function manyFiles(n, dir) {
  const files = {};
  for (let i = 0; i < n; i++) files[`${dir}/src/c${i}.jsx`] = CLEAN;
  return files;
}

test('CP-56-P1 each repo is walked once, not the root twice', async () => {
  const root = makeRoot({
    repos: { be: {}, fe: {} },
    files: { ...manyFiles(500, 'fe'), ...manyFiles(3, 'be') },
  });
  writeRules(root);

  // Đồng hồ 2 giây cũ không phân biệt được một lần quét với hai (hai lần quét gốc
  // chỉ tốn 116 ms) mà lại đỏ khi máy bận (1.4–2.1 giây). Số `scanned` — 500 và 3,
  // không phải 503 — mới là thứ bắt hồi quy đó (CP-62). Hạn chót chỉ chống treo.
  const r = await withDeadline(checkCommand({ cwd: root, taskId: 'T-1', only: 'convention' }), 20000, 'check --only=convention');
  assert.equal(r.exitCode, 0, r.output);
  assert.equal(readGate(root, 'T-1', 'convention', 'fe').scanned, 500);
  assert.equal(readGate(root, 'T-1', 'convention', 'be').scanned, 3);
});

test('CP-56-P2 each dev server is stopped before the next repo starts its own', async () => {
  const root = makeRoot({ repos: { be: {}, fe: {} } });
  const moc = path.join(markerDir(), 'trang.txt');
  const port = await freePort();
  const be = await frontEnd(root, 'be', { marker: moc, port });
  const fe = await frontEnd(root, 'fe', { marker: moc, port });
  setConfig(root, (c) => ({
    ...c,
    repos: { be: { ...c.repos.be, ...be }, fe: { ...c.repos.fe, ...fe } },
  }));
  writeContract(root);

  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'ui' });
  assert.equal(r.exitCode, 0, r.output);
  assert.deepEqual(readFileSync(moc, 'utf8').trim().split(/\r?\n/), ['be', 'fe']);
});

test('CP-56-P3 done reads six per-repo slots over 500 files quickly', async () => {
  const root = makeRoot({
    repos: {
      be: { dev: 'true', devUrl: 'http://127.0.0.1:9/' },
      fe: { dev: 'true', devUrl: 'http://127.0.0.1:9/' },
    },
    files: { ...manyFiles(500, 'fe'), ...manyFiles(3, 'be') },
  });
  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(c.exitCode, 0, c.output);
  const slots = Object.keys(readGates(root, 'T-1')).filter((k) => /^(convention|ui|visual)@/.test(k));
  assert.equal(slots.length, 6);

  const { value: r } = withinBudget({ run: () => doneCommand({ cwd: root, taskId: 'T-1' }), budgetMs: 2000, label: 'done' });
  assert.equal(r.exitCode, 0, r.output);
});
