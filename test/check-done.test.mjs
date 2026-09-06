import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkCommand } from '../commands/check.mjs';
import { doneCommand } from '../commands/done.mjs';
import { statusCommand } from '../commands/status.mjs';
import { gatePath } from '../lib/paths.mjs';
import { readGate } from '../lib/gate-store.mjs';
import { getSalt, signRecord } from '../lib/signature.mjs';

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

const GREEN = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\')"';
const RED   = 'node -e "console.log(\'ok 1 - test_H1_a\'); process.exit(1)"';

function makeTask(testCmd, specText = SPEC) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-check-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: testCmd }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), specText);
  return root;
}

test('checkCommand runs every applicable gate and passes', async () => {
  const root = makeTask(GREEN);
  const result = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /spec/);
  assert.match(result.output, /test/);
});

test('checkCommand stops at the first failing gate', async () => {
  const badSpec = SPEC.replace('Không có.\n\n## Test cases', '\n\n## Test cases');
  const root = makeTask(GREEN, badSpec);
  const result = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.ok(!result.output.includes('Gate test'));
});

test('checkCommand reports gates not yet implemented as skipped', async () => {
  const root = makeTask(GREEN);
  const result = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(result.output, /Gate convention FAILED/);
});

test('checkCommand honours --only', async () => {
  const root = makeTask(RED);
  const result = await checkCommand({ cwd: root, taskId: 'T-1', only: 'spec' });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, /Gate test/);
});

test('C4: checkCommand --only with an unknown gate exits non-zero and names valid gates', async () => {
  const root = makeTask(GREEN);
  const result = await checkCommand({ cwd: root, taskId: 'T-1', only: 'bogus' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /không áp dụng/);
  assert.match(result.output, /spec/);
  assert.match(result.output, /test/);
});

test('C4: checkCommand --only with a gate the task does not use exits non-zero', async () => {
  // review starts at feature-m, so asking for it on a feature-s task is a
  // usage error — never a quiet exit 0 that reads like the gate ran.
  const featureSSpec = SPEC.replace('Loại: fix', 'Loại: feature-s');
  const root = makeTask(GREEN, featureSSpec);
  const result = await checkCommand({ cwd: root, taskId: 'T-1', only: 'review' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /không áp dụng/);
});

test('doneCommand passes after a clean check', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('doneCommand fails when a required gate never ran', async () => {
  const root = makeTask(GREEN);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /chưa chạy/);
});

test('doneCommand fails when a gate exited non-zero', async () => {
  const root = makeTask(RED);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
});

test('doneCommand detects a hand-edited gate record', async () => {
  const root = makeTask(RED);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.test.exitCode = 0;
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /chữ ký/);
});

test('doneCommand says a pre-taskId record predates this version, not that it is tampered', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const oldStyle = { gate: 'test', exitCode: 0 };
  data.test = { ...oldStyle, sig: signRecord(oldStyle, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /bản Compass cũ|chưa có taskId/);
});

test('doneCommand detects a spec edited after the test gate ran', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const spec = path.join(root, '.compass', 'T-1', 'spec.md');
  writeFileSync(spec, SPEC + '\n<!-- sửa sau khi test đã chạy -->\n');
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Spec đã thay đổi/);
});

test('statusCommand lists gate state', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /spec/);
  assert.match(result.output, /test/);
});

