import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectRepos } from '../lib/repo-detect.mjs';
import { initMultiCommand } from '../commands/init.mjs';
import { loadConfig } from '../lib/config.mjs';
import { resolveRepos } from '../lib/repos.mjs';

const makeDir = () => mkdtempSync(path.join(tmpdir(), 'compass-multi-'));

// Dựng một repo con: package.json, lockfile tùy chọn, file phụ tùy chọn.
function makeRepo(root, rel, { scripts = {}, lock = 'package-lock.json', extra = {} } = {}) {
  const dir = path.join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: path.basename(rel), scripts }, null, 2)
  );
  if (lock) writeFileSync(path.join(dir, lock), '{}');
  for (const [name, body] of Object.entries(extra)) {
    writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

const configFile = (root) => path.join(root, '.compass', 'config.json');
const readConfig = (root) => JSON.parse(readFileSync(configFile(root), 'utf8'));

test('CP-66-H1 two npm subfolders each get an entry with npm test', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });
  makeRepo(root, 'backend', { scripts: { test: 'jest' } });

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 0, result.output);

  const cfg = readConfig(root);
  assert.equal(cfg.repos.frontend.test, 'npm test');
  assert.equal(cfg.repos.backend.test, 'npm test');
});

test('CP-66-H2 a yarn.lock makes the test command yarn test', () => {
  const root = makeDir();
  makeRepo(root, 'api', { scripts: { test: 'jest' }, lock: 'yarn.lock' });

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  assert.equal(readConfig(root).repos.api.test, 'yarn test');
});

test('CP-66-H3 a pnpm-lock.yaml makes the test command pnpm test', () => {
  const root = makeDir();
  makeRepo(root, 'api', { scripts: { test: 'jest' }, lock: 'pnpm-lock.yaml' });

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  assert.equal(readConfig(root).repos.api.test, 'pnpm test');
});

test('CP-66-H4 a declared vite port becomes the devUrl', () => {
  const root = makeDir();
  makeRepo(root, 'web', {
    scripts: { test: 'vitest run', dev: 'vite' },
    extra: { 'vite.config.js': 'export default { server: { port: 4000 } }' },
  });

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  const web = readConfig(root).repos.web;
  assert.equal(web.dev, 'npm run dev');
  assert.equal(web.devUrl, 'http://localhost:4000/');
});

test('CP-66-H5 vite with no declared port falls back to 5173', () => {
  const root = makeDir();
  makeRepo(root, 'web', {
    scripts: { test: 'vitest run', dev: 'vite' },
    extra: { 'vite.config.js': 'export default { plugins: [] }' },
  });

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  assert.equal(readConfig(root).repos.web.devUrl, 'http://localhost:5173/');
});

test('CP-66-H6 a repo nested two levels keys on its path', () => {
  const root = makeDir();
  makeRepo(root, path.join('sorm', 'backend'), { scripts: { test: 'jest' } });

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  const cfg = readConfig(root);
  assert.ok(cfg.repos['sorm/backend'], 'keys: ' + Object.keys(cfg.repos).join(', '));
  assert.ok(!cfg.repos.backend);
});

test('CP-66-H7 detectRepos reports findings without writing anything', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });

  const found = detectRepos(root);
  assert.equal(found.repos.length, 1);
  assert.equal(found.repos[0].name, 'frontend');
  assert.ok(!existsSync(configFile(root)), 'detectRepos chỉ đọc');
});

test('CP-66-V1 a repo without scripts.test still gets a failing entry', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });
  makeRepo(root, 'legacy', { scripts: {} });

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(readConfig(root).repos.legacy.test, /exit 1/);
});

test('CP-66-V2 a folder without package.json produces no entry', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'readme.md'), '# docs');

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  assert.ok(!readConfig(root).repos.docs);
});

