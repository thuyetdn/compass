import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testCommand } from '../commands/test.mjs';
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

const SPEC_IDS_13 = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'V1', 'V2', 'V3', 'E1', 'EC1', 'EC2', 'S1'];
const LAYER_13 = ['Happy', 'Happy', 'Happy', 'Happy', 'Happy', 'Happy',
                  'Validation', 'Validation', 'Validation',
                  'Error', 'Edge', 'Edge', 'Security'];
const SPEC_13_HEAD = `# T-1: Tiêu đề
Loại: feature-s
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
`;

function makeTask(testCmd, specText = SPEC) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-testcmd-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'),
    JSON.stringify({ test: testCmd }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), specText);
  return root;
}

const printBoth = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\')"';
const printOne  = 'node -e "console.log(\'ok 1 - test_H1_a\')"';
const failing   = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\'); process.exit(1)"';

test('testCommand passes when the suite is green and every id ran', () => {
  const root = makeTask(printBoth);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('testCommand fails when the suite exits non-zero', () => {
  const root = makeTask(failing);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /exit code/i);
});

test('testCommand fails when a spec id never ran', () => {
  const root = makeTask(printOne);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /H2/);
});

test('testCommand names every missing id', () => {
  const root = makeTask('node -e "console.log(\'nothing here\')"');
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /H1/);
  assert.match(result.output, /H2/);
});

test('testCommand writes the full output to evidence', () => {
  const root = makeTask(printBoth);
  testCommand({ cwd: root, taskId: 'T-1' });
  const log = path.join(root, '.compass', 'T-1', 'evidence', 'test.log');
  assert.ok(existsSync(log));
  assert.match(readFileSync(log, 'utf8'), /test_H1_a/);
});

test('testCommand records the command and exit code in the gate', () => {
  const root = makeTask(printBoth);
  testCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'test');
  assert.equal(gate.exitCode, 0);
  assert.equal(gate.command, printBoth);
  assert.match(gate.outputHash, /^sha256:/);
});

test('testCommand records a configHash in the gate', () => {
  const root = makeTask(printBoth);
  testCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'test');
  assert.match(gate.configHash, /^sha256:/);
});

test('testCommand reports an invalid config', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-testcmd-bad-'));
  mkdirSync(path.join(root, '.compass', 'T-1'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{}');
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /config/);
});

test('testCommand: bare IDs on unclassified lines fail the gate and mention them', () => {
  const root = makeTask('node -e "console.log(\'H1 H2\')"');
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /không rõ định dạng/i);
  assert.match(result.output, /H1/);
  assert.match(result.output, /H2/);
});

test('testCommand: skipped test ID fails the gate, distinguished from missing', () => {
  const root = makeTask('node -e "console.log(\'ok 1 - test_H1_a # SKIP\\nok 2 - test_H2_b\')"');
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /không pass.*skip/i);
  assert.match(result.output, /H1/);
});

test('testCommand: when process is killed by signal, shows in gate', () => {
  // On Windows with shell: true, we cannot easily kill a process by signal,
  // so we test that the gate records the signal/failure fields when present
  const root = makeTask(printBoth);
  testCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'test');
  // Verify the gate has these fields even if null in normal runs
  assert.ok('signal' in gate);
  assert.ok('suiteFailure' in gate);
});

test('I2: testCommand fails and reports IDs sharing one pass line distinctly', () => {
  const root = makeTask('node -e "console.log(\'ok 1 - test covers H1 and H2 together\')"');
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /không tách được ai chạy ai|mỗi ca cần một test riêng/);
  assert.match(result.output, /H1/);
  assert.match(result.output, /H2/);
  const gate = readGate(root, 'T-1', 'test');
  assert.deepEqual(gate.seenOnSharedLines.sort(), ['H1', 'H2']);
});

test('testCommand: retried-then-passed ID not reported as failed', () => {
  // Spec declares H1 and H2; first test fails then passes; second never written
  const retryOutput = 'node -e "console.log(\'not ok 1 - test_H1_a\\nok 2 - test_H1_a\\nok 3 - nothing\')"';
  const root = makeTask(retryOutput);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  // H1 should NOT appear in the failure message at all (it did pass eventually)
  assert.match(result.output, /H2/);
  assert.ok(!result.output.includes('H1'), 'H1 should not appear in output since it passed');
});

test('CP-2-H3 a green suite matching no ID at all points at the reporter', () => {
  // Vitest's default reporter prints file names only, never test names — the
  // suite passes yet no spec ID is anywhere in the output.
  const fileNamesOnly = 'node -e "console.log(\'ok 1 - test/App.test.jsx\')"';
  const root = makeTask(fileNamesOnly);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /reporter/i);
});

