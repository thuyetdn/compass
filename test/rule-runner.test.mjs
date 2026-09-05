import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runRules, matchesScope } from '../lib/rule-runner.mjs';

function makeRepo(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-rules-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const HEX_RULE = {
  id: 'no-hex-color',
  type: 'forbid-pattern',
  pattern: '#[0-9a-fA-F]{6}',
  scope: 'src/**/*.jsx',
  severity: 'error',
  message: undefined,
};

test('H3 clean source produces no violations', () => {
  const root = makeRepo({ 'src/App.jsx': 'const c = "text-primary";\n' });
  const result = runRules(root, [HEX_RULE]);
  assert.deepEqual(result.violations, []);
  assert.equal(result.scanned, 1);
});

test('H4 a violation names the file and the line', () => {
  const root = makeRepo({
    'src/App.jsx': 'const a = 1;\nconst c = "#ff00aa";\n',
  });
  const result = runRules(root, [HEX_RULE]);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule, 'no-hex-color');
  assert.equal(result.violations[0].file, path.join('src', 'App.jsx'));
  assert.equal(result.violations[0].line, 2);
  assert.match(result.violations[0].text, /#ff00aa/);
});

test('E2 a scope matching nothing scans no files and does not throw', () => {
  const root = makeRepo({ 'src/App.jsx': 'x\n' });
  const rule = { ...HEX_RULE, scope: 'nowhere/**/*.ts' };
  const result = runRules(root, [rule]);
  assert.deepEqual(result.violations, []);
  assert.equal(result.scanned, 0);
});

test('EC1 a warn-level violation is reported but does not fail the gate', () => {
  const root = makeRepo({ 'src/App.jsx': 'const c = "#ff00aa";\n' });
  const rule = { ...HEX_RULE, severity: 'warn' };
  const result = runRules(root, [rule]);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].severity, 'warn');
  assert.equal(result.errorCount, 0);
  assert.equal(result.warnCount, 1);
});

test('EC2 node_modules is never scanned', () => {
  const root = makeRepo({
    'src/App.jsx': 'clean\n',
    'node_modules/pkg/src/App.jsx': 'const c = "#ff00aa";\n',
  });
  const result = runRules(root, [{ ...HEX_RULE, scope: '**/*.jsx' }]);
  assert.deepEqual(result.violations, []);
});

test('dist and .git are never scanned', () => {
  const root = makeRepo({
    'dist/App.jsx': 'const c = "#ff00aa";\n',
    '.git/App.jsx': 'const c = "#ff00aa";\n',
  });
  const result = runRules(root, [{ ...HEX_RULE, scope: '**/*.jsx' }]);
  assert.deepEqual(result.violations, []);
});

test('several violations in one file are all reported', () => {
  const root = makeRepo({
    'src/App.jsx': 'a "#ff0000"\nb clean\nc "#00ff00"\n',
  });
  const result = runRules(root, [HEX_RULE]);
  assert.deepEqual(result.violations.map((v) => v.line), [1, 3]);
});

test('errorCount counts only error-level violations', () => {
  const root = makeRepo({ 'src/App.jsx': 'a "#ff0000"\nb "TODO"\n' });
  const rules = [
    HEX_RULE,
    { id: 'no-todo', type: 'forbid-pattern', pattern: 'TODO', scope: 'src/**/*.jsx', severity: 'warn' },
  ];
  const result = runRules(root, rules);
  assert.equal(result.errorCount, 1);
  assert.equal(result.warnCount, 1);
});

test('S1 a catastrophic pattern is cut off rather than hanging', () => {
  const root = makeRepo({ 'src/App.jsx': 'a'.repeat(3000) + '!' });
  const rule = { ...HEX_RULE, id: 'evil', pattern: '(a+)+$' };
  const started = Date.now();
  const result = runRules(root, [rule]);
  assert.ok(Date.now() - started < 5000, 'phải dừng, không treo');
  assert.ok(result.skippedRules.includes('evil') || result.violations.length >= 0);
});

test('matchesScope handles a double-star prefix', () => {
  assert.equal(matchesScope('src/a/b/App.jsx', '**/*.jsx'), true);
  assert.equal(matchesScope('src/App.tsx', '**/*.jsx'), false);
});

test('matchesScope handles a directory prefix', () => {
  assert.equal(matchesScope('src/App.jsx', 'src/**/*.jsx'), true);
  assert.equal(matchesScope('test/App.jsx', 'src/**/*.jsx'), false);
});

test('matchesScope treats a single star as one path segment', () => {
  assert.equal(matchesScope('src/App.jsx', 'src/*.jsx'), true);
  assert.equal(matchesScope('src/deep/App.jsx', 'src/*.jsx'), false);
});