test('CP-66-V3 a backend with no dev script gets neither dev nor devUrl', () => {
  const root = makeDir();
  makeRepo(root, 'api', { scripts: { test: 'jest' } });

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  const api = readConfig(root).repos.api;
  assert.equal(api.test, 'npm test');
  assert.ok(!('dev' in api));
  assert.ok(!('devUrl' in api));
});

test('CP-66-V4 two vite repos with no port refuse to guess', () => {
  const root = makeDir();
  for (const name of ['web', 'admin']) {
    makeRepo(root, name, {
      scripts: { test: 'vitest run', dev: 'vite' },
      extra: { 'vite.config.js': 'export default {}' },
    });
  }

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /web/);
  assert.match(result.output, /admin/);
  assert.ok(!existsSync(configFile(root)), 'config.json không được ghi khi còn phải hỏi');
});

test('CP-66-E1 an existing config is printed, never overwritten', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  const before = JSON.stringify({ test: 'npm test' }, null, 2);
  writeFileSync(configFile(root), before);

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /frontend/);
  assert.equal(readFileSync(configFile(root), 'utf8'), before);
});

test('CP-66-E2 no package.json anywhere is refused', () => {
  const root = makeDir();
  mkdirSync(path.join(root, 'docs'), { recursive: true });

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 2);
  assert.ok(!existsSync(configFile(root)));
});

test('CP-66-E3 a malformed package.json is named, the others still detected', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });
  const broken = path.join(root, 'broken');
  mkdirSync(broken, { recursive: true });
  writeFileSync(path.join(broken, 'package.json'), '{ not json');

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /broken/);
  assert.match(result.output, /frontend/);
});

test('CP-66-EC1 node_modules and friends never become repos', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });
  for (const junk of ['node_modules', 'dist', '.git', '.compass', 'coverage', 'build']) {
    makeRepo(root, junk, { scripts: { test: 'jest' } });
  }

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  assert.deepEqual(Object.keys(readConfig(root).repos), ['frontend']);
});

test('CP-66-EC2 a root package.json is not written as a repo', () => {
  const root = makeDir();
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'root', scripts: { test: 'x' } })
  );
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  assert.deepEqual(Object.keys(readConfig(root).repos), ['frontend']);
});

test('CP-66-EC3 a non-Node folder is reported, not silently dropped', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });
  const java = path.join(root, 'service');
  mkdirSync(java, { recursive: true });
  writeFileSync(path.join(java, 'pom.xml'), '<project/>');

  const result = initMultiCommand({ cwd: root });
  assert.match(result.output, /service/);
});

test('CP-66-EC4 the written config is accepted by loadConfig and resolveRepos', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run', dev: 'vite' } });
  makeRepo(root, 'backend', { scripts: { test: 'jest' } });

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);

  const loaded = loadConfig(root);
  assert.ok(loaded.ok, JSON.stringify(loaded.errors));
  const resolved = resolveRepos(root, loaded.config);
  assert.ok(resolved.ok, JSON.stringify(resolved.errors));
  assert.deepEqual(resolved.repos.map((r) => r.name).sort(), ['backend', 'frontend']);
});

test('CP-66-S1 a symlinked folder is not followed', (t) => {
  const root = makeDir();
  const outside = makeDir();
  makeRepo(outside, 'secret', { scripts: { test: 'jest' } });
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });

  try {
    symlinkSync(path.join(outside, 'secret'), path.join(root, 'linked'), 'junction');
  } catch {
    t.skip('không tạo được symlink trên máy này');
    return;
  }

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  assert.deepEqual(Object.keys(readConfig(root).repos), ['frontend']);
});

test('CP-66-S2 a shell metacharacter in scripts.test is never executed', () => {
  const root = makeDir();
  const marker = path.join(root, 'pwned.txt');
  makeRepo(root, 'frontend', { scripts: { test: 'jest && echo pwned > "' + marker + '"' } });

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  assert.ok(!existsSync(marker), 'detection không được chạy lệnh của repo');
  assert.equal(readConfig(root).repos.frontend.test, 'npm test');
});
