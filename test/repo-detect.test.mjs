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

// CP-70 — hai lỗi ăn khớp nhau quanh devUrl, do một lần soi mù tìm ra.
//
// Lỗi thứ nhất: phép kiểm trùng devUrl bỏ qua repo đã khai cổng, nên nó chỉ
// bắt được khi *cả hai* repo cùng im lặng. Một repo khai thẳng 5173 đứng cạnh
// một repo im lặng (Vite mặc định 5173) lọt qua, và `visual` chụp app repo này
// rồi lưu làm baseline của repo kia — gate vẫn xanh.
//
// Lỗi thứ hai: regex đọc cổng quét phẳng cả file nên lấy `port:` đầu tiên gặp
// được. Một khối `proxy` hay `preview` đứng trên `server.port` thì thắng, và
// con số sai đó lại được đánh dấu "đã khai" — tắt luôn lưới an toàn của lỗi một.

const viteRepo = (root, name, config) =>
  makeRepo(root, name, {
    scripts: { test: 'vitest run', dev: 'vite' },
    extra: { 'vite.config.js': config },
  });

test('CP-70-H1 an ordinary server.port is still read', () => {
  const root = makeDir();
  viteRepo(root, 'web', 'export default { server: { port: 4000 } }');

  assert.equal(detectRepos(root).repos[0].entry.devUrl, 'http://localhost:4000/');
});

test('CP-70-H2 a proxy port before server.port does not win', () => {
  const root = makeDir();
  viteRepo(root, 'web', [
    'export default {',
    '  server: {',
    "    proxy: { '/api': { target: 'http://localhost:8080', port: 8080 } },",
    '    port: 3100',
    '  }',
    '}',
  ].join('\n'));

  assert.equal(detectRepos(root).repos[0].entry.devUrl, 'http://localhost:3100/');
});

test('CP-70-H3 a preview port before server.port does not win', () => {
  const root = makeDir();
  viteRepo(root, 'web', 'export default { preview: { port: 4173 }, server: { port: 3300 } }');

  assert.equal(detectRepos(root).repos[0].entry.devUrl, 'http://localhost:3300/');
});

test('CP-70-H4 server.port after a nested object inside server is still read', () => {
  const root = makeDir();
  viteRepo(root, 'web', [
    'export default {',
    '  server: {',
    '    hmr: { overlay: false },',
    '    watch: { usePolling: true },',
    '    port: 3400',
    '  }',
    '}',
  ].join('\n'));

  assert.equal(detectRepos(root).repos[0].entry.devUrl, 'http://localhost:3400/');
});

test('CP-70-V1 a declared port colliding with another repo default is refused', () => {
  const root = makeDir();
  viteRepo(root, 'web', 'export default { server: { port: 5173 } }');
  viteRepo(root, 'admin', 'export default {}');

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 2, result.output);
  assert.match(result.output, /web/);
  assert.match(result.output, /admin/);
  assert.ok(!existsSync(configFile(root)), 'không được ghi config khi hai repo trùng devUrl');
});

test('CP-70-V2 two repos declaring the same port are refused', () => {
  const root = makeDir();
  viteRepo(root, 'web', 'export default { server: { port: 4000 } }');
  viteRepo(root, 'admin', 'export default { server: { port: 4000 } }');

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 2, result.output);
  assert.ok(!existsSync(configFile(root)));
});

test('CP-70-V3 two repos on different ports are written', () => {
  const root = makeDir();
  viteRepo(root, 'web', 'export default { server: { port: 4000 } }');
  viteRepo(root, 'admin', 'export default { server: { port: 4100 } }');

  assert.equal(initMultiCommand({ cwd: root }).exitCode, 0);
  const cfg = readConfig(root);
  assert.equal(cfg.repos.web.devUrl, 'http://localhost:4000/');
  assert.equal(cfg.repos.admin.devUrl, 'http://localhost:4100/');
});

test('CP-70-E1 init --multi refuses a task id instead of dropping it', () => {
  const root = makeDir();
  makeRepo(root, 'frontend', { scripts: { test: 'vitest run' } });

  const result = initMultiCommand({ cwd: root, taskId: 'TD-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /--multi/);
  assert.ok(!existsSync(configFile(root)), 'không được ghi khi lệnh gõ sai');
  assert.ok(!existsSync(path.join(root, '.compass', 'TD-1')), 'không được tạo task');
});

test('CP-70-E2 a port outside any server block reads as not declared', () => {
  const root = makeDir();
  viteRepo(root, 'web', 'export default { preview: { port: 4173 } }');

  // Không đặt được cổng vào trong `server` thì coi như chưa khai: rơi về mặc
  // định của framework, và phép kiểm trùng vẫn nhìn thấy nó.
  assert.equal(detectRepos(root).repos[0].entry.devUrl, 'http://localhost:5173/');
});

test('CP-70-EC1 a Next repo and a Vite repo do not collide on their defaults', () => {
  const root = makeDir();
  viteRepo(root, 'web', 'export default {}');
  makeRepo(root, 'site', {
    scripts: { test: 'jest', dev: 'next dev' },
    extra: { 'next.config.js': 'module.exports = {}' },
  });

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 0, result.output);
  const cfg = readConfig(root);
  assert.equal(cfg.repos.web.devUrl, 'http://localhost:5173/');
  assert.equal(cfg.repos.site.devUrl, 'http://localhost:3000/');
});

test('CP-70-EC2 the word server in a comment does not produce a wrong port', () => {
  const root = makeDir();
  viteRepo(root, 'web', [
    '// server: the dev server, see docs; the old port: 9999 is gone',
    'export default { server: { port: 3500 } }',
  ].join('\n'));

  const url = detectRepos(root).repos[0].entry.devUrl;
  assert.notEqual(url, 'http://localhost:9999/', 'không được lấy số trong chú thích');
  assert.equal(url, 'http://localhost:3500/');
});

test('CP-70-EC3 an angular.json port is still read through JSON', () => {
  const root = makeDir();
  makeRepo(root, 'app', {
    scripts: { test: 'ng test', dev: 'ng serve' },
    extra: {
      'angular.json': JSON.stringify({
        projects: { app: { architect: { serve: { options: { port: 4300 } } } } },
      }),
    },
  });

  assert.equal(detectRepos(root).repos[0].entry.devUrl, 'http://localhost:4300/');
});

test('CP-70-S1 a config file holding a payload is read, never executed', () => {
  const root = makeDir();
  const marker = path.join(root, 'executed.txt');
  viteRepo(root, 'web', [
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'pwned');`,
    'export default { server: { port: 3600 } }',
  ].join('\n'));

  assert.equal(detectRepos(root).repos[0].entry.devUrl, 'http://localhost:3600/');
  assert.ok(!existsSync(marker), 'không được chạy code trong config của dự án đích');
});

test('CP-70-V4 two silent Vite repos are still refused after the widening', () => {
  // CP-66-V4 đã phủ ca này, nhưng sửa lưới chắn thì phải tự kiểm lại chính nó:
  // mở rộng để bắt thêm trường hợp mới mà đánh rơi trường hợp cũ là hỏng.
  const root = makeDir();
  viteRepo(root, 'web', 'export default {}');
  viteRepo(root, 'admin', 'export default {}');

  const result = initMultiCommand({ cwd: root });
  assert.equal(result.exitCode, 2, result.output);
  assert.match(result.output, /5173/);
  assert.ok(!existsSync(configFile(root)));
});
