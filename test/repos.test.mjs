import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveRepos, reposForScope } from '../lib/repos.mjs';

function makeRoot(config, dirs = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-repos-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify(config));
  for (const dir of dirs) mkdirSync(path.join(root, dir), { recursive: true });
  return root;
}

test('H1 a config with no repos yields one repo pointing at the root', () => {
  const root = makeRoot({ test: 'npm test' });
  const result = resolveRepos(root, { test: 'npm test' });

  assert.equal(result.ok, true, result.errors?.join(' · '));
  assert.equal(result.repos.length, 1);
  assert.equal(result.repos[0].dir, root);
  assert.equal(result.repos[0].config.test, 'npm test');
});

test('H2 two declared repos come back with names and directories', () => {
  const config = {
    test: 'npm test',
    repos: { backend: { test: 'yarn test' }, frontend: { test: 'pnpm test' } },
  };
  const root = makeRoot(config, ['backend', 'frontend']);
  const result = resolveRepos(root, config);

  assert.equal(result.ok, true, result.errors?.join(' · '));
  assert.deepEqual(result.repos.map((r) => r.name).sort(), ['backend', 'frontend']);
  assert.equal(result.repos.find((r) => r.name === 'backend').dir, path.join(root, 'backend'));
});

test('H3 a repo overrides one field and inherits the rest', () => {
  const config = {
    test: 'npm test',
    dev: 'npm run dev',
    devUrl: 'http://localhost:5173/',
    repos: { backend: { test: 'yarn test' } },
  };
  const root = makeRoot(config, ['backend']);
  const backend = resolveRepos(root, config).repos[0];

  assert.equal(backend.config.test, 'yarn test');       // overridden
  assert.equal(backend.config.dev, 'npm run dev');       // inherited
  assert.equal(backend.config.devUrl, 'http://localhost:5173/');
});

test('H4 a repo declaring nothing inherits everything', () => {
  const config = { test: 'npm test', repos: { app: {} } };
  const root = makeRoot(config, ['app']);
  const app = resolveRepos(root, config).repos[0];
  assert.equal(app.config.test, 'npm test');
});

test('the repos map itself is not copied into a repo config', () => {
  const config = { test: 'npm test', repos: { app: {} } };
  const root = makeRoot(config, ['app']);
  assert.equal(resolveRepos(root, config).repos[0].config.repos, undefined);
});

test('V1 a repos value that is not an object is refused', () => {
  const config = { test: 'npm test', repos: ['backend'] };
  const root = makeRoot(config);
  const result = resolveRepos(root, config);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /repos/);
});

test('V2 a repo with no test command anywhere is refused by name', () => {
  const config = { repos: { backend: { dev: 'x' } } };
  const root = makeRoot(config, ['backend']);
  const result = resolveRepos(root, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('backend') && e.includes('test')));
});

test('V3 a repo directory that does not exist is refused with its path', () => {
  const config = { test: 'npm test', repos: { missing: {} } };
  const root = makeRoot(config);
  const result = resolveRepos(root, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('missing')));
});

test('S1 a repo path climbing out of the root is refused', () => {
  const config = { test: 'npm test', repos: { escape: { path: '../elsewhere' } } };
  const root = makeRoot(config);
  const result = resolveRepos(root, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('escape')));
});

test('EC3 a repo whose path is "." resolves to the root itself', () => {
  const config = { test: 'npm test', repos: { self: { path: '.' } } };
  const root = makeRoot(config);
  const result = resolveRepos(root, config);
  assert.equal(result.ok, true, result.errors?.join(' · '));
  assert.equal(result.repos[0].dir, root);
});

test('H5 a scope naming one repo selects only that one', () => {
  const config = { test: 'npm test', repos: { backend: {}, frontend: {} } };
  const root = makeRoot(config, ['backend', 'frontend']);
  const { repos } = resolveRepos(root, config);

  const selected = reposForScope(repos, 'backend/src/user.service.ts');
  assert.deepEqual(selected.map((r) => r.name), ['backend']);
});

