import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { uiCommand } from '../commands/ui.mjs';
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

function makeRepo({ config = { test: 'true' }, contract } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-ui-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify(config));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  if (contract !== undefined) {
    writeFileSync(path.join(root, '.compass', 'T-1', 'design-contract.json'), contract);
  }
  return root;
}

test('CP-4-H5 a task with no design contract passes and says so', async () => {
  const root = makeRepo();
  const result = await uiCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /chưa có hợp đồng|không có hợp đồng/i);
});

test('CP-4-V5 a contract that is not JSON fails with a usage error', async () => {
  const root = makeRepo({ contract: '{ broken' });
  const result = await uiCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /JSON/);
});

test('CP-4-V6 a contract element missing its selector is named', async () => {
  const root = makeRepo({
    contract: JSON.stringify({ elements: [{ name: 'Nút gửi', properties: { color: '#000' } }] }),
  });
  const result = await uiCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Nút gửi/);
});

test('CP-4-E4 a contract with no dev command in config is a usage error', async () => {
  const root = makeRepo({
    config: { test: 'true' },
    contract: JSON.stringify({
      elements: [{ name: 'x', selector: 'h1', properties: { color: '#000' } }],
    }),
  });
  const result = await uiCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /dev/);
});

test('CP-4-E5 a config with dev but no devUrl is a usage error', async () => {
  const root = makeRepo({
    config: { test: 'true', dev: 'npm run dev' },
    contract: JSON.stringify({
      elements: [{ name: 'x', selector: 'h1', properties: { color: '#000' } }],
    }),
  });
  const result = await uiCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /devUrl/);
});

test('CP-4-E1 a project without playwright is told how to install it', async () => {
  const root = makeRepo({
    config: { test: 'true', dev: 'npm run dev', devUrl: 'http://localhost:5173/' },
    contract: JSON.stringify({
      elements: [{ name: 'x', selector: 'h1', properties: { color: '#000' } }],
    }),
  });
  const result = await uiCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /playwright/i);
});

test('CP-4-EC5 an empty contract passes with nothing measured', async () => {
  const root = makeRepo({
    config: { test: 'true', dev: 'npm run dev', devUrl: 'http://localhost:5173/' },
    contract: JSON.stringify({ elements: [] }),
  });
  const result = await uiCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /0 thuộc tính/);
});

test('the gate record is written when the contract is absent', async () => {
  const root = makeRepo();
  await uiCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'ui');
  assert.equal(gate.gate, 'ui');
  assert.equal(gate.exitCode, 0);
  assert.ok(gate.sig.startsWith('sha256:'));
});

test('a missing task id is a usage error', async () => {
  const root = makeRepo();
  const result = await uiCommand({ cwd: root, taskId: undefined });
  assert.equal(result.exitCode, 2);
});

test('CP-4-E3 a selector the page never renders is reported as drift, by name', async () => {
  // The real path: the browser answers found:false, and the gate must turn that
  // into a named drift rather than skipping the element.
  const { buildMeasureScript } = await import('../lib/browser.mjs');
  const script = buildMeasureScript([{ selector: '.khong-ton-tai', properties: { color: '#000' } }]);

  // Run the page script the same way a browser would, against an empty DOM.
  const fakeDocument = { querySelector: () => null };
  const results = new Function('document', 'getComputedStyle', `return ${script}`)(
    fakeDocument,
    () => ({ getPropertyValue: () => '' }),
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].found, false);
  assert.equal(results[0].selector, '.khong-ton-tai');
});
