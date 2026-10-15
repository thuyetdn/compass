import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRanIds, compareWithSpec } from '../lib/test-parser.mjs';

const TAP_OUTPUT = `
TAP version 13
ok 1 - test_H1_filters by a single country
ok 2 - test_H2_filters by multiple countries
not ok 3 - test_V1_rejects an unknown country code
1..3
`;

test('extractRanIds finds ids on pass lines only', () => {
  const result = extractRanIds(TAP_OUTPUT, ['H1', 'H2', 'V1', 'V2']);
  assert.deepEqual(result.ran.sort(), ['H1', 'H2']);
  assert.deepEqual(result.seenOnNonPassLines, ['V1']);
});

test('extractRanIds omits ids that never appear', () => {
  const result = extractRanIds(TAP_OUTPUT, ['H1', 'S1']);
  assert.ok(!result.ran.includes('S1'));
  assert.ok(!result.seenOnNonPassLines.includes('S1'));
  assert.ok(!result.seenOnUnknownLines.includes('S1'));
});

test('extractRanIds respects word boundaries', () => {
  const output = 'ok 1 - test_H10_something';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, []);
});

test('two different tests claiming one ID is a collision, not one id counted once', () => {
  // This used to assert `ran: ['H1']` — the behaviour that let a doc-only task
  // pass 7/7 with no tests of its own. `test_H1_a` and `test_H1_b` are two
  // tests, and a task declares one per ID.
  const output = 'ok 1 - test_H1_a\nok 2 - test_H1_b';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.collided, ['H1']);
});

test('extractRanIds: TAP ok line counts as ran', () => {
  const output = 'ok 1 - test_H1_a\nok 2 - test_H2_b';
  const result = extractRanIds(output, ['H1', 'H2']);
  assert.deepEqual(result.ran, ['H1', 'H2']);
  assert.deepEqual(result.seenOnNonPassLines, []);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: not ok line does NOT count as ran', () => {
  const output = 'not ok 2 - test_H2_b';
  const result = extractRanIds(output, ['H2']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, ['H2']);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: line with SKIP does NOT count as ran', () => {
  const output = 'ok 1 - test_H1_a # SKIP';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, ['H1']);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: ID in error message does NOT count as ran', () => {
  const output = 'Error in spec H2: cannot read file';
  const result = extractRanIds(output, ['H2']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, ['H2']);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: bare ID on unknown line does NOT count as ran', () => {
  const output = 'H1 H2';
  const result = extractRanIds(output, ['H1', 'H2']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, []);
  assert.deepEqual(result.seenOnUnknownLines, ['H1', 'H2']);
});

test('extractRanIds: checkmark marker counts as pass', () => {
  const output = '✔ test_H1_a\n✓ test_H2_b';
  const result = extractRanIds(output, ['H1', 'H2']);
  assert.deepEqual(result.ran, ['H1', 'H2']);
  assert.deepEqual(result.seenOnNonPassLines, []);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: ID on both pass and fail counts as ran only', () => {
  const output = 'not ok 1 - test_H1_a (first attempt)\nok 1 - test_H1_a (retry)';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, ['H1']);
  assert.deepEqual(result.seenOnNonPassLines, []);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: ID on fail then pass is removed from seenOnNonPassLines', () => {
  const output = 'not ok 1 - test_H1_a\nok 2 - test_H1_a';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, ['H1']);
  assert.deepEqual(result.seenOnNonPassLines, []);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: ID on unknown then pass is removed from seenOnUnknownLines', () => {
  const output = 'H1 mentioned\nok 1 - test_H1_a';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, ['H1']);
  assert.deepEqual(result.seenOnNonPassLines, []);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: ID on fail line only stays in seenOnNonPassLines', () => {
  const output = 'not ok 1 - test_H1_a';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, ['H1']);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('compareWithSpec reports ids the run never covered', () => {
  const result = compareWithSpec(['H1', 'H2', 'V1'], ['H1', 'H2']);
  assert.deepEqual(result.missing, ['V1']);
  assert.equal(result.ok, false);
});

test('compareWithSpec reports ids not declared in the spec', () => {
  const result = compareWithSpec(['H1'], ['H1', 'Z9']);
  assert.deepEqual(result.extra, ['Z9']);
});