test('CP-2-E1 a red suite matching no ID stays quiet about the reporter', () => {
  const redAndSilent = 'node -e "console.log(\'ok 1 - test/App.test.jsx\'); process.exit(1)"';
  const root = makeTask(redAndSilent);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.ok(!/reporter/i.test(result.output), 'suite lỗi thì nguyên nhân không phải reporter');
});

test('CP-2-EC1 a green suite matching most IDs stays quiet about the reporter', () => {
  // 1 of 2 named — the reporter clearly prints test names, so a missing ID is
  // a missing test, not a formatting problem.
  const root = makeTask(printOne);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.ok(!/reporter/i.test(result.output), 'reporter in được tên test thì nó không phải nguyên nhân');
});

test('CP-2-EC3 a green suite matching one ID in thirteen still points at the reporter', () => {
  // Vitest names only its slow tests, so a 13-case spec can match exactly one.
  const rows = SPEC_IDS_13.map((id, i) => `| ${id} | ${LAYER_13[i]} | Case ${i + 1} | Đúng | P0 |`);
  const spec = SPEC_13_HEAD + rows.join('\n') + '\n';
  const onlyOneNamed = 'node -e "console.log(\'ok 1 - test/App.test.jsx (13 tests)\'); console.log(\'  ✓ H6 lowers the count\')"';

  const root = mkdtempSync(path.join(tmpdir(), 'compass-testcmd-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: onlyOneNamed }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), spec);

  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /reporter/i);
});

// CP-15: một ID khớp nhiều test khác nhau nghĩa là ít nhất một cái thuộc task khác.
// Gate phải nói ra, chứ không tính là đã chạy.

const collideOnH1 = 'node -e "console.log(\'ok 1 - H1 chuyện của task khác\'); console.log(\'ok 2 - H1 chuyện của task khác nữa\'); console.log(\'ok 3 - H2 case hai\')"';

test('CP-15-EC1 a green suite where an ID matches two different tests fails the gate', () => {
  const root = makeTask(collideOnH1);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, 'suite xanh nhưng ID đụng độ thì gate phải đỏ');
  assert.match(result.output, /H1/);
});

test('CP-15-H3 the message names the tests that collided', () => {
  const root = makeTask(collideOnH1);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /chuyện của task khác/);
  assert.match(result.output, /chuyện của task khác nữa/);
});

test('CP-15-H6 the gate record keeps the colliding ids', () => {
  const root = makeTask(collideOnH1);
  testCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'test');
  assert.deepEqual(gate.collidedIds, ['H1']);
});

test('CP-15-H8 a colliding ID is not also reported as never seen', () => {
  const root = makeTask(collideOnH1);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  const neverSeen = result.output.split('\n').find((l) => l.includes('Không tìm thấy dấu vết'));
  assert.ok(!neverSeen || !neverSeen.includes('H1'), 'H1 đã lộ diện, chỉ là không rõ của ai');
});

test('CP-15-E2 a red suite with a collision reports both', () => {
  const redAndColliding = 'node -e "console.log(\'ok 1 - H1 một\'); console.log(\'ok 2 - H1 hai\'); process.exit(1)"';
  const root = makeTask(redAndColliding);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /exit code 1/);
  assert.match(result.output, /H1/);
});

test('CP-15-H9 naming a test with the task id resolves the collision', () => {
  // H2 cũng mang tiền tố: từ CP-63, task đã đặt tên kèm task id thì test tên
  // trần `H2 case hai` không còn được tính cho nó. Case này đo đường thoát của H1.
  const escaped = 'node -e "console.log(\'ok 1 - H1 chuyện của task khác\'); console.log(\'ok 2 - T-1-H1 case một\'); console.log(\'ok 3 - T-1-H2 case hai\')"';
  const root = makeTask(escaped);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

// CP-20 — việc kiểm bằng mắt. Ép bịa test case chỉ tạo chỗ cho lỗ INV-2 phát
// tác: ID bịa ra khớp test của task khác, gate báo xanh cho việc chưa ai kiểm.

const SPEC_MAT = SPEC.replace('Phạm vi: src/', 'Phạm vi: docs/\nKiểm bằng: mắt');

test('CP-20-H1 a spec verified by eye passes and says the machine measured nothing', () => {
  const root = makeTask(printBoth, SPEC_MAT);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /kiểm tra bằng mắt/);
  assert.match(result.output, /không đo/, 'phải nói thẳng nó không đo được gì');
});

test('CP-20-H2 the gate record keeps the declaration', () => {
  const root = makeTask(printBoth, SPEC_MAT);
  testCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'test');
  assert.equal(gate.verifyBy, 'mắt', '`done` và `status` phải đọc lại được');
  assert.equal(gate.ranIdCount, 0, 'không ca nào chạy bằng máy');
});

