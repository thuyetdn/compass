// CP-63 — task đã đặt tên test kèm task id thì test tên trần không được tính.
//
// Một test tên trần (`S1 renders …`) không khai là của ai. Trước task này, nó
// được tính cho bất kỳ task nào đang hỏi, miễn là dòng pass duy nhất mang ID đó.
// Đo trên `examples/todo` với kịch bản demo chép vào làm TD-002, xoá test
// `TD-002-S1`: gate báo TD-002 đã chạy 13/13, nhờ test S1 của TD-001.
//
// Fixture phát lại đúng output TAP của Vitest đo được hôm đó qua một script
// `node`, để suite vẫn không cần dependency nào.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testCommand } from '../commands/test.mjs';
import { readGate } from '../lib/gate-store.mjs';
import { extractRanIds } from '../lib/test-parser.mjs';

// Tên test thật, chép từ examples/todo/test/App.test.jsx.
const TD001_TESTS = [
  'H1 adds a todo to the list',
  'H2 keeps two todos in entry order',
  'H3 marks a todo as done',
  'H4 unmarks a done todo',
  'H5 shows the remaining count after adding',
  'H6 lowers the remaining count when one is done',
  'V1 rejects an empty submission',
  'V2 rejects a whitespace-only submission',
  'V3 clears the input after adding',
  'EC1 starts with an empty list',
  'EC2 shows a very long title in full',
  'E1 leaves the list untouched when toggling an unknown id',
  'S1 renders a script tag as text, not markup',
];
const TD001_IDS = TD001_TESTS.map((t) => t.split(' ')[0]);

// Tên test thật, chép từ docs/demo/scenario/ClearDone.test.jsx — test S1 đã xoá.
const TD002_MAIN = [
  'TD-002-H1 clears the one done todo and keeps the other',
  'TD-002-H2 keeps the undone todos in entry order',
  'TD-002-H3 leaves the remaining count unchanged',
  'TD-002-H4 a remaining todo can still be marked done',
  'TD-002-H5 a todo added after clearing goes to the end',
  'TD-002-H6 a second clear removes the todo marked after the first',
  'TD-002-V1 the button is disabled while nothing is done',
  'TD-002-V2 the button is disabled on an empty list',
  'TD-002-E1 clearing with a half-typed draft neither adds it nor wipes it',
  'TD-002-EC1 clearing when everything is done empties the list',
  'TD-002-EC2 of two todos with the same title only the done one goes',
];
const TD002_EDGE = ['TD-002-EC3 a todo marked then unmarked survives the clear'];
const TD002_S1 = 'TD-002-S1 a script-tag title shows as text and is cleared like any other';
const TD002_IDS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'V1', 'V2', 'E1', 'EC1', 'EC2', 'EC3', 'S1'];
const TD002_WRITTEN = TD002_IDS.filter((id) => id !== 'S1');

const BARE_S1 = 'S1 renders a script tag as text, not markup';