test('compareWithSpec passes when every spec id ran', () => {
  const result = compareWithSpec(['H1', 'H2'], ['H1', 'H2']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('compareWithSpec tolerates extra ids as long as none are missing', () => {
  const result = compareWithSpec(['H1'], ['H1', 'H2']);
  assert.equal(result.ok, true);
});

// I2 — a single pass line naming multiple spec IDs must not count as any of them ran.
test('extractRanIds: a pass line naming two spec IDs counts neither as ran', () => {
  const output = 'ok 1 - test covers H1 and H2 together';
  const result = extractRanIds(output, ['H1', 'H2']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnSharedLines.sort(), ['H1', 'H2']);
});

test('extractRanIds: an ID that passes alone elsewhere is not treated as shared', () => {
  const output = 'ok 1 - test covers H1 and H2 together\nok 2 - test_H1_dedicated';
  const result = extractRanIds(output, ['H1', 'H2']);
  // H1 passed on its own dedicated line too, so it should count as ran and drop out of shared.
  assert.deepEqual(result.ran, ['H1']);
  assert.deepEqual(result.seenOnSharedLines, ['H2']);
});

test('extractRanIds: a shared pass line does not affect an unrelated single-ID pass line', () => {
  const output = 'ok 1 - test_V1_alone\nok 2 - test covers H1 and H2 together';
  const result = extractRanIds(output, ['V1', 'H1', 'H2']);
  assert.deepEqual(result.ran, ['V1']);
  assert.deepEqual(result.seenOnSharedLines.sort(), ['H1', 'H2']);
});

const ESC = '\u001b';

test('CP-2-H4 a pass line wrapped in ANSI colour still counts as ran', () => {
  // Vitest prints slow tests as: <dim green ✓> H5 shows ... <reset> 308ms
  const line = ` ${ESC}[33m${ESC}[2m✓${ESC}[22m${ESC}[39m H5 shows the remaining count ${ESC}[33m308ms${ESC}[39m`;
  const result = extractRanIds(line, ['H5']);
  assert.deepEqual(result.ran, ['H5']);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('CP-2-E2 a fail line wrapped in ANSI colour is not counted as ran', () => {
  const line = ` ${ESC}[31m×${ESC}[39m V1 rejects an empty submission`;
  const result = extractRanIds(line, ['V1']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, ['V1']);
});

test('CP-2-EC2 ANSI between the pass mark and the ID still counts as ran', () => {
  const line = `${ESC}[32mok 1${ESC}[39m - ${ESC}[1mH1${ESC}[22m adds a todo`;
  const result = extractRanIds(line, ['H1']);
  assert.deepEqual(result.ran, ['H1']);
});

test('CP-15-H2 an ID matching two passing lines is a collision, not a pass', () => {
  // Every spec uses H1, V1, EC1, so one task's tests satisfy another's gate.
  // A task has exactly one test per ID; two matches means they are not its own.
  const output = [
    'ok 1 - H1 a component and its props are extracted',
    'ok 2 - H1 a config with no repos yields one repo',
  ].join('\n');

  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, [], 'không được tính là đã chạy');
  assert.deepEqual(result.collided, ['H1']);
});

test('CP-15-H4 every colliding ID is reported, not just the first', () => {
  const output = [
    'ok 1 - H1 chuyện này',
    'ok 2 - H1 chuyện khác',
    'ok 3 - V1 việc này',
    'ok 4 - V1 việc khác',
  ].join('\n');

  const result = extractRanIds(output, ['H1', 'V1']);
  assert.deepEqual(result.collided.sort(), ['H1', 'V1']);
});

test('CP-15-H1 one line per ID stays a clean pass', () => {
  const output = 'ok 1 - H1 a\nok 2 - H2 b';
  const result = extractRanIds(output, ['H1', 'H2']);
  assert.deepEqual(result.ran.sort(), ['H1', 'H2']);
  assert.deepEqual(result.collided, []);
});

test('CP-15-V1 a retry — one fail then one pass — is not a collision', () => {
  const output = 'not ok 1 - H1 a\nok 2 - H1 a';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, ['H1'], 'chạy lại rồi pass vẫn là một test');
  assert.deepEqual(result.collided, []);
});

test('CP-15-EC2 the identical line printed twice counts once', () => {
  const output = 'ok 1 - H1 a\nok 1 - H1 a';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, ['H1']);
  assert.deepEqual(result.collided, []);
});

test('CP-15-EC3 a short ID does not match a longer one', () => {
  // Khai cả hai ID, nếu không thì H10 chỉ là chữ trong câu và test này chỉ kiểm
  // lại chuyện có sẵn từ trước, không chạm nhánh đụng độ.
  const output = 'ok 1 - H10 something\nok 2 - H1 the real one';
  const result = extractRanIds(output, ['H1', 'H10']);
  assert.deepEqual(result.ran.sort(), ['H1', 'H10']);
  assert.deepEqual(result.collided, [], 'H1 và H10 là hai ID khác nhau, không phải đụng độ');
});

test('CP-15-H5 nothing colliding means an empty list, not undefined', () => {
  const result = extractRanIds('ok 1 - H1 a', ['H1']);
  assert.deepEqual(result.collided, []);
});

test('CP-15-H7 a test named with the task id wins over unrelated collisions', () => {
  // The way out for a project already running: name the test after the task
  // and the gate can tell it apart, without renaming 228 existing tests.
  const output = [
    'ok 1 - H1 a component and its props',
    'ok 2 - H1 a config with no repos',
    'ok 3 - CP-15-H1 phát hiện đụng độ',
  ].join('\n');

  const result = extractRanIds(output, ['H1'], { taskId: 'CP-15' });
  assert.deepEqual(result.ran, ['H1']);
  assert.deepEqual(result.collided, []);
});

test('CP-15-EC4 two tests both carrying the task id is still a collision', () => {
  // The task named two of its own tests the same. Nobody else to blame.
  const output = 'ok 1 - CP-15-H1 chuyện này\nok 2 - CP-15-H1 chuyện khác';
  const result = extractRanIds(output, ['H1'], { taskId: 'CP-15' });
  assert.deepEqual(result.collided, ['H1']);
});

test('CP-15-EC5 the task id sharing a line with the ID does not claim it', () => {
  // Rủi ro thật không phải dòng rời — dòng rời chẳng bao giờ vào sổ. Rủi ro là
  // task id đứng cùng dòng với ID mà không phải tên test: đường dẫn evidence in
  // trong output cũng đủ trao quyền sở hữu nếu chỉ hỏi "có mặt trên dòng không".
  const output = [
    'ok 1 - H1 chuyện này',
    'ok 2 - H1 chuyện khác, log ở .compass/CP-15/evidence/test.log',
  ].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'CP-15' });
  assert.deepEqual(result.collided, ['H1'], 'task id trong đường dẫn không phải tên test');
});