test('doneCommand for feature-m blocks until the review gate has run', async () => {
  // Build a feature-m spec with 21 test cases spanning all 6 layers
  // Counts: Happy 4, Validation 4, Error 4, Edge 4, Security 3, Performance 2 = 21
  const rows = [
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
    '| H1 | Happy | Case 1 | Pass | P0 |',
    '| H2 | Happy | Case 2 | Pass | P0 |',
    '| H3 | Happy | Case 3 | Pass | P0 |',
    '| H4 | Happy | Case 4 | Pass | P0 |',
    '| V1 | Validation | Case 5 | Pass | P0 |',
    '| V2 | Validation | Case 6 | Pass | P0 |',
    '| V3 | Validation | Case 7 | Pass | P0 |',
    '| V4 | Validation | Case 8 | Pass | P0 |',
    '| E1 | Error | Case 9 | Pass | P0 |',
    '| E2 | Error | Case 10 | Pass | P0 |',
    '| E3 | Error | Case 11 | Pass | P0 |',
    '| E4 | Error | Case 12 | Pass | P0 |',
    '| X1 | Edge | Case 13 | Pass | P0 |',
    '| X2 | Edge | Case 14 | Pass | P0 |',
    '| X3 | Edge | Case 15 | Pass | P0 |',
    '| X4 | Edge | Case 16 | Pass | P0 |',
    '| S1 | Security | Case 17 | Pass | P0 |',
    '| S2 | Security | Case 18 | Pass | P0 |',
    '| S3 | Security | Case 19 | Pass | P0 |',
    '| P1 | Performance | Case 20 | Pass | P0 |',
    '| P2 | Performance | Case 21 | Pass | P0 |',
  ];

  const featureMSpec = `# T-FM: Feature trung bình
Loại: feature-m
Phạm vi: src/

## Mục tiêu
Làm gì đó lớn.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
${rows.join('\n')}
`;

  const testLines = [
    'ok 1 - test_H1_a', 'ok 2 - test_H2_a', 'ok 3 - test_H3_a', 'ok 4 - test_H4_a',
    'ok 5 - test_V1_a', 'ok 6 - test_V2_a', 'ok 7 - test_V3_a', 'ok 8 - test_V4_a',
    'ok 9 - test_E1_a', 'ok 10 - test_E2_a', 'ok 11 - test_E3_a', 'ok 12 - test_E4_a',
    'ok 13 - test_X1_a', 'ok 14 - test_X2_a', 'ok 15 - test_X3_a', 'ok 16 - test_X4_a',
    'ok 17 - test_S1_a', 'ok 18 - test_S2_a', 'ok 19 - test_S3_a',
    'ok 20 - test_P1_a', 'ok 21 - test_P2_a'
  ];
  const greenForFeatureM = 'node -e "' + testLines.map(line => `console.log('${line}')`).join('; ') + '"';

  const root = mkdtempSync(path.join(tmpdir(), 'compass-check-'));
  mkdirSync(path.join(root, '.compass', 'T-FM', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: greenForFeatureM }));
  writeFileSync(path.join(root, '.compass', 'T-FM', 'spec.md'), featureMSpec);

  await checkCommand({ cwd: root, taskId: 'T-FM' });
  const result = doneCommand({ cwd: root, taskId: 'T-FM' });
  // Every gate is built now, so a feature-m task cannot close until an
  // independent agent has actually reviewed the diff.
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /review/);

  rmSync(root, { recursive: true });
});

test('doneCommand for fix task does NOT report unimplemented gates on pass', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, /chưa xây dựng/);
});

test('doneCommand for feature-m still blocks when the suite is red', async () => {
  // Build a feature-m spec with 21 test cases spanning all 6 layers
  // Counts: Happy 4, Validation 4, Error 4, Edge 4, Security 3, Performance 2 = 21
  const layers = ['Happy', 'Validation', 'Error', 'Edge', 'Security', 'Performance'];
  const rows = [
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
  ];
  let id = 1;
  for (const layer of layers) {
    let count;
    if (layer === 'Happy') count = 4;
    else if (layer === 'Validation') count = 4;
    else if (layer === 'Error') count = 4;
    else if (layer === 'Edge') count = 4;
    else if (layer === 'Security') count = 3;
    else count = 2; // Performance

    for (let i = 0; i < count; i++) {
      const testId = `${layer.substring(0, 2)}_${id}`;
      rows.push(`| ${testId} | ${layer} | Case ${id} | Pass | P0 |`);
      id++;
    }
  }

  const featureMSpec = `# T-FM2: Feature trung bình
Loại: feature-m
Phạm vi: src/

## Mục tiêu
Làm gì đó lớn.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
${rows.join('\n')}
`;

  const root = mkdtempSync(path.join(tmpdir(), 'compass-check-'));
  mkdirSync(path.join(root, '.compass', 'T-FM2', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: RED }));
  writeFileSync(path.join(root, '.compass', 'T-FM2', 'spec.md'), featureMSpec);

  await checkCommand({ cwd: root, taskId: 'T-FM2' });
  const result = doneCommand({ cwd: root, taskId: 'T-FM2' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /review|test/);

  rmSync(root, { recursive: true });
});

