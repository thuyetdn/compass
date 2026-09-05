import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { conventionCommand } from '../commands/convention.mjs';
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

const HEX_CONVENTIONS = `# Conventions

### Không hardcode màu

\`\`\`rule
id: no-hex-color
type: forbid-pattern
pattern: "#[0-9a-fA-F]{6}"
scope: src/**/*.jsx
severity: error
message: Dùng semantic token thay vì mã màu
\`\`\`
`;

function makeRepo({ conventions, files = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-conv-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'true' }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);

  if (conventions !== undefined) {
    const dir = path.join(root, '.knowledge', 'decided');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'conventions.md'), conventions);
  }
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

test('H3 clean source passes the gate', () => {
  const root = makeRepo({
    conventions: HEX_CONVENTIONS,
    files: { 'src/App.jsx': 'const c = "text-primary";\n' },
  });
  const result = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /PASSED/);
});

test('H4 a violation fails the gate and names file and line', () => {
  const root = makeRepo({
    conventions: HEX_CONVENTIONS,
    files: { 'src/App.jsx': 'ok\nconst c = "#ff00aa";\n' },
  });
  const result = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAILED/);
  assert.match(result.output, /App\.jsx/);
  assert.match(result.output, /:2/);
  assert.match(result.output, /no-hex-color/);
});

test('H5 a project with no conventions.md passes and says so', () => {
  const root = makeRepo({ files: { 'src/App.jsx': 'const c = "#ff00aa";\n' } });
  const result = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /không có luật|chưa có/i);
});

test('V2 an unsupported rule type fails the gate rather than being ignored', () => {
  const root = makeRepo({
    conventions: `\`\`\`rule
id: needs-ast
type: require-import
pattern: "x"
scope: src/**
severity: error
\`\`\`
`,
    files: { 'src/App.jsx': 'clean\n' },
  });
  const result = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /require-import/);
});

test('EC1 a warn-level violation shows up but keeps the gate green', () => {
  const root = makeRepo({
    conventions: HEX_CONVENTIONS.replace('severity: error', 'severity: warn'),
    files: { 'src/App.jsx': 'const c = "#ff00aa";\n' },
  });
  const result = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /no-hex-color/);
});

test('the gate record is written and signed', () => {
  const root = makeRepo({
    conventions: HEX_CONVENTIONS,
    files: { 'src/App.jsx': 'const c = "#ff00aa";\n' },
  });
  conventionCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'convention');
  assert.equal(gate.gate, 'convention');
  assert.equal(gate.exitCode, 1);
  assert.equal(gate.errorCount, 1);
  assert.ok(gate.sig.startsWith('sha256:'));
});

test('a missing task id is a usage error', () => {
  const root = makeRepo({ conventions: HEX_CONVENTIONS });
  const result = conventionCommand({ cwd: root, taskId: undefined });
  assert.equal(result.exitCode, 2);
});

test('the violation message from the rule is shown', () => {
  const root = makeRepo({
    conventions: HEX_CONVENTIONS,
    files: { 'src/App.jsx': 'const c = "#ff00aa";\n' },
  });
  const result = conventionCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /semantic token/);
});