test('CP-15-EC6 a task id that is a prefix of another does not claim its tests', () => {
  // CP-1 là chuỗi con của CP-15. So bằng includes thì CP-1 nhận vơ mọi test tên
  // CP-15-* làm của mình — đúng con bug task này sinh ra để giết.
  const output = ['ok 1 - CP-15-H1 test của CP-15', 'ok 2 - H1 test của task khác'].join('\n');
  assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'CP-1' }).collided, ['H1'],
    'CP-1 chưa viết test nào cho H1');
  assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'CP-15' }).collided, [],
    'CP-15 thì có');
});

test('CP-15-EC7 two lines differing only in a number are a collision', () => {
  // Có thể là một test retry in kèm thời gian, có thể là hai test tên `5ms` và
  // `30ms`. Từ dòng text không phân biệt nổi, nên báo lên thay vì đoán — sai mà
  // kêu, kèm đường thoát, thì hơn sai mà im.
  const output = ['✔ H1 cùng một test (1.234ms)', '✔ H1 cùng một test (5.678ms)'].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, ['H1']);
  assert.deepEqual(result.ran, []);
});

test('CP-15-EC13 identical lines stay one test even with a task id in play', () => {
  // EC2 kiểm ca không có taskId. Ca này kiểm nhánh có — đường thoát không được
  // biến một test lặp lại thành hai.
  const output = ['✔ H1 cùng một dòng (1.2ms)', '✔ H1 cùng một dòng (1.2ms)'].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, []);
  assert.deepEqual(result.ran, ['H1']);
});

test('CP-15-EC8 a duration inside the test name is part of the name', () => {
  // Tên test có số đo là chuyện thường ngày. Cắt từ `5ms` trở đi thì hai test
  // khác nhau hợp thành một, và đụng độ thật lọt lưới.
  const output = ['ok 1 - H1 rejects 5ms delay', 'ok 2 - H1 rejects 5ms burst'].join('\n');
  assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'T-1' }).collided, ['H1']);
});

test('passing no taskId keeps the old behaviour', () => {
  const output = 'ok 1 - H1 a\nok 2 - H1 b';
  assert.deepEqual(extractRanIds(output, ['H1']).collided, ['H1']);
});

test('CP-15-V2 an ID seen only on an unrecognised line keeps the old behaviour', () => {
  const output = 'H1 chạy đâu đó, không theo định dạng nào\nok 1 - H2 case hai';
  const result = extractRanIds(output, ['H1', 'H2'], { taskId: 'T-1' });
  assert.deepEqual(result.ran, ['H2']);
  assert.deepEqual(result.collided, []);
  assert.deepEqual(result.seenOnUnknownLines, ['H1']);
});

test('CP-15-V3 a spec with no test cases produces nothing to collide', () => {
  const result = extractRanIds('ok 1 - H1 gì đó', [], { taskId: 'T-1' });
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.collided, []);
  assert.deepEqual(result.collisions, {});
});

test('CP-15-E1 empty output does not crash and finds no collision', () => {
  const result = extractRanIds('', ['H1', 'H2'], { taskId: 'T-1' });
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.collided, []);
});

