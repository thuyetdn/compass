import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { visualCommand } from '../commands/visual.mjs';
import { readGate } from '../lib/gate-store.mjs';

const SPEC = `# T-1: Tiêu đề
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

const CONTRACT = JSON.stringify({
  viewports: [{ name: 'desktop', width: 800, height: 600 }],
  elements: [{ name: 'x', selector: 'h1', properties: { color: '#000' } }],
});

function makeRepo({ config = { test: 'true' }, contract } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-visual-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify(config));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  if (contract !== undefined) {
    writeFileSync(path.join(root, '.compass', 'T-1', 'design-contract.json'), contract);
  }
  return root;
}

test('a task with no design contract passes and says why', async () => {
  const root = makeRepo();
  const result = await visualCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /chưa có hợp đồng/);
});

test('V3 a non-numeric threshold in config is rejected', async () => {
  const root = makeRepo({
    config: { test: 'true', dev: 'x', devUrl: 'http://localhost:1/', visualThreshold: 'nhiều' },
    contract: CONTRACT,
  });
  const result = await visualCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /visualThreshold/);
});

test('a negative threshold is rejected', async () => {
  const root = makeRepo({
    config: { test: 'true', dev: 'x', devUrl: 'http://localhost:1/', visualThreshold: -1 },
    contract: CONTRACT,
  });
  const result = await visualCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /visualThreshold/);
});

test('a config with no dev command is a usage error', async () => {
  const root = makeRepo({ config: { test: 'true' }, contract: CONTRACT });
  const result = await visualCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /dev/);
});

test('a project without playwright is told how to install it', async () => {
  const root = makeRepo({
    config: { test: 'true', dev: 'x', devUrl: 'http://localhost:1/' },
    contract: CONTRACT,
  });
  const result = await visualCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /playwright/i);
});

test('an invalid contract is reported, not thrown', async () => {
  const root = makeRepo({
    config: { test: 'true', dev: 'x', devUrl: 'http://localhost:1/' },
    contract: '{ broken',
  });
  const result = await visualCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /JSON/);
});

test('the gate record is written when there is no contract', async () => {
  const root = makeRepo();
  await visualCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'visual');
  assert.equal(gate.gate, 'visual');
  assert.equal(gate.exitCode, 0);
  assert.ok(gate.sig.startsWith('sha256:'));
});

test('a missing task id is a usage error', async () => {
  const root = makeRepo();
  const result = await visualCommand({ cwd: root, taskId: undefined });
  assert.equal(result.exitCode, 2);
});