test('doneCommand with corrupt gate.json returns exit 2 with clean message', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const gateFile = gatePath(root, 'T-1');
  writeFileSync(gateFile, 'not valid json {');

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không thể đọc ledger gate/);
  assert.doesNotMatch(result.output, /at readGates/);
});

test('statusCommand with corrupt gate.json returns exit 2 with clean message', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const gateFile = gatePath(root, 'T-1');
  writeFileSync(gateFile, 'not valid json {');

  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không thể đọc ledger gate/);
  assert.doesNotMatch(result.output, /at readGates/);
});

test('doneCommand detects actual JSON corruption and claims it', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const gateFile = gatePath(root, 'T-1');
  writeFileSync(gateFile, 'not valid json {');

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Bản ghi có thể bị hỏng/);
  assert.doesNotMatch(result.output, /at /);
});

test('statusCommand detects actual JSON corruption and claims it', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const gateFile = gatePath(root, 'T-1');
  writeFileSync(gateFile, 'not valid json {');

  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Bản ghi có thể bị hỏng/);
  assert.doesNotMatch(result.output, /at /);
});

test('doneCommand where gate.json is a directory reports read error, not corruption', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const gateFile = gatePath(root, 'T-1');
  rmSync(gateFile);
  mkdirSync(gateFile);

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.doesNotMatch(result.output, /Bản ghi có thể bị hỏng/);
  assert.match(result.output, /Lỗi:/);
  assert.match(result.output, /EISDIR/);
  assert.doesNotMatch(result.output, /at /);
});

test('statusCommand where gate.json is a directory reports read error, not corruption', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const gateFile = gatePath(root, 'T-1');
  rmSync(gateFile);
  mkdirSync(gateFile);

  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.doesNotMatch(result.output, /Bản ghi có thể bị hỏng/);
  assert.match(result.output, /Lỗi:/);
  assert.match(result.output, /EISDIR/);
  assert.doesNotMatch(result.output, /at /);
});

test('doneCommand rejects a test gate that recorded no configHash', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  // Dựng lại bản ghi kiểu phiên bản cũ: bỏ configHash rồi ký lại hợp lệ.
  const file = gatePath(root, 'T-1');
  const gates = JSON.parse(readFileSync(file, 'utf8'));
  delete gates.test.configHash;
  delete gates.test.sig;
  gates.test.sig = signRecord(gates.test, getSalt(root));
  writeFileSync(file, JSON.stringify(gates, null, 2));

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /phiên bản cũ/);
});

test('doneCommand still passes when the test gate carries its configHash', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
});

test('CP-7-S1 editing code after every gate is green blocks done, naming the gate', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0, 'phải xanh trước đã');

  // The gap this closes: evidence describes code that no longer exists.
  writeFileSync(path.join(root, 'src.js'), 'eval(process.env.EVIL);\n');

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /Code đã thay đổi/);
  assert.match(result.output, /test/);
});

test('CP-7-H5 running check then done with nothing touched still passes', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
  // Twice, because done itself writes nothing that should move the hash.
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
});