test('CP-15-EC9 output using CRLF gives the same result as LF', () => {
  // Chỉ ba regex thật sự vỡ vì ký tự CR sót lại: TAP_COMMENT, TAP_CONTAINER,
  // TAP_SUBTEST — cả ba neo cuối dòng. Fixture không chạm cái nào thì test xanh
  // kể cả khi split hỏng, và đó là điều đã xảy ra hai lần với ca này.
  //
  // Nên dựng fixture chạm đủ ba.
  const CRLF = '\r\n';

  // TAP_COMMENT: hai lần chạy cùng một test, khác mỗi `# time=`. Không bóc được
  // chú thích thì thành hai tên khác nhau và retry bị báo đụng độ oan.
  const retry = ['ok 1 - H1 same test # time=1.62ms', 'ok 2 - H1 same test # time=9.87ms'];
  assert.deepEqual(extractRanIds(retry.join(CRLF) + CRLF, ['H1'], { taskId: 'T-1' }).collided, [],
    'retry trên Windows vẫn là một test');

  // TAP_CONTAINER: dòng mở khối Vitest. Không nhận ra thì nó bị tính thành test.
  const vitest = ['ok 1 - t/H1.test.js # time=3.1ms {', '    ok 1 - H1 covers # time=1.6ms', '}'];
  const r = extractRanIds(vitest.join(CRLF) + CRLF, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(r.collided, [], 'container không phải test');
  assert.deepEqual(r.ran, ['H1']);

  // TAP_SUBTEST: hai suite cùng tên test. Không đọc được thì gộp làm một.
  const tap = ['# Subtest: E1 cùng tên', 'ok 1 - E1 cùng tên', '# Subtest: E1 cùng tên', 'ok 2 - E1 cùng tên'];
  assert.deepEqual(extractRanIds(tap.join(CRLF) + CRLF, ['E1'], { taskId: 'T-1' }).collided, ['E1'],
    'hai khối lề 0 là hai test');
});


test('CP-15-EC10 the task id elsewhere on the line does not claim the ID', () => {
  // Nhắc tên task trong tên test là chuyện thường. Nó không phải lời khai
  // "test này của CP-15" — task id phải đứng ngay trước ID mới tính.
  for (const đuôi of ['wrote CP-15.log', 'related to CP-15 ticket', 'per CP-15_notes']) {
    const output = ['ok 1 - H1 chuyện của task khác', `ok 2 - H1 ${đuôi}`].join('\n');
    assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'CP-15' }).collided, ['H1'],
      `"${đuôi}" không phải lời khai sở hữu`);
  }
});

test('CP-15-EC11 a duration ending the test name is part of the name', () => {
  // Số đo dính liền một từ thuộc về tên tác giả đặt. Gộp hai test này lại thì
  // đụng độ thật lọt lưới — đúng thứ task này đi chặn.
  const cặp = [
    ['H1 times out after 5ms', 'H1 times out after 30ms'],
    ['H1 accepts 5s', 'H1 accepts 10s'],
  ];
  for (const [a, b] of cặp) {
    const output = [`ok 1 - ${a}`, `ok 2 - ${b}`].join('\n');
    assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'T-1' }).collided, ['H1'],
      `"${a}" và "${b}" là hai test khác nhau`);
  }
});

test('CP-15-EC12 the escape hatch accepts the ways people actually write it', () => {
  // Ép một định dạng duy nhất chỉ khiến task làm đúng việc vẫn bị đỏ.
  for (const tên of ['CP-15-H1 của tôi', 'CP-15: H1 của tôi', '[CP-15] H1 của tôi',
                     'CP-15/H1 của tôi', 'CP-15 H1 của tôi', 'CP-15_H1 của tôi']) {
    const output = ['ok 1 - H1 của task khác', `ok 2 - ${tên}`].join('\n');
    assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'CP-15' }).collided, [],
      `"${tên}" phải được nhận là test của CP-15`);
  }
});

test('CP-15-EC14 an ID inside the parent suite name does not break the escape hatch', () => {
  // `describe('H1 handling')` là cách viết bình thường, và Vitest tap in
  // `file > suite > test`. Nếu chỉ đọc lần khớp ID đầu tiên thì tên suite cha
  // che mất tiền tố task id nằm sau nó.
  const output = [
    'ok 1 - H1 test của task khác',
    'ok 2 - H1 handling > CP-15-H1 test của tôi',
  ].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'CP-15' });
  assert.deepEqual(result.collided, [], 'tiền tố nằm sau tên suite cha vẫn là tiền tố');
  assert.deepEqual(result.ran, ['H1']);
});

test('CP-15-EC15 a path holding the task id at the start of the line claims nothing', () => {
  // `.compass/CP-15/H1` có đủ task id lẫn ID cạnh nhau và đứng ngay đầu dòng.
  // Nó vẫn là đường dẫn, không phải lời khai sở hữu.
  for (const dòng of ['.compass/CP-15/H1 fixture note', 'test/CP-15/H1.test.ts > chạy gì đó']) {
    const output = ['ok 1 - H1 test của task khác', `ok 2 - ${dòng}`].join('\n');
    assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'CP-15' }).collided, ['H1'],
      `"${dòng}" là đường dẫn`);
  }
});

test('CP-15-EC16 tests naming the ID at the end of the name still collide', () => {
  // `it('parses a config H1')` — ID ở cuối tên. Nếu chỉ giữ phần từ ID trở đi
  // thì mọi test rút về đúng chuỗi `H1`, và cơ chế phát hiện tắt ngấm.
  const output = ['ok 1 - parses a config H1', 'ok 2 - renders a button H1'].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, ['H1'], 'hai test khác nhau, dù ID đứng cuối');
  assert.deepEqual(result.ran, []);
});

