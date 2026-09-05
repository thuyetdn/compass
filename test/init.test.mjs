import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initCommand } from '../commands/init.mjs';

const makeDir = () => mkdtempSync(path.join(tmpdir(), 'compass-init-'));

test('initCommand bootstraps config.json on first run', () => {
  const cwd = makeDir();
  const result = initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  assert.equal(result.exitCode, 0);
  assert.ok(existsSync(path.join(cwd, '.compass', 'config.json')));
});

test('initCommand creates the task spec file', () => {
  const cwd = makeDir();
  initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  assert.ok(existsSync(path.join(cwd, '.compass', 'T-1', 'spec.md')));
});

test('initCommand fills the template placeholders', () => {
  const cwd = makeDir();
  initCommand({ cwd, taskId: 'T-42', type: 'feature-m' });
  const spec = readFileSync(path.join(cwd, '.compass', 'T-42', 'spec.md'), 'utf8');
  assert.match(spec, /# T-42:/);
  assert.match(spec, /Loại: feature-m/);
  assert.match(spec, /tối thiểu 21 test cases/);
  assert.ok(!spec.includes('{{'));
});

test('initCommand rejects an unknown task type', () => {
  const cwd = makeDir();
  const result = initCommand({ cwd, taskId: 'T-1', type: 'gigantic' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Loại/);
});

test('initCommand rejects a missing task type', () => {
  const cwd = makeDir();
  const result = initCommand({ cwd, taskId: 'T-1', type: undefined });
  assert.equal(result.exitCode, 2);
});

test('initCommand refuses to overwrite an existing spec', () => {
  const cwd = makeDir();
  initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  const second = initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  assert.equal(second.exitCode, 2);
  assert.match(second.output, /đã tồn tại/);
});

test('initCommand reuses an existing config', () => {
  const cwd = makeDir();
  initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  const before = readFileSync(path.join(cwd, '.compass', 'config.json'), 'utf8');
  initCommand({ cwd, taskId: 'T-2', type: 'fix' });
  const after = readFileSync(path.join(cwd, '.compass', 'config.json'), 'utf8');
  assert.equal(before, after);
});
