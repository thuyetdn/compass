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

// Quét một cây nguồn giả n file, mỗi file import file kế tiếp. Trả về mili-giây.
function doQuet(n) {
  const files = {};
  for (let i = 0; i < n; i++) {
    files[`src/C${i}.jsx`] =
      `import { C${(i + 1) % n} } from "./C${(i + 1) % n}.jsx";
` +
      `export function C${i}({ a, b }) { return null; }
`;
  }
  const root = makeRepo({ files });
  const t0 = Date.now();
  const r = knowledgeCommand({ cwd: root, sync: true });
  const ms = Date.now() - t0;
  assert.equal(r.exitCode, 0, r.output);
  return ms;
}

test('CP-10-V1 a project with no .knowledge passes and says so', () => {
  const root = makeRepo({ knowledge: false, files: APP });
  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /chưa dùng/);
});

test('CP-10-V3 derived that was never generated counts as stale', () => {
  const root = makeRepo({ files: APP });
  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /chưa sinh/);
});

test('CP-10-H6 --sync generates derived and the gate passes afterwards', () => {
  const root = makeRepo({ files: APP });
  const synced = knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  assert.equal(synced.exitCode, 0, synced.output);
  assert.ok(existsSync(path.join(root, '.knowledge', 'derived', 'components.json')));

  const after = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(after.exitCode, 0, after.output);
});

test('CP-10-H5 editing a source after sync fails the gate and names the file', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, 'src', 'Button.jsx'),
    'export function Button({ variant = "b" }) { return <b/>; }\n');

  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Button\.jsx/);
  assert.match(result.output, /Đã sửa/);
});

test('CP-10-EC1 adding a source after sync fails the gate', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, 'src', 'Card.jsx'), 'export function Card() { return null; }\n');

  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Mới thêm/);
});

test('CP-10-E1 deleting a source after sync fails the gate', () => {
  const root = makeRepo({ files: { ...APP, 'src/Card.jsx': 'export function Card() { return null; }\n' } });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  rmSync(path.join(root, 'src', 'Card.jsx'));

  const result = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Đã xóa/);
});

test('CP-10-V2 a corrupt manifest is treated as stale, not as fresh', () => {
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

test('CP-10-S2 syncing does not move the source hash other gates recorded', () => {
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

test('CP-10-P2 a second run with nothing changed passes again', () => {
  const root = makeRepo({ files: APP });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  assert.equal(knowledgeCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
  assert.equal(knowledgeCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
});

test('CP-10-S3 the knowledge gate records a sourceHash so done can catch stale docs', () => {
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

test('CP-10-E2 a derived path that cannot be written is a usage error', () => {
  // Tạo thư mục trùng tên file máy sẽ ghi: ghi vào đó ném EISDIR. Phải báo lỗi
  // dùng, không được crash và cũng không được lặng lẽ coi như sync xong.
  const root = makeRepo({ files: { 'src/Nut.jsx': 'export function Nut() { return null; }\n' } });
  mkdirSync(path.join(root, '.knowledge', 'derived', 'components.json'), { recursive: true });

  const result = knowledgeCommand({ cwd: root, sync: true });
  assert.equal(result.exitCode, 2, 'không ghi được derived/ là lỗi dùng');
  assert.doesNotMatch(result.output, /PASSED/);
});

test('CP-10-EC2 syncing does not move the source hash', () => {
  // `derived/` là máy sinh, không phải mã nguồn. Nếu sync làm sourceHash lệch
  // thì mọi gate vừa chạy xong đều thành "bằng chứng nói về bản cũ".
  const root = makeRepo({ files: { 'src/Nut.jsx': 'export function Nut() { return null; }\n' } });
  const truoc = hashSource(root);
  const result = knowledgeCommand({ cwd: root, sync: true });
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(hashSource(root), truoc, 'sync không được đụng vào sourceHash');
});

test('CP-10-P1 the scan grows with the file count, not its square', () => {
  // Đo **hình dạng**, không đo tốc độ: ngưỡng tuyệt đối không canh được gì vì
  // 120 file chạy 25ms, còn dư 200 lần trước khi chạm 5 giây.
  //
  // Và phải đo ở thang đủ lớn. Bản trước chọn 150→600, nơi số hạng bậc hai
  // chưa kịp trội: code vẫn O(component × file) mà tỉ số chỉ 2.9, test xanh.
  // Ở 500→2000 thì cùng code đó cho tỉ số 6.8, và 1000→4000 cho 10.2.
  const do1 = doQuet(500);
  const do2 = doQuet(2000);

  // Bốn lần số file. Tuyến tính thì ~4x, bậc hai thì ~16x. Chốt ở 8 — đủ xa cả
  // hai phía để nhiễu máy không làm test chập chờn.
  const tiSo = do2 / Math.max(do1, 1);
  assert.ok(tiSo < 8, `gấp 4 lần file làm thời gian gấp ${tiSo.toFixed(1)} lần — bậc hai`);
});