test('CP-15-EC17 a colliding ID is not also filed under the other buckets', () => {
  // Đụng độ và "xuất hiện trên dòng không rõ định dạng" là hai câu chọi nhau về
  // cùng một ID. Chỉ được báo một.
  const output = ['H1 nhắc ở đâu đó', 'ok 1 - H1 test một', 'ok 2 - H1 test hai'].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, ['H1']);
  assert.deepEqual(result.seenOnUnknownLines, [], 'đã báo đụng độ thì thôi báo tiếp');
});

test('CP-15-EC18 a longer ID does not answer for the escape hatch of a shorter one', () => {
  // `CP-15-H10` mang tiền tố task id và bắt đầu bằng chữ `H1`. Nó là test của
  // H10, không phải của H1 — nên H1 vẫn không được tính, và H10 vẫn được tính.
  //
  // Từ CP-63, `CP-15-H10` cho biết task này đặt tên kèm task id, nên hai dòng
  // `H1` trần vào nhóm "test tên trần không được tính" chứ không vào nhóm đụng độ.
  const output = [
    'ok 1 - H1 test của task khác',
    'ok 2 - H1 test của task khác nữa',
    'ok 3 - CP-15-H10 test của ID khác',
  ].join('\n');
  const result = extractRanIds(output, ['H1', 'H10'], { taskId: 'CP-15' });
  assert.ok(!result.ran.includes('H1'), 'CP-15-H10 không phải test của H1');
  assert.deepEqual(result.seenOnBareLines, ['H1']);
  assert.deepEqual(result.ran, ['H10']);
});

test('CP-15-EC19 the task id must sit next to the ID, not merely near it', () => {
  // Dấu nối phải ngắn. Nới ra thì cả một cụm dấu lọt vào giữa, và `CP-15` nhắc
  // ở đầu tên bỗng nhận vơ ID đứng cách đó một quãng.
  const output = [
    'ok 1 - H1 test của task khác',
    'ok 2 - CP-15 ... --- ... H1 test này',
  ].join('\n');
  assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'CP-15' }).collided, ['H1'],
    'giữa task id và ID chỉ được có một dấu nối, không phải cả một quãng');
});

test('CP-15-EC20 the reporter numbering is not part of the test name', () => {
  // `ok 1 -` và `ok 2 -` trước cùng một tên là một test chạy hai lần. Không bóc
  // tiền tố thì hai dòng khác nhau ở con số, và retry bị báo đụng độ.
  const output = ['ok 1 - H1 cùng một test', 'ok 2 - H1 cùng một test'].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, [], 'số thứ tự là của reporter, không phải của tên');
  assert.deepEqual(result.ran, ['H1']);
});

test('CP-15-EC21 mentioning the task id mid-sentence is not a claim of ownership', () => {
  // `:`, `|`, dấu gạch nằm giữa câu văn bình thường. Nhận task id sau chúng thì
  // một lời nhắc tới task khác đủ để nhận vơ — lỗ INV-2 mở lại.
  for (const đuôi of [
    'H1 warns: CP-15-H1 was renamed',
    'H1 x | CP-15-H1 | passed',
    'H1 x - CP-15-H1 is documented elsewhere',
  ]) {
    const output = ['ok 1 - H1 test của task khác', `ok 2 - ${đuôi}`].join('\n');
    assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'CP-15' }).collided, ['H1'],
      `"${đuôi}" là lời nhắc, không phải lời khai`);
  }
});

test('CP-15-EC22 two same-named tests in different TAP suites still collide', () => {
  // `node --test --test-reporter=tap` không in tên suite cha trên cùng dòng — nó
  // thụt lề, và đặt tên suite ở dòng `# Subtest:` phía trên. Không đọc dòng đó
  // thì hai test khác suite in ra hai dòng y hệt và đụng độ biến mất.
  const output = [
    'TAP version 13',
    '# Subtest: group one',
    '    # Subtest: H1 nested test',
    '    ok 1 - H1 nested test',
    'ok 1 - group one',
    '# Subtest: group two',
    '    # Subtest: H1 nested test',
    '    ok 1 - H1 nested test',
    'ok 2 - group two',
  ].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, ['H1'], 'hai suite khác nhau là hai test khác nhau');
});

test('CP-15-EC23 the same test in one TAP suite is not a collision', () => {
  // Mặt còn lại của EC22: một suite, một test — ghép tên suite vào không được
  // biến nó thành hai.
  const output = [
    'TAP version 13',
    '# Subtest: group one',
    '    # Subtest: H1 nested test',
    '    ok 1 - H1 nested test',
    'ok 1 - group one',
  ].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, []);
  assert.deepEqual(result.ran, ['H1']);
});