test('CP-20-V1 an empty case table is refused even when verified by eye', () => {
  // Khai kiểm bằng mắt không phải là được miễn liệt kê. Không có bảng thì
  // không ai biết phải đi qua những gì.
  const rong = SPEC_MAT.replace(/\| H1 \|.*\n/, '').replace(/\| H2 \|.*\n/, '');
  const root = makeTask(printBoth, rong);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /liệt kê/);
});

test('CP-20-V2 declaring eye-verification while owning real tests is a contradiction', () => {
  // Có test mang ID của task này thì lời khai sai. Đừng đoán bên nào đúng.
  const coTest = 'node -e "console.log(\'ok 1 - T-1-H1 test thật\')"';
  const root = makeTask(coTest, SPEC_MAT);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /H1/);
  assert.match(result.output, /Bỏ dòng/, 'phải nói cách gỡ mâu thuẫn');
});

test('CP-20-E1 an unknown verification value names the valid ones', () => {
  const la = SPEC.replace('Phạm vi: src/', 'Phạm vi: docs/\nKiểm bằng: bói toán');
  const root = makeTask(printBoth, la);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /mắt/, 'phải nêu giá trị hợp lệ');
});

test('CP-20-EC1 a task id holding regex characters is matched literally', () => {
  // `validateTaskId` không chặn `.` hay `+`. Ghép thẳng vào mẫu thì `v1.0+x`
  // khớp nhầm những tên nó không nên khớp.
  const spec = SPEC_MAT.replace('# T-1:', '# v1.0+x:');
  const root = mkdtempSync(path.join(tmpdir(), 'compass-esc-'));
  mkdirSync(path.join(root, '.compass', 'v1.0+x', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'),
    JSON.stringify({ test: 'node -e "console.log(\'ok 1 - v1x0Xx-H1 tên khớp nhầm\')"' }));
  writeFileSync(path.join(root, '.compass', 'v1.0+x', 'spec.md'), spec);

  // `v1x0Xx-H1` chỉ khớp nếu `.` và `+` được coi là ký tự bất kỳ.
  const result = testCommand({ cwd: root, taskId: 'v1.0+x' });
  assert.equal(result.exitCode, 0, result.output);
  assert.doesNotMatch(result.output, /mâu thuẫn|có test mang ID/,
    'tên khác không được tính là test của task này');
});

test('CP-15-EC43 an ID owned by other tasks does not trigger the reporter hint', () => {
  // `seenAnywhere = 0` bật gợi ý "reporter không in tên test" — trong khi
  // reporter vừa in ra hai dòng mang đúng chữ H1. Người dùng đi sửa cấu hình
  // đang chạy đúng.
  const khacChu = 'node -e "console.log(\'ok 1 - CP-16-H1 x\'); console.log(\'ok 2 - CP-17-H2 y\')"';
  const root = makeTask(khacChu);
  // Hai task kia phải tồn tại thật — parser đối chiếu danh sách, không đoán từ
  // hình dạng chuỗi.
  for (const t of ['CP-16', 'CP-17']) mkdirSync(path.join(root, '.compass', t), { recursive: true });

  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, 'task này chưa viết test — vẫn phải đỏ');
  assert.doesNotMatch(result.output, /reporter/i, 'reporter đang in tên test hoàn hảo');
  assert.match(result.output, /task khác/, 'phải nói rõ test đó của ai');
  assert.doesNotMatch(result.output, /Không tìm thấy dấu vết/,
    'có dấu vết — chỉ là dấu vết của task khác');
});

// CP-39 — gate messages say "case" and "kiểm tra"; the spec keyword has a
// full-word form `Kiểm tra bằng:` that the gate treats exactly like the old one.

const SPEC_MAT_MOI = SPEC.replace('Phạm vi: src/', 'Phạm vi: docs/\nKiểm tra bằng: mắt');

test('CP-39-H10 the visual-only pass line counts cases with the word "case"', () => {
  const ba = SPEC_MAT_MOI.replace('| H2 | Happy | Case hai | Đúng | P0 |',
    '| H2 | Happy | Case hai | Đúng | P0 |\n| H3 | Happy | Case ba | Đúng | P0 |');
  const root = makeTask(printBoth, ba);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /3 case kiểm tra bằng mắt/);
});

test('CP-39-V1 an unknown value in the new form is refused and quoted as written', () => {
  const la = SPEC.replace('Phạm vi: src/', 'Phạm vi: docs/\nKiểm tra bằng: bói toán');
  const root = makeTask(printBoth, la);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /"Kiểm tra bằng: bói toán" không hợp lệ/);
  assert.match(result.output, /mắt/, 'phải nêu giá trị hợp lệ');
});