// Dạng `vitest run --reporter=tap`: mỗi file là một khối lề 0 có `# time=… {`,
// test nằm thụt bốn dấu cách bên trong.
function vitestTap(files) {
  const lines = ['TAP version 13', `1..${files.length}`];
  files.forEach((f, i) => {
    lines.push(`ok ${i + 1} - ${f.file} # time=${(180 + i * 37.41).toFixed(2)}ms {`);
    lines.push(`    1..${f.tests.length}`);
    f.tests.forEach((t, j) => {
      const name = typeof t === 'string' ? t : t.name;
      const skip = typeof t === 'string' ? '' : ' # SKIP';
      lines.push(`    ok ${j + 1} - ${name}${skip || ` # time=${(12 + j * 3.17).toFixed(2)}ms`}`);
    });
    lines.push('}');
  });
  return lines.join('\n') + '\n';
}

const TAP_H1 = vitestTap([
  { file: 'test/App.test.jsx', tests: TD001_TESTS },
  { file: 'test/ClearDone.edge.test.jsx', tests: TD002_EDGE },
  { file: 'test/ClearDone.test.jsx', tests: TD002_MAIN },
]);

function specFor(taskId, ids, { extra = '' } = {}) {
  const rows = ids.map((id) => {
    const lop = id.startsWith('EC') ? 'Edge' : id.startsWith('E') ? 'Error'
      : id.startsWith('V') ? 'Validation' : id.startsWith('S') ? 'Security' : 'Happy';
    return `| ${id} | ${lop} | Case ${id} | Đúng | P0 |`;
  });
  return [
    `# ${taskId}: Việc thử`,
    'Loại: feature-s',
    'Phạm vi: src/',
    ...(extra ? [extra] : []),
    '',
    '## Mục tiêu', 'Làm gì đó.', '',
    '## Ràng buộc', 'Không có.', '',
    '## Rủi ro hồi quy', 'Không có.', '',
    '## Test cases',
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
    ...rows,
    '',
  ].join('\n');
}

// Dự án thử: mỗi task một thư mục spec, lệnh test phát lại `tap`.
function makeProject(tasks, tap, { config = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-own-prefix-'));
  for (const [taskId, text] of Object.entries(tasks)) {
    mkdirSync(path.join(root, '.compass', taskId, 'evidence'), { recursive: true });
    writeFileSync(path.join(root, '.compass', taskId, 'spec.md'), text);
  }
  writeFileSync(path.join(root, 'tap.txt'), tap);
  writeFileSync(path.join(root, 'replay.mjs'),
    "import { readFileSync } from 'node:fs';\n" +
    "process.stdout.write(readFileSync(new URL('./tap.txt', import.meta.url), 'utf8'));\n");
  writeFileSync(path.join(root, '.compass', 'config.json'),
    JSON.stringify(config ?? { test: 'node replay.mjs' }));
  return root;
}

const TWO_TASKS = () => ({
  'TD-001': specFor('TD-001', TD001_IDS),
  'TD-002': specFor('TD-002', TD002_IDS),
});

test('CP-63-H1 the gate refuses another task\'s bare test once the task names its own tests', () => {
  const root = makeProject(TWO_TASKS(), TAP_H1);
  const r = testCommand({ cwd: root, taskId: 'TD-002' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /chỉ tìm thấy 12 đã chạy/);
  assert.match(r.output, /\bS1\b/);
  assert.ok(r.output.split('\n').some((l) => l.trim() === BARE_S1), r.output);
  const gate = readGate(root, 'TD-002', 'test');
  assert.equal(gate.exitCode, 1);
  assert.equal(gate.ranIdCount, 12);
  assert.deepEqual(gate.missingIds, ['S1']);
  assert.deepEqual(gate.seenOnBareLines, ['S1']);
});

test('CP-63-H2 adding the task\'s own prefixed test for the missing case turns the gate green', () => {
  const tap = vitestTap([
    { file: 'test/App.test.jsx', tests: TD001_TESTS },
    { file: 'test/ClearDone.edge.test.jsx', tests: TD002_EDGE },
    { file: 'test/ClearDone.test.jsx', tests: [...TD002_MAIN, TD002_S1] },
  ]);
  const root = makeProject(TWO_TASKS(), tap);
  const r = testCommand({ cwd: root, taskId: 'TD-002' });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /13\/13 test cases đã chạy/);
  assert.deepEqual(readGate(root, 'TD-002', 'test').seenOnBareLines, []);
});

test('CP-63-H3 the advice names the exact rename and tells no other story about the missing case', () => {
  const root = makeProject(TWO_TASKS(), TAP_H1);
  const r = testCommand({ cwd: root, taskId: 'TD-002' });
  const hints = r.output.split('\n').filter((l) => l.startsWith('→'));
  assert.ok(hints.some((l) => l.includes('`TD-002-S1')), r.output);
  assert.doesNotMatch(r.output, /Không tìm thấy dấu vết/);
  assert.doesNotMatch(r.output, /Khớp nhiều test khác nhau/);
  assert.doesNotMatch(r.output, /reporter không in tên/);
  // Dòng giải thích phải nói ra task id, để người đọc biết vì sao test trần bị bỏ.
  assert.match(r.output, /TD-002-/);
});

test('CP-63-H4 the parser keeps the 12 prefixed IDs and files the bare match apart', () => {
  const r = extractRanIds(TAP_H1, TD002_IDS, { taskId: 'TD-002', knownTasks: ['TD-001', 'TD-002'] });
  assert.deepEqual([...r.ran].sort(), [...TD002_WRITTEN].sort());
  assert.ok(!r.ran.includes('S1'));
  assert.deepEqual(r.seenOnBareLines, ['S1']);
  assert.deepEqual(r.bareMatches.S1, [BARE_S1]);
  assert.deepEqual(r.collided, []);
});

test('CP-63-H5 SKILL.md, README and the guide state that bare tests stop counting once a task prefixes', () => {
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const sectionOf = (text, heading) => {
    const i = text.indexOf(heading);
    assert.ok(i >= 0, `thiếu mục "${heading}"`);
    const rest = text.slice(i + heading.length);
    const next = rest.search(/\n#{1,6}\s/);
    return next < 0 ? rest : rest.slice(0, next);
  };
  const flat = (s) => s.replace(/\s+/g, ' ');
  const rule = 'task đã đặt tên kèm task id thì test tên trần không được tính';

  const skill = flat(sectionOf(read('skills/compass/SKILL.md'), '### Cách Compass đếm test ID'));
  assert.ok(skill.includes(rule), 'SKILL.md phải nêu luật');
  assert.match(skill, /\|[^|\n]*tên trần[^|\n]*\|[^|\n]*\|/, 'bảng phải có dòng cho kết quả mới');

  const readme = flat(sectionOf(read('README.md'), '### Khi một ID khớp nhiều test'));
  assert.ok(readme.includes(rule), 'README phải nêu luật');
  assert.match(readme, /mọi test của task/, 'README phải bảo đặt tên mọi test, không chỉ test đụng');

  const guide = flat(read('docs/huong-dan.md'));
  assert.ok(guide.includes(rule), 'docs/huong-dan.md phải nêu luật');
  assert.match(guide, /mọi test của task/);
});

test('CP-63-V1 a single all-bare task still passes 13/13 with the same gate record', () => {
  const tap = vitestTap([{ file: 'test/App.test.jsx', tests: TD001_TESTS }]);
  const root = makeProject({ 'TD-001': specFor('TD-001', TD001_IDS) }, tap);
  const r = testCommand({ cwd: root, taskId: 'TD-001' });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /13\/13/);
  const gate = readGate(root, 'TD-001', 'test');
  // Các trường bản ghi có trước task này, cộng đúng một trường mới.
  const before = ['gate', 'command', 'exitCode', 'suiteExitCode', 'suiteFailure', 'signal',
    'startedAt', 'durationMs', 'outputHash', 'outputFile', 'specHash', 'sourceHash', 'configHash',
    'specIdCount', 'ranIdCount', 'missingIds', 'seenOnNonPassLines', 'seenOnUnknownLines',
    'seenOnSharedLines', 'collidedIds', 'seenOnOtherTasks'];
  for (const k of before) assert.ok(k in gate, `thiếu trường ${k}`);
  assert.equal(gate.exitCode, 0);
  assert.equal(gate.suiteExitCode, 0);
  assert.equal(gate.specIdCount, 13);
  assert.equal(gate.ranIdCount, 13);
  for (const k of ['missingIds', 'seenOnNonPassLines', 'seenOnUnknownLines', 'seenOnSharedLines',
    'collidedIds', 'seenOnOtherTasks', 'seenOnBareLines']) {
    assert.deepEqual(gate[k], [], k);
  }
});

test('CP-63-V2 a task mixing one prefixed test with twelve bare ones goes red and names each', () => {
  const tests = ['TD-001-' + TD001_TESTS[0], ...TD001_TESTS.slice(1)];
  const tap = vitestTap([{ file: 'test/App.test.jsx', tests }]);
  const root = makeProject({ 'TD-001': specFor('TD-001', TD001_IDS) }, tap);
  const r = testCommand({ cwd: root, taskId: 'TD-001' });
  assert.equal(r.exitCode, 1, r.output);
  const gate = readGate(root, 'TD-001', 'test');
  const bareIds = TD001_IDS.slice(1);
  assert.deepEqual([...gate.seenOnBareLines].sort(), [...bareIds].sort());
  assert.equal(gate.ranIdCount, 1, 'H1 vẫn được tính');
  assert.ok(!gate.missingIds.includes('H1'));
  // Mỗi ID bị bỏ phải kèm tên test của nó, thụt dưới dòng giải thích.
  const lines = r.output.split('\n').map((l) => l.trim());
  for (const t of TD001_TESTS.slice(1)) assert.ok(lines.includes(t), `thiếu tên test "${t}"\n${r.output}`);
});

test('CP-63-V3 a task id mentioned mid-name is not a claim, so nothing changes', () => {
  const out = ['ok 1 - H1 writes TD-002.log', 'ok 2 - S1 bare'].join('\n');
  const r = extractRanIds(out, ['H1', 'S1'], { taskId: 'TD-002', knownTasks: ['TD-001', 'TD-002'] });
  assert.deepEqual([...r.ran].sort(), ['H1', 'S1']);
  assert.deepEqual(r.seenOnBareLines, []);
  assert.deepEqual(r.collided, []);
});

test('CP-63-E1 the task\'s own test skipped plus a bare one passing is red and says both', () => {
  const out = [
    'ok 1 - TD-002-H1 b',
    'ok 2 - S1 renders a script tag',
    'ok 3 - TD-002-S1 c # SKIP',
  ].join('\n');
  const parsed = extractRanIds(out, ['H1', 'S1'], { taskId: 'TD-002', knownTasks: ['TD-002'] });
  assert.deepEqual(parsed.ran, ['H1']);
  assert.deepEqual(parsed.seenOnNonPassLines, ['S1']);
  assert.deepEqual(parsed.seenOnBareLines, ['S1']);

  const root = makeProject({ 'TD-002': specFor('TD-002', ['H1', 'S1']) }, out + '\n');
  const r = testCommand({ cwd: root, taskId: 'TD-002' });
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /không pass[^\n]*S1/);
  assert.match(r.output, /tên trần[^\n]*S1/);
  assert.ok(r.output.split('\n').some((l) => l.trim() === 'S1 renders a script tag'), r.output);
});

test('CP-63-E2 the rule needs only taskId: knownTasks null still applies, taskId null does not', () => {
  const withTask = extractRanIds(TAP_H1, TD002_IDS, { taskId: 'TD-002', knownTasks: null });
  assert.ok(withTask.seenOnBareLines.includes('S1'));
  assert.ok(!withTask.ran.includes('S1'));

  const noTask = extractRanIds(TAP_H1, TD002_IDS, { taskId: null });
  assert.ok(noTask.ran.includes('S1'));
  assert.deepEqual(noTask.seenOnBareLines, []);
  // Như HEAD: không có task id thì mọi ID có hai test là đụng độ, S1 và EC3 thì một.
  assert.deepEqual([...noTask.ran].sort(), ['EC3', 'S1']);
  assert.deepEqual(noTask.collided, ['E1', 'EC1', 'EC2', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'V1', 'V2']);
});

test('CP-63-EC1 a longer task id\'s prefix does not switch on a shorter one\'s rule', () => {
  const out = ['ok 1 - CP-15-H1 a', 'ok 2 - S1 bare'].join('\n');
  const r = extractRanIds(out, ['H1', 'S1'], { taskId: 'CP-1', knownTasks: ['CP-1', 'CP-15'] });
  assert.deepEqual(r.ran, ['S1']);
  assert.deepEqual(r.seenOnOtherTasks, ['H1']);
  assert.deepEqual(r.seenOnBareLines, []);
});

test('CP-63-EC2 a prefix in one repo makes a bare test in another repo stop counting', () => {
  const out = ['# repo be', 'ok 1 - TD-002-H1 x', '# repo fe', 'ok 1 - S1 y'].join('\n');
  const parsed = extractRanIds(out, ['H1', 'S1'], { taskId: 'TD-002', knownTasks: ['TD-002'], repoNames: ['be', 'fe'] });
  assert.ok(!parsed.ran.includes('S1'));
  assert.deepEqual(parsed.bareMatches.S1, ['S1 y']);

  const IN = (s) => `node -e "console.log('${s}')"`;
  const root = makeProject({ 'TD-002': specFor('TD-002', ['H1', 'S1']) }, '', {
    config: { test: 'true', repos: { be: { test: IN('ok 1 - TD-002-H1 x') }, fe: { test: IN('ok 1 - S1 y') } } },
  });
  mkdirSync(path.join(root, 'be'));
  mkdirSync(path.join(root, 'fe'));
  const r = testCommand({
    cwd: root, taskId: 'TD-002', gateRoot: root,
    repos: [{ name: 'be', dir: path.join(root, 'be') }, { name: 'fe', dir: path.join(root, 'fe') }],
  });
  assert.equal(r.exitCode, 1, r.output);
  assert.ok(r.output.split('\n').some((l) => l.trim() === 'S1 y'), r.output);
});

test('CP-63-EC3 two bare tests for one case under a prefixing task are one bare group, not a collision', () => {
  const out = ['ok 1 - TD-002-H1 x', 'ok 2 - S1 a', 'ok 3 - S1 b'].join('\n');
  const r = extractRanIds(out, ['H1', 'S1'], { taskId: 'TD-002', knownTasks: ['TD-001', 'TD-002'] });
  assert.deepEqual(r.seenOnBareLines, ['S1']);
  assert.deepEqual(r.bareMatches.S1, ['S1 a', 'S1 b']);
  assert.deepEqual(r.collided, []);
  assert.deepEqual(r.ran, ['H1']);
});

test('CP-63-EC4 every ownership form switches the rule on', () => {
  for (const claim of ['TD-002: H1 x', '[TD-002] H1 x', 'TD-002 — H1 x']) {
    const out = [`ok 1 - ${claim}`, 'ok 2 - S1 z'].join('\n');
    const r = extractRanIds(out, ['H1', 'S1'], { taskId: 'TD-002', knownTasks: ['TD-002'] });
    assert.deepEqual(r.seenOnBareLines, ['S1'], claim);
    assert.deepEqual(r.ran, ['H1'], claim);
  }
});

test('CP-63-EC5 an eye-checked task is untouched by the rule', () => {
  const tasks = { ...TWO_TASKS(), 'TD-003': specFor('TD-003', ['H1', 'S1'], { extra: 'Kiểm tra bằng: mắt' }) };
  const root = makeProject(tasks, TAP_H1);
  const r = testCommand({ cwd: root, taskId: 'TD-003' });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /máy không đo gì/);

  const tap = vitestTap([
    { file: 'test/App.test.jsx', tests: TD001_TESTS },
    { file: 'test/ClearDone.test.jsx', tests: TD002_MAIN },
    { file: 'test/Eye.test.jsx', tests: ['TD-003-H1 looks right'] },
  ]);
  const root2 = makeProject(tasks, tap);
  const r2 = testCommand({ cwd: root2, taskId: 'TD-003' });
  assert.equal(r2.exitCode, 2, r2.output);
  assert.match(r2.output, /Spec khai kiểm tra bằng mắt, nhưng suite có test mang ID của task này: H1/);
});

