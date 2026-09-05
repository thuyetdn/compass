import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { knowledgeCommand } from '../commands/knowledge.mjs';
import { readGate } from '../lib/gate-store.mjs';
import { hashSource } from '../lib/source-hash.mjs';

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

function makeRepo({ knowledge = true, files = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-kg-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'true' }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);

  if (knowledge) mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const APP = { 'src/Button.jsx': 'export function Button({ variant = "a", size }) { return <b>{size}</b>; }\n' };

test('V1 a project with no .knowledge passes and says so', () => {
  const root = makeRepo({ knowledge: false, files: APP });
  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /chưa dùng/);
});

test('V3 derived that was never generated counts as stale', () => {
  const root = makeRepo({ files: APP });
  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /chưa sinh/);
});

test('H6 --sync generates derived and the gate passes afterwards', () => {
  const root = makeRepo({ files: APP });
  const synced = knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  assert.equal(synced.exitCode, 0, synced.output);
  assert.ok(existsSync(path.join(root, '.knowledge', 'derived', 'components.json')));

  const after = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(after.exitCode, 0, after.output);
});

test('H5 editing a source after sync fails the gate and names the file', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, 'src', 'Button.jsx'),
    'export function Button({ variant = "b" }) { return <b/>; }\n');

  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Button\.jsx/);
  assert.match(result.output, /Đã sửa/);
});

test('EC1 adding a source after sync fails the gate', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, 'src', 'Card.jsx'), 'export function Card() { return null; }\n');

  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Mới thêm/);
});

test('E1 deleting a source after sync fails the gate', () => {
  const root = makeRepo({ files: { ...APP, 'src/Card.jsx': 'export function Card() { return null; }\n' } });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  rmSync(path.join(root, 'src', 'Card.jsx'));

  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Đã xóa/);
});

test('V2 a corrupt manifest is treated as stale, not as fresh', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, '.knowledge', 'derived', '.manifest'), '{ hỏng');

  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /hỏng/);
});

test('the generated components file carries props and usedIn', () => {
  const root = makeRepo({
    files: { ...APP, 'src/Page.jsx': "import { Button } from './Button';\nexport const Page = () => <Button/>;\n" },
  });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });

  const derived = JSON.parse(readFileSync(path.join(root, '.knowledge', 'derived', 'components.json'), 'utf8'));
  assert.deepEqual(Object.keys(derived.Button.props).sort(), ['size', 'variant']);
  assert.equal(derived.Button.usedIn, 1);
});

test('--sync names the components nobody imports', () => {
  const root = makeRepo({ files: APP });
  const result = knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  assert.match(result.output, /Không ai dùng/);
  assert.match(result.output, /Button/);
});

test('--sync warns about components whose props it could not read', () => {
  const root = makeRepo({ files: { 'src/Odd.jsx': 'export function Odd(props) { return <i>{props.x}</i>; }\n' } });
  const result = knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  assert.match(result.output, /confident/);
});

test('S2 syncing does not move the source hash other gates recorded', () => {
  const root = makeRepo({ files: APP });
  const before = hashSource(root);
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  // Writing derived docs must not invalidate every other gate's evidence.
  assert.equal(hashSource(root), before);
});

test('the gate record is written and signed', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'knowledge');
  assert.equal(gate.gate, 'knowledge');
  assert.equal(gate.exitCode, 1);
  assert.ok(gate.sig.startsWith('sha256:'));
});

test('P2 a second run with nothing changed passes again', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  assert.equal(knowledgeCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
  assert.equal(knowledgeCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
});

test('S3 the knowledge gate records a sourceHash so done can catch stale docs', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  knowledgeCommand({ cwd: root, taskId: 'T-1' });

  const gate = readGate(root, 'T-1', 'knowledge');
  assert.equal(gate.exitCode, 0);
  assert.ok(gate.sourceHash?.startsWith('sha256:'),
    'thiếu sourceHash thì done không biết code đã đổi sau khi gate chạy');
});

test('a deleted components.json fails the gate even when sources are unchanged', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  rmSync(path.join(root, '.knowledge', 'derived', 'components.json'));

  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /đã bị xóa/);
});

test('a hand-edited components.json fails the gate', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, '.knowledge', 'derived', 'components.json'),
    '{ "Button": { "props": { "BỊA": {} } } }\n');

  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /không khớp/);
});

test('an invalid task id is refused like every other command', () => {
  const root = makeRepo({ files: APP });
  const result = knowledgeCommand({ cwd: root, taskId: '../escape' });
  assert.equal(result.exitCode, 2);
});