test('CP-39-V4 an empty case table under the new form still demands every case and its check', () => {
  const rong = SPEC_MAT_MOI.replace(/\| H1 \|.*\n/, '').replace(/\| H2 \|.*\n/, '');
  const root = makeTask(printBoth, rong);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /liệt kê từng case và cách kiểm tra/);
});

test('CP-39-E1 owning real tests under `Kiểm tra bằng:` is a contradiction quoting that line', () => {
  const coTest = 'node -e "console.log(\'ok 1 - T-1-H1 test thật\')"';
  const root = makeTask(coTest, SPEC_MAT_MOI);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Spec khai kiểm tra bằng mắt/);
  assert.match(result.output, /Bỏ dòng "Kiểm tra bằng:"/);
});

// CP-54 — gate trích đúng từ khóa spec đã viết. Spec viết `Kiểm bằng:` mà gate
// bảo bỏ dòng `Kiểm tra bằng:` thì người đọc tìm trong spec không thấy dòng nào.

const SPEC_BOI = SPEC.replace('Phạm vi: src/', 'Phạm vi: docs/\nKiểm bằng: bói toán');
const coTestCuaMinh = 'node -e "console.log(\'ok 1 - T-1-H1 test thật\')"';

test('CP-54-H1 an unknown value in the old form is quoted with the old keyword', () => {
  const root = makeTask(printBoth, SPEC_BOI);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /"Kiểm bằng: bói toán" không hợp lệ/);
  assert.doesNotMatch(result.output, /Kiểm tra bằng/, 'spec không có dòng nào viết như vậy');
});

test('CP-54-H2 an unknown value in the new form is still quoted with the new keyword', () => {
  const la = SPEC.replace('Phạm vi: src/', 'Phạm vi: docs/\nKiểm tra bằng: bói toán');
  const root = makeTask(printBoth, la);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /"Kiểm tra bằng: bói toán" không hợp lệ/);
});

test('CP-54-H3 the old form in the contradiction path is told to drop `Kiểm bằng:`', async (t) => {
  // H3 chính là CP-39-E2, sửa lại — assertion cũ của nó khóa đúng lỗi này. Nó
  // giữ tên cũ để gate của CP-39 vẫn thấy case E2 của mình.
  await t.test('CP-39-E2 the old form in the same situation gets the same exit code and message shape', () => {
    const root = makeTask(coTestCuaMinh, SPEC_MAT);
    const result = testCommand({ cwd: root, taskId: 'T-1' });
    assert.equal(result.exitCode, 2);
    assert.match(result.output, /Spec khai kiểm tra bằng mắt/);
    assert.match(result.output, /Bỏ dòng "Kiểm bằng:"/);
    assert.doesNotMatch(result.output, /Bỏ dòng "Kiểm tra bằng:"/);
  });
});

test('CP-54-H4 the new form in the contradiction path is still told to drop `Kiểm tra bằng:`', () => {
  const root = makeTask(coTestCuaMinh, SPEC_MAT_MOI);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Bỏ dòng "Kiểm tra bằng:"/);
});

test('CP-54-E1 a valid old-form declaration keeps its prose and its gate record shape', () => {
  const root = makeTask(printBoth, SPEC_MAT);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /2 case kiểm tra bằng mắt/, 'dòng pass là lời kể, không phải trích dòng');
  const gate = readGate(root, 'T-1', 'test');
  assert.equal(gate.verifyBy, 'mắt');
  assert.equal('verifyByKeyword' in gate, false, 'từ khóa chỉ định hình lời nhắn, không phải bằng chứng');
});

test('CP-54-E2 an unknown old-form value still lists the valid ones and writes no record', () => {
  const root = makeTask(printBoth, SPEC_BOI);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /Giá trị nhận: mắt, người, eye, manual\./);
  assert.equal(readGate(root, 'T-1', 'test'), null);
});

test('CP-54-EC2 an empty old-form line before a filled new-form line quotes the new keyword', () => {
  const la = SPEC.replace('Phạm vi: src/', 'Phạm vi: docs/\nKiểm bằng:\nKiểm tra bằng: bói toán');
  const root = makeTask(printBoth, la);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /"Kiểm tra bằng: bói toán" không hợp lệ/);
});

test('CP-54-EC3 a CRLF spec in the old form is quoted without a carriage return', () => {
  const root = makeTask(printBoth, SPEC_BOI.replace(/\n/g, '\r\n'));
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /"Kiểm bằng: bói toán" không hợp lệ/);
  assert.doesNotMatch(result.output, /\r/);
});