test('CP-63-EC6 a task that never prefixes keeps today\'s collisions next to a prefixing one', () => {
  const root = makeProject(TWO_TASKS(), TAP_H1);
  const r = testCommand({ cwd: root, taskId: 'TD-001' });
  assert.equal(r.exitCode, 1, r.output);
  const collided = ['E1', 'EC1', 'EC2', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'V1', 'V2'];
  // Output y hệt HEAD (4aba541), đo trước khi sửa.
  const byId = Object.fromEntries(TD001_TESTS.map((t) => [t.split(' ')[0], t]));
  const own = Object.fromEntries([...TD002_MAIN, ...TD002_EDGE].map((t) => [t.split(' ')[0].slice('TD-002-'.length), t]));
  const expected = [
    '✗ Gate test FAILED',
    '  Spec khai báo 13 test cases, chỉ tìm thấy 2 đã chạy.',
    `  Khớp nhiều test khác nhau, không rõ cái nào là của task này: ${collided.join(', ')}`,
    ...collided.flatMap((id) => [`        ${byId[id]}`, `        ${own[id]}`]),
    '',
    '→ Những ID này đã có test chạy, nhưng nhiều test khác nhau cùng mang một ID nên gate không biết cái nào của task này. Đặt tên test kèm task id để chỉ rõ: `TD-001-E1 …`. Chỉ cần đổi tên test của task này, không phải đổi test của người khác.',
    '→ Viết test cho các case còn thiếu, hoặc sửa spec nếu chúng không còn cần thiết (sửa spec cần duyệt lại).',
  ];
  assert.deepEqual(r.output.split('\n'), expected);
  const gate = readGate(root, 'TD-001', 'test');
  assert.deepEqual(gate.collidedIds, collided);
  assert.deepEqual(gate.seenOnBareLines, []);
});

test('CP-63-S1 a task id with a regex character does not match a lookalike prefix', () => {
  const out = ['ok 1 - TX1-H1 a', 'ok 2 - S1 bare'].join('\n');
  const r = extractRanIds(out, ['H1', 'S1'], { taskId: 'T.1', knownTasks: ['T.1'] });
  assert.ok(r.ran.includes('S1'));
  assert.deepEqual(r.seenOnBareLines, []);
});