test('CP-7-V1 a gate record with no sourceHash is refused as coming from an older build', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  delete data.test.sourceHash;
  const salt = getSalt(root);
  const { sig, ...rest } = data.test;
  data.test = { ...rest, sig: signRecord(rest, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /phiên bản cũ|không ghi lại/);
});

test('CP-7-V2 the spec gate is not asked for a sourceHash — it never reads code', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const gate = JSON.parse(readFileSync(gatePath(root, 'T-1'), 'utf8'));
  assert.equal(gate.spec.sourceHash, undefined);
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
});

// CP-16 — gate chạy thêm ngoài danh sách bắt buộc vẫn phải xanh. Loại `bug`
// không đòi `review`, nhưng chạy nó rồi để đỏ mà `done` xanh thì đúng là "báo
// xong khi chưa xong", ngay tại cổng sinh ra để chặn.

// Ghi một bản ghi gate đã ký vào sổ, như thể gate đó vừa chạy.
function ghiGate(root, name, exitCode) {
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const record = { gate: name, taskId: 'T-1', exitCode };
  data[name] = { ...record, sig: signRecord(record, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));
}

test('CP-16-H1 a green gate outside the required list still closes', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  ghiGate(root, 'review', 0);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('CP-16-H2 a red gate outside the required list blocks done', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  ghiGate(root, 'review', 1);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /review/);
});

test('CP-16-H3 the message names a command that actually works', async () => {
  // `compass check --only=<gate>` TỪ CHỐI gate ngoài danh sách loại task, nên
  // bảo người ta chạy nó là bảo họ đâm vào tường. Lệnh chạy được là
  // `compass <gate> <id>`.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  ghiGate(root, 'review', 1);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /compass review T-1/, 'phải chỉ đúng lệnh chạy lại được');
  assert.doesNotMatch(result.output, /--only=review/, 'lệnh đó bị từ chối, đừng gợi ý');
  assert.match(result.output, /gate\.json/, 'phải nói xoá ở đâu, không chỉ nói "xoá bản ghi"');
});

test('CP-16-H4 every red gate outside the list is named, not just the first', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  ghiGate(root, 'review', 1);
  ghiGate(root, 'convention', 1);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });

  // Đếm đúng dòng "đã chạy và đỏ". Chỉ tìm chữ `convention` là rỗng nghĩa: nó
  // xuất hiện vì lý do khác (thiếu sourceHash), nên chèn `break` sau gate đầu
  // tiên vẫn xanh — reviewer đã chứng minh đúng như vậy.
  const dongDo = result.output.split('\n').filter((l) => l.includes('đã chạy và đỏ'));
  assert.equal(dongDo.length, 2, `phải nêu cả hai gate, thấy: ${dongDo.length}`);
  assert.ok(dongDo.some((l) => l.includes('"review"')));
  assert.ok(dongDo.some((l) => l.includes('"convention"')));
});

test('CP-16-V1 a gate outside the list that never ran does not block', async () => {
  // Loại `fix` không đòi `ui`. Thiếu `ui` là bình thường, không phải lỗi.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.doesNotMatch(result.output, /ui/);
});

test('CP-16-V2 a red required gate is still reported the old way', async () => {
  const root = makeTask(RED);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /chưa pass/, 'gate bắt buộc dùng thông báo cũ');
  assert.doesNotMatch(result.output, /không bắt buộc gate này/);
});

test('CP-16-V3 a red done record from a previous run does not block itself', async () => {
  // `readGates` trả về cả khoá `done`. Không loại ra thì lần done đỏ đầu tiên
  // chặn mọi lần sau, kể cả khi đã sửa hết.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  ghiGate(root, 'done', 1);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('CP-16-E1 an unknown key in gate.json is ignored, not crashed on', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  ghiGate(root, 'khonghecogate', 1);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('CP-16-EC1 a task type requiring every gate has nothing outside the list', async () => {
  const specM = SPEC.replace('Loại: fix', 'Loại: feature-m');
  const root = makeTask(GREEN, specM);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  ghiGate(root, 'review', 1);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  // `review` là gate bắt buộc của feature-m, nên nó phải rơi vào nhánh cũ.
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.output, /không bắt buộc gate này/);
});