test('CP-15-EC24 two same-named top-level tests in different files collide', () => {
  // TAP không in tên file. Hai test cùng tên ở hai file cho hai khối `# Subtest:`
  // y hệt, và thứ duy nhất phân biệt là chúng nằm ở hai khối lề 0 khác nhau.
  // Chính suite này có bốn cặp như vậy — `E1 a project without playwright…` ở
  // browser.test.mjs và ui-command.test.mjs là một.
  const output = [
    'TAP version 13',
    '# Subtest: E1 cùng một tên',
    'ok 1 - E1 cùng một tên',
    '# Subtest: E1 cùng một tên',
    'ok 2 - E1 cùng một tên',
  ].join('\n');
  const result = extractRanIds(output, ['E1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, ['E1'], 'hai file là hai test');
  assert.deepEqual(result.ran, []);
});

test('CP-15-EC25 nested describes are told apart by their full path', () => {
  // Chỉ đọc `# Subtest:` ở lề 0 thì `outer > inner A > T2` và `outer > inner B > T2`
  // cùng rút về `outer > T2`, và hai test khác nhau gộp làm một.
  const output = [
    '# Subtest: outer',
    '    # Subtest: inner A',
    '        # Subtest: T2 cùng tên',
    '        ok 1 - T2 cùng tên',
    '    # Subtest: inner B',
    '        # Subtest: T2 cùng tên',
    '        ok 1 - T2 cùng tên',
  ].join('\n');
  assert.deepEqual(extractRanIds(output, ['T2'], { taskId: 'T-1' }).collided, ['T2'],
    'hai suite lồng khác nhau là hai test');
});

test('CP-15-EC26 a PASSED prefix is stripped whole, not down to its tail', () => {
  // JS không quay lui giữa các nhánh alternation: `PASS|PASSED` khớp `PASS` rồi
  // để lại `ED - ` dính đầu tên. Hậu quả thật không phải tên xấu — `ownsLine`
  // neo `^` không còn thấy task id ở đầu, và đường thoát chết hẳn.
  const output = ['PASSED - CP-15-H1 test của tôi', 'ok 2 - H1 test của task khác'].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'CP-15' });
  assert.deepEqual(result.collided, [], 'đường thoát phải sống với reporter in PASSED');
  assert.deepEqual(result.collisions, {});

  // Nhánh FAILED cũng phải bóc trọn, không để lại `ED - ` — kiểm bằng tên lưu.
  const failed = extractRanIds('FAILED - H2 một\nPASSED - H2 một\nPASSED - H2 hai',
    ['H2'], { taskId: 'T-1' });
  assert.deepEqual(failed.collisions.H2, ['H2 một', 'H2 hai'], 'tên không dính `ED - `');
});

test('CP-15-EC27 Jest verbose tells two same-named tests apart by their file', () => {
  // Jest không in `# Subtest:`. Nó báo ngữ cảnh bằng dòng `PASS <file>` ở lề 0.
  // Không đọc dòng đó thì cơ chế chỉ sống với `node --test`, dù README hứa cả ba.
  const output = [
    'PASS t/a.test.js',
    '  √ H1 adds a todo (1 ms)',
    'PASS t/b.test.js',
    '  √ H1 adds a todo (1 ms)',
  ].join('\n');
  assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'T-1' }).collided, ['H1'],
    'hai file là hai test');

  const one = ['PASS t/a.test.js', '  √ H1 adds a todo (1 ms)'].join('\n');
  assert.deepEqual(extractRanIds(one, ['H1'], { taskId: 'T-1' }).collided, [],
    'một file một test thì không đụng');
});

test('CP-15-EC28 a Vitest tap container line is a suite, not a test', () => {
  // Vitest tap lồng bằng ngoặc nhọn. Dòng mở khối là cái chứa — tên file, tên
  // `describe` — nên file tên `H1.test.js` chứa đúng một test cũng bị báo đụng
  // độ nếu tính nó thành một mục.
  const output = [
    'ok 1 - t/H1.test.js # time=3.14ms {',
    '    ok 1 - H1 handling # time=2.07ms {',
    '        ok 1 - H1 covers it # time=1.62ms',
    '    }',
    '}',
  ].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, [], 'ba dòng nhưng chỉ một test');
  assert.deepEqual(result.ran, ['H1']);
});

test('CP-15-EC29 a TAP trailing comment is not part of the test name', () => {
  // `# time=…` do máy in, con số đổi mỗi lần chạy. Bóc được an toàn vì có dấu
  // hiệu rõ ràng, khác hẳn việc đoán thời gian trong tên trần.
  const output = [
    'ok 1 - H1 cùng một test # time=1.62ms',
    'ok 2 - H1 cùng một test # time=9.87ms',
  ].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, [], 'khác nhau mỗi chú thích máy in thì vẫn là một test');
  assert.deepEqual(result.ran, ['H1']);
});

test('CP-15-EC30 a test name ending in a brace is still a test', () => {
  // Chỉ soi ký tự cuối thì `H1 parses a block {` bị coi là khối chứa của Vitest,
  // và nó không bao giờ vào sổ đụng độ. Dòng container thật có cả `# time=…`.
  const output = ['√ H1 parses a block {', '√ H1 other thing'].join('\n');
  assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'T-1' }).collided, ['H1']);

  const alone = extractRanIds('ok 1 - H1 parses a block {', ['H1'], { taskId: 'T-1' });
  assert.deepEqual(alone.ran, ['H1'], 'một test tên có dấu ngoặc vẫn là một test đã chạy');
});