test('H6 a scope touching both repos selects both', () => {
  const config = { test: 'npm test', repos: { backend: {}, frontend: {} } };
  const root = makeRoot(config, ['backend', 'frontend']);
  const { repos } = resolveRepos(root, config);

  const selected = reposForScope(repos, 'backend/src/api.ts, frontend/src/Page.tsx');
  assert.deepEqual(selected.map((r) => r.name).sort(), ['backend', 'frontend']);
});

test('EC2 a scope separated by commas or newlines is split either way', () => {
  const config = { test: 'npm test', repos: { a: {}, b: {} } };
  const root = makeRoot(config, ['a', 'b']);
  const { repos } = resolveRepos(root, config);

  assert.equal(reposForScope(repos, 'a/x.ts\nb/y.ts').length, 2);
});

test('EC1 a repo name that prefixes another does not swallow it', () => {
  // "app" must not match "app-admin/..." — that is a different repo.
  const config = { test: 'npm test', repos: { app: {}, 'app-admin': {} } };
  const root = makeRoot(config, ['app', 'app-admin']);
  const { repos } = resolveRepos(root, config);

  assert.deepEqual(reposForScope(repos, 'app-admin/src/x.ts').map((r) => r.name), ['app-admin']);
  assert.deepEqual(reposForScope(repos, 'app/src/x.ts').map((r) => r.name), ['app']);
});

test('E1 a scope matching no repo returns nothing rather than everything', () => {
  const config = { test: 'npm test', repos: { backend: {}, frontend: {} } };
  const root = makeRoot(config, ['backend', 'frontend']);
  const { repos } = resolveRepos(root, config);

  // Quietly running every gate everywhere would hide a scope nobody can place.
  assert.deepEqual(reposForScope(repos, 'somewhere/else.ts'), []);
});

test('a single-repo setup ignores scope and always applies', () => {
  const root = makeRoot({ test: 'npm test' });
  const { repos } = resolveRepos(root, { test: 'npm test' });
  assert.equal(reposForScope(repos, 'bất cứ đâu').length, 1);
});

test('a repo config keeps its own path out of the merged result', () => {
  const config = { test: 'npm test', repos: { app: { path: 'sub' } } };
  const root = makeRoot(config, ['sub']);
  const app = resolveRepos(root, config).repos[0];
  assert.equal(app.config.path, undefined);
  assert.equal(app.dir, path.join(root, 'sub'));
});

test('a repo entry that is an array rather than an object is refused', () => {
  const config = { test: 'npm test', repos: { app: ['x'] } };
  const root = makeRoot(config, ['app']);
  const result = resolveRepos(root, config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('app')));
});

test('a file where a repo directory should be is refused', () => {
  const config = { test: 'npm test', repos: { app: {} } };
  const root = makeRoot(config);
  writeFileSync(path.join(root, 'app'), 'không phải thư mục');
  const result = resolveRepos(root, config);
  assert.equal(result.ok, false);
});

test('every problem across repos is reported at once', () => {
  const config = { repos: { a: {}, b: {} } };
  const root = makeRoot(config, ['a', 'b']);
  const result = resolveRepos(root, config);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2, 'cả hai repo đều thiếu test');
});

test('status names the repos a task applies to', async () => {
  const { statusCommand } = await import('../commands/status.mjs');
  const config = { test: 'npm test', repos: { backend: {}, frontend: {} } };
  const root = makeRoot(config, ['backend', 'frontend']);
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), `# T-1: Tiêu đề
Loại: fix
Phạm vi: backend/src/api.ts

## Mục tiêu
x

## Ràng buộc
x

## Rủi ro hồi quy
x

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | a | b | P0 |
| H2 | Happy | c | d | P0 |
`);

  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /Repo áp dụng: backend/);
  assert.ok(!result.output.includes('frontend'), 'không được liệt kê repo task không đụng');
});

test('status says so when a scope matches no repo', async () => {
  const { statusCommand } = await import('../commands/status.mjs');
  const config = { test: 'npm test', repos: { backend: {} } };
  const root = makeRoot(config, ['backend']);
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), `# T-1: Tiêu đề
Loại: fix
Phạm vi: chỗ-nào-đó/x.ts

## Mục tiêu
x

## Ràng buộc
x

## Rủi ro hồi quy
x

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | a | b | P0 |
| H2 | Happy | c | d | P0 |
`);

  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /không repo nào khớp/);
});