test('CP-16-EC2 deleting the red record lets the task close', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  ghiGate(root, 'review', 1);
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 1);

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  delete data.review;
  writeFileSync(file, JSON.stringify(data, null, 2));

  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
});

test('CP-16-V4 a stale green gate outside the list also blocks', async () => {
  // Chỉ soi `exitCode` thì bản ghi xanh từ ba tuần trước vẫn đóng được task —
  // "đỏ thì tin, xanh thì tin luôn cả khi đã mốc".
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  // Bản ghi xanh nhưng sourceHash nói về code khác.
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const record = {
    gate: 'convention', taskId: 'T-1', exitCode: 0,
    sourceHash: 'hash-cua-mot-ban-code-khac',
  };
  data.convention = { ...record, sig: signRecord(record, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, 'bản ghi xanh mà mốc vẫn phải chặn');
  assert.match(result.output, /convention/);
});

test('CP-16-E2 a record missing exitCode is blocked, and said so plainly', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const record = { gate: 'review', taskId: 'T-1' };
  data.review = { ...record, sig: signRecord(record, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.output, /exit code undefined/,
    'thiếu trường là bản ghi hỏng, đừng mô tả thành "exit code undefined"');
});

test('CP-16-H5 a stale out-of-list gate is told the command that fixes it', async () => {
  // Ba vòng kiểm hash nói "Chạy lại: compass check" — câu viết hồi mọi gate bị
  // soi đều bắt buộc. Với gate chạy thêm, `check` không chạm tới nó: chạy xong
  // vẫn đỏ y nguyên, và người dùng quay vòng.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const rec = { gate: 'convention', taskId: 'T-1', exitCode: 0, sourceHash: 'hash-moc-meo' };
  data.convention = { ...rec, sig: signRecord(rec, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /compass convention T-1/, 'phải chỉ lệnh chạm được gate này');
  assert.doesNotMatch(result.output, /Chạy: compass check T-1/,
    'check không sửa được gate ngoài danh sách — đừng gợi ý nó');
});

test('CP-16-H6 a required gate still gets the check hint', async () => {
  // Mặt còn lại: gate bắt buộc thì `check` đúng là lệnh cần chạy.
  const root = makeTask(RED);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /compass check T-1/);
});

// CP-21 — cổng cuối cũng phải để lại bằng chứng.

test('CP-21-H1 a green done writes a signed record into the ledger', async () => {
  // Mọi gate khác đều ký và lưu; riêng cổng quyết định "xong hay chưa" thì
  // không, nên không lệnh nào biết task đã đóng.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  const gate = readGate(root, 'T-1', 'done');
  assert.ok(gate, 'phải có bản ghi done');
  assert.equal(gate.exitCode, 0);
  assert.ok(gate.sig, 'phải ký như mọi bản ghi khác');
  assert.ok(gate.closedAt, 'phải ghi lúc đóng');
});

test('CP-21-H2 status says a closed task is closed', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const truoc = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.match(truoc.output, /đang mở/, 'chưa đóng thì phải nói đang mở');

  doneCommand({ cwd: root, taskId: 'T-1' });
  const sau = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.match(sau.output, /ĐÃ ĐÓNG/);
});

test('CP-21-H3 running done twice stays green', async () => {
  // Bản ghi `done` không được tự chặn lần sau — đóng một lần là hết đường kiểm
  // lại thì không ai dám chạy.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
  const lai = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(lai.exitCode, 0, lai.output);
});

test('CP-21-V1 a red done writes no green record', async () => {
  const root = makeTask(RED);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 1);
  assert.equal(readGate(root, 'T-1', 'done'), null, 'đỏ thì không được để lại dấu xanh');
});