test('CP-15-EC31 a hash inside the test name is part of the name', () => {
  // Jest in `#` trong tên mà không escape. Bóc mọi `#` thì `handles # hash` và
  // `handles # pound` cùng cụt thành `handles`, hai test gộp làm một.
  const output = ['ok 1 - H1 handles # hash', 'ok 2 - H1 handles # pound'].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, ['H1'], 'phần sau dấu # là chỗ phân biệt');
  assert.deepEqual(result.collisions.H1, ['H1 handles # hash', 'H1 handles # pound']);
});

test('CP-15-EC32 a PASS line without a file path is a test, not a file header', () => {
  // `PASS <chữ>` phải trông giống đường dẫn mới là dòng tiêu đề file của Jest.
  // Không đòi thì một dòng test bình thường bị nuốt và biến mất hẳn.
  const output = ['PASS H1 my test', 'ok 2 - H1 test khác'].join('\n');
  assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'T-1' }).collided, ['H1']);

  // Còn đường dẫn thật thì vẫn phải nhận ra là tiêu đề file.
  const jest = ['PASS t/a.test.js', '  √ H1 x (1 ms)', 'PASS t/b.test.js', '  √ H1 x (1 ms)'];
  assert.deepEqual(extractRanIds(jest.join('\n'), ['H1'], { taskId: 'T-1' }).collided, ['H1']);
});

test('CP-15-EC33 a failing Vitest container is still a container', () => {
  // Vitest in dòng mở khối là `not ok` bất cứ khi nào có test con đỏ. Đòi nó
  // phải pass thì đúng lúc suite đỏ — ca spec bảo phải báo cả hai — là lúc cơ
  // chế tắt ngấm.
  const output = [
    'not ok 1 - t/a.test.js # time=3.1ms {',
    '    ok 1 - H1 same name # time=1.0ms',
    '    not ok 2 - X1 hỏng # time=1.0ms',
    '}',
    'not ok 2 - t/b.test.js # time=3.1ms {',
    '    ok 1 - H1 same name # time=1.0ms',
    '    not ok 2 - X1 hỏng # time=1.0ms',
    '}',
  ].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, ['H1'], 'hai file vẫn là hai test, dù suite đỏ');
});

test('CP-15-EC34 a TAP directive is recognised whatever its case', () => {
  // TAP 13 quy định directive không phân biệt hoa thường. Trước đây
  // `isPassLine` chỉ chặn chữ hoa, nên `# skip` được tính là ĐÃ CHẠY — gate xanh
  // cho một test bị bỏ qua. Ca này ghim luật đúng.
  for (const d of ['# SKIP', '# skip', '# Skip', '# TODO', '# todo']) {
    const r = extractRanIds('ok 1 - H1 test ' + d, ['H1'], { taskId: 'T-1' });
    assert.deepEqual(r.ran, [], `"${d}" là directive, test này không chạy`);
    assert.deepEqual(r.seenOnNonPassLines, ['H1']);
  }

  // Nhưng chữ thường nằm trong TÊN thì là tên, không phải directive.
  for (const ten of ['H1 renders skip button', 'H1 adds a todo item']) {
    assert.deepEqual(extractRanIds('ok 1 - ' + ten, ['H1'], { taskId: 'T-1' }).ran, ['H1'],
      `"${ten}" là tên tác giả đặt`);
  }
});

test('CP-15-EC35 the escape hatch joiner stops at four characters', () => {
  // EC19 dựng chuỗi 13 ký tự nên bỏ trống hẳn vùng 5–12. Đo đúng biên.
  const bon = ['ok 1 - H1 của task khác', 'ok 2 - CP-15 -- H1 của tôi'].join('\n');
  assert.deepEqual(extractRanIds(bon, ['H1'], { taskId: 'CP-15' }).collided, [],
    'bốn ký tự nối vẫn là lời khai sở hữu');

  const nam = ['ok 1 - H1 của task khác', 'ok 2 - CP-15 --- H1 của tôi'].join('\n');
  assert.deepEqual(extractRanIds(nam, ['H1'], { taskId: 'CP-15' }).collided, ['H1'],
    'năm ký tự thì quá xa, không còn là lời khai');
});

test('CP-15-EC36 Jest marks a failing file with FAIL, and that is still a file header', () => {
  // Jest in `FAIL <file>` cho file có test đỏ. Bỏ nhánh này thì đúng lúc suite
  // đỏ — ca E2 của spec — hai file lại rút về cùng khoá và đụng độ biến mất.
  const output = [
    'FAIL t/a.test.js',
    '  √ H1 same name (1 ms)',
    '  × X1 hỏng (2 ms)',
    'FAIL t/b.test.js',
    '  √ H1 same name (1 ms)',
    '  × X1 hỏng (2 ms)',
  ].join('\n');
  assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'T-1' }).collided, ['H1'],
    'hai file vẫn là hai test, dù suite đỏ');
});