test('CP-21-V2 a hand-edited done record is caught', async () => {
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  doneCommand({ cwd: root, taskId: 'T-1' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.done.gateCount = 99;
  writeFileSync(file, JSON.stringify(data, null, 2));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /chữ ký/);
});

test('CP-16-S1 a red gate in a repo slot still blocks done', async () => {
  // `slotFor` lưu bản ghi thành `convention@be`. So nguyên chuỗi với
  // IMPLEMENTED_GATES thì mọi bản ghi đa repo bị bỏ qua như khoá lạ, và gate đỏ
  // ở một repo lọt thẳng qua cổng cuối.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const rec = { gate: 'convention', taskId: 'T-1', repo: 'be', exitCode: 1 };
  data['convention@be'] = { ...rec, sig: signRecord(rec, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, 'gate đỏ ở repo vẫn là gate đỏ');
  assert.match(r.output, /convention/);
});

test('CP-16-S2 a problem carrying no advice still gets the check hint', async () => {
  // Đoán "gate có bắt buộc không" từ chuỗi trả lời sai câu hỏi. Thứ cần biết là
  // "problem này đã tự nói cách xử lý chưa" — và dòng "Spec đã thay đổi" thì
  // chưa, nên bỏ hint đi là bỏ luôn đường ra.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const rec = { gate: 'review', taskId: 'T-1', exitCode: 0, specHash: 'sha256:khac-hoan-toan' };
  data.review = { ...rec, sig: signRecord(rec, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Chạy: compass check/, 'problem không tự có lời khuyên thì phải còn hint');
});

test('CP-16-S3 a required gate is told to run check, not the gate command', async () => {
  // Nhánh `batBuoc = true` của `cachChayLai` chưa từng được canh: khuyên
  // `compass spec T-1` cho gate bắt buộc, và mách xoá bằng chứng, đều sai.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });
  writeFileSync(path.join(root, 'src-moi.mjs'), 'export const x = 1;\n');

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /Chạy lại: compass check T-1/, 'gate bắt buộc thì chạy check');
  assert.doesNotMatch(r.output, /xoá khoá "test"/, 'đừng mách xoá bằng chứng của gate bắt buộc');
});

test('CP-16-S4 a REQUIRED gate red in a repo slot still blocks done', async () => {
  // `test@be` rơi giữa hai vòng: vòng gate-bắt-buộc tra khoá trần `test`, vòng
  // gate-ngoài-danh-sách bỏ qua vì `test` nằm trong `required`. Không vòng nào
  // đọc `exitCode` của nó, và một gate BẮT BUỘC đỏ lọt thẳng qua cổng cuối.
  //
  // S1 không bắt được vì nó dùng `convention@be` — gate không bắt buộc với `fix`.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const rec = {
    gate: 'test', taskId: 'T-1', repo: 'be', exitCode: 1,
    sourceHash: data.test.sourceHash,
    configHash: data.test.configHash,
    specHash: data.test.specHash,
  };
  data['test@be'] = { ...rec, sig: signRecord(rec, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, 'gate bắt buộc đỏ ở repo vẫn là gate đỏ');
  assert.match(r.output, /test@be/);
  assert.doesNotMatch(r.output, /xoá khoá "test@be"/,
    'gate bắt buộc thì đừng mách xoá bằng chứng');
});

test('CP-16-E3 a null entry in the ledger is reported, not crashed on', async () => {
  // Ba vòng kiểm khác đều có chốt `if (!record)`; vòng CP-16 thêm vào thì thiếu,
  // nên một khoá `null` làm `done` ném TypeError thay vì báo sổ hỏng.
  const root = makeTask(GREEN);
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data['ui@fe'] = null;
  writeFileSync(file, JSON.stringify(data, null, 2));

  let r;
  assert.doesNotThrow(() => { r = doneCommand({ cwd: root, taskId: 'T-1' }); });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /sổ hỏng|không phải bản ghi/);
});