test('CP-15-EC37 two repos are separate blocks, so same-named tests still collide', () => {
  // Gate gộp output nhiều repo bằng dòng `# repo <tên>`. Không nhận ra nó thì
  // hai repo nằm chung một khối, hai test khác nhau trùng tên rút về cùng khoá,
  // dedup thành một — lỗ INV-2 quay lại qua đường multi-repo.
  const output = [
    '# repo be',
    'ok 1 - H1 shared name',
    'ok 2 - H2 chỉ có ở be',
    '# repo fe',
    'ok 1 - H1 shared name',
  ].join('\n');
  const result = extractRanIds(output, ['H1', 'H2'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, ['H1'], 'hai repo là hai test khác nhau');
  assert.deepEqual(result.ran, ['H2']);
});

test('CP-15-EC38 one owned test per repo is not a collision', () => {
  // "Đổi endpoint ở backend, rồi màn hình gọi nó" là ca CP-13 sinh ra để phục
  // vụ: cùng một ca spec, một test mỗi repo. Đòi đúng một dòng khai chủ thì
  // người dùng đặt tên đúng chuẩn vẫn đỏ, và lời khuyên gate in ra thành vô ích.
  const output = [
    '# repo be',
    'ok 1 - T-1-H1 backend trả đúng mã',
    '# repo fe',
    'ok 1 - T-1-H1 màn hình hiện đúng mã',
  ].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'T-1' });
  assert.deepEqual(result.collided, [], 'mỗi repo một test của mình là hợp lệ');
  assert.deepEqual(result.ran, ['H1']);
});

test('CP-15-EC39 two owned tests in the SAME repo is still a collision', () => {
  // Mặt còn lại: nới cho đa repo không được nới luôn cho một repo. Hai test
  // cùng ID trong cùng repo vẫn là task tự đặt trùng.
  const output = [
    '# repo be',
    'ok 1 - T-1-H1 một',
    'ok 2 - T-1-H1 hai',
  ].join('\n');
  assert.deepEqual(extractRanIds(output, ['H1'], { taskId: 'T-1' }).collided, ['H1']);
});

test('CP-15-EC40 when every match belongs to another task, report missing not collision', () => {
  // Hai loại lỗi rất khác nhau: "nhiều test cùng ID, không rõ của ai" và "mọi
  // test mang ID này đều của task khác". Báo sai loại thì người ta đi sửa nhầm.
  const output = ['ok 1 - CP-16-H1 x', 'ok 2 - CP-17-H1 y'].join('\n');
  const result = extractRanIds(output, ['H1'], { taskId: 'CP-3', knownTasks: ['CP-3','CP-16','CP-17'] });
  assert.deepEqual(result.collided, [], 'không phải đụng độ — chỉ là chưa viết test');
  assert.deepEqual(result.ran, [], 'và cũng không tính là đã chạy');
});

test('CP-15-EC41 a repo name with spaces still separates blocks', () => {
  // Tên repo là khóa trong config.json — không luật nào cấm khoảng trắng, và
  // `my app/` là thư mục bình thường. Đòi một token thì dòng phân cách trượt,
  // và cơ chế tắt theo cả hai chiều.
  const khacNhau = [
    '# repo web app',
    'ok 1 - H1 shared name',
    '# repo api server',
    'ok 1 - H1 shared name',
  ].join('\n');
  assert.deepEqual(extractRanIds(khacNhau, ['H1'], { taskId: 'T-1' }).collided, ['H1'],
    'hai repo là hai test, dù tên repo có khoảng trắng');

  const moiRepoMotTest = [
    '# repo web app',
    'ok 1 - T-1-H1 backend',
    '# repo api server',
    'ok 1 - T-1-H1 frontend',
  ].join('\n');
  assert.deepEqual(extractRanIds(moiRepoMotTest, ['H1'], { taskId: 'T-1' }).collided, [],
    'và đường thoát vẫn phải sống');
});

test('CP-15-EC42 an ID owned entirely by other tasks is reported, not erased', () => {
  // Xoá ID khỏi mọi nhóm thì báo cáo nói "không tìm thấy dấu vết" trong khi
  // output có hai dòng pass mang đúng chữ đó — và `seenAnywhere` về 0 làm gate
  // quay ra khuyên sửa reporter đang chạy hoàn hảo.
  const output = ['ok 1 - CP-16-H1 x', 'ok 2 - CP-17-H1 y'].join('\n');
  const r = extractRanIds(output, ['H1'], { taskId: 'CP-3', knownTasks: ['CP-3','CP-16','CP-17'] });
  assert.deepEqual(r.ran, [], 'không phải test của task này');
  assert.deepEqual(r.collided, [], 'cũng không phải đụng độ');
  assert.deepEqual(r.seenOnOtherTasks, ['H1'], 'nhưng nó đã lộ diện — phải nói ra');
});
