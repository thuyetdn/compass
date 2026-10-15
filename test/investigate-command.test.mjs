import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { investigateCommand } from '../commands/investigate.mjs';
import { scriptsCommand } from '../commands/scripts.mjs';
import { statusCommand } from '../commands/status.mjs';
import { readGate } from '../lib/gate-store.mjs';
import { hashSource } from '../lib/source-hash.mjs';

function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-inv-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'true' }));
  return root;
}

const FILLED = `# INV-1: Lịch ngừng cập nhật

## Triệu chứng

Lịch 3 khách hàng đứng yên từ 2026-09-01.

## Giả thuyết

### H1: deltaToken hết hạn
**Cách kiểm:** gọi Graph bằng token đang lưu
**Kết quả:** đúng — trả 410

## Bằng chứng

GET /calendarView/delta → 410 Gone

## Kết luận

deltaToken hết hạn sau 30 ngày, syncEvents không bắt 410 nên cron chết âm thầm.

## Pitfall

**Gặp:** 2026-09-05 · INV-1
**Nguyên nhân:** deltaToken sống 30 ngày
**Phòng tránh:** bắt 410 rồi full sync lại

## Việc cần làm tiếp

Mở task BUILD sửa calendar-sync.service.ts.
`;

test('CP-11-H1 opening an investigation writes the template', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(existsSync(path.join(root, '.compass', 'INV-1', 'investigation.md')));
  assert.match(result.output, /Ba luật cứng/);
});

test('the opened file carries the investigation id', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-7' });
  const doc = readFileSync(path.join(root, '.compass', 'INV-7', 'investigation.md'), 'utf8');
  assert.match(doc, /INV-7/);
  assert.ok(!doc.includes('<INV-ID>'));
});

test('CP-11-E1 opening twice refuses rather than overwriting the work so far', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const file = path.join(root, '.compass', 'INV-1', 'investigation.md');
  writeFileSync(file, 'ĐÃ ĐIỀU TRA ĐƯỢC MỘT NỬA');

  const result = investigateCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(result.exitCode, 2);
  assert.equal(readFileSync(file, 'utf8'), 'ĐÃ ĐIỀU TRA ĐƯỢC MỘT NỬA');
});

test('CP-11-E2 closing something never opened is a usage error', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: 'INV-9', close: true });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Chưa mở/);
});

test('CP-11-EC1 closing an untouched template is refused with the gaps named', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Kết luận|Pitfall/);
});

test('CP-11-H3 a filled investigation closes and records a signed entry', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), FILLED);

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 0, result.output);

  const gate = readGate(root, 'INV-1', 'investigate');
  assert.equal(gate.hypothesisCount, 1);
  assert.equal(gate.pitfallWritten, true);
  assert.ok(gate.sig.startsWith('sha256:'));
});

test('CP-11-H8 closing appends the pitfall to the knowledge base', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), FILLED);
  investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

  const pitfalls = readFileSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md'), 'utf8');
  assert.match(pitfalls, /deltaToken sống 30 ngày/);
  assert.match(pitfalls, /Lịch ngừng cập nhật/);
});

test('CP-11-V2 closing with an empty pitfall is refused', () => {
  // Điều tra không để lại bài học thì người sau sập đúng hố đó. Đây là lý do
  // vòng phản hồi tồn tại, nên nó phải chặn — không phải cảnh báo rồi cho qua.
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });

  const khongPitfall = FILLED.replace(
    /## Pitfall[\s\S]*?(?=\n## |$)/,
    '## Pitfall' + '\n\n');
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), khongPitfall);

  const r = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(r.exitCode, 1, 'thiếu pitfall thì không đóng được');
  assert.match(r.output, /Pitfall/);
  assert.ok(!existsSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md')),
    'từ chối đóng thì không được ghi gì vào knowledge base');
});

test('two investigations both leave their lesson behind', () => {
  const root = makeRepo();
  for (const id of ['INV-1', 'INV-2']) {
    investigateCommand({ cwd: root, taskId: id });
    writeFileSync(path.join(root, '.compass', id, 'investigation.md'),
      FILLED.replace('INV-1', id).replace('deltaToken sống 30 ngày', `nguyên nhân của ${id}`));
    investigateCommand({ cwd: root, taskId: id, close: true });
  }
  const pitfalls = readFileSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md'), 'utf8');
  assert.match(pitfalls, /nguyên nhân của INV-1/);
  assert.match(pitfalls, /nguyên nhân của INV-2/);
});

test('CP-11-V5 an invalid id creates nothing', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: 'a/b' });
  assert.equal(result.exitCode, 2);
  assert.equal(existsSync(path.join(root, '.compass', 'a')), false);
});

test('CP-11-S1 an id trying to escape the directory is refused', () => {
  const root = makeRepo();
  const result = investigateCommand({ cwd: root, taskId: '../escape' });
  assert.equal(result.exitCode, 2);
  assert.equal(existsSync(path.join(root, '..', 'escape')), false);
});

test('CP-11-E3 a deleted file mid-investigation is reported, not crashed on', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  rmSync(path.join(root, '.compass', 'INV-1', 'investigation.md'));

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 2);
});

test('CP-11-EC3 status on an investigation says it is one, not that a spec is missing', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });

  const result = statusCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(result.exitCode, 2);
  // The earlier assertion allowed /spec/, which the generic "no spec found"
  // message satisfies — it passed with no investigation handling at all.
  assert.match(result.output, /là một điều tra/);
  assert.match(result.output, /investigation\.md/);
});

test('status on a task that simply has no spec still says so plainly', () => {
  const root = makeRepo();
  const result = statusCommand({ cwd: root, taskId: 'T-KHONG-CO' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không tìm thấy spec/);
});

test('CP-11-H5 scripts --list on an empty library explains what it is for', () => {
  const root = makeRepo();
  const result = scriptsCommand({ cwd: root });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /Chưa có script/);
});

test('CP-11-H4 scripts --list shows each script and its purpose line', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'find-orphans.mjs'), '// Tìm contact không còn chủ\nconsole.log(1);\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /find-orphans\.mjs/);
  assert.match(result.output, /Tìm contact không còn chủ/);
});

test('CP-11-EC4 a script in a subdirectory is listed with its path', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts', 'db');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'orphans.sql'), '-- Đếm bản ghi mồ côi\nSELECT 1;\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /db\/orphans\.sql/);
  assert.match(result.output, /Đếm bản ghi mồ côi/);
});

test('CP-11-E4 a script with no comment header is listed, marked as undescribed', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bare.mjs'), 'console.log("không có mô tả");\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /bare\.mjs/);
  assert.match(result.output, /chưa có dòng comment/);
});

test('CP-11-S2 listing scripts never executes them', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  const marker = path.join(root, 'ĐÃ-CHẠY.txt');
  writeFileSync(path.join(dir, 'evil.mjs'),
    `// Script này không được chạy\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);

  scriptsCommand({ cwd: root });
  assert.equal(existsSync(marker), false, 'scripts --list không được thực thi script');
});

test('opening an investigation does not disturb the source hash', () => {
  const root = makeRepo();
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  const before = hashSource(root);

  investigateCommand({ cwd: root, taskId: 'INV-1' });
  assert.equal(hashSource(root), before);
});

test('CP-11-V6 an untouched pitfall block cannot close an investigation', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const file = path.join(root, '.compass', 'INV-1', 'investigation.md');

  // Fill everything except the Pitfall block, left exactly as the template
  // wrote it — labelled placeholders that once read as real content.
  const filled = readFileSync(file, 'utf8')
    .replace('# INV-1: <triệu chứng, một câu>', '# INV-1: Lịch ngừng cập nhật')
    .replace('<Người dùng thấy gì. Số liệu nếu có: bao nhiêu case, từ khi nào, tần suất.>', 'Lịch 3 khách hàng đứng yên.')
    .replace('### H1: <giả thuyết>', '### H1: token hết hạn')
    .replace('**Cách kiểm tra:** <lệnh, script, hay phép đo cụ thể — làm gì thì biết đúng hay sai>', '**Cách kiểm tra:** gọi API bằng token cũ')
    .replace('**Kết quả:** <chưa kiểm tra | đúng | sai — kèm số liệu>', '**Kết quả:** đúng — trả 410')
    .replace('<Output thật, số đo thật. Dán vào, đừng kể lại.>', 'GET /delta → 410')
    .replace('<Nguyên nhân gốc. Phải dẫn được về bằng chứng ở trên, không phải suy luận.>', 'Token sống 30 ngày.')
    .replace('<Task BUILD nào cần mở để sửa. Ghi "không cần" nếu điều tra kết luận là không phải lỗi.>', 'không cần');
  writeFileSync(file, filled);

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /Pitfall/);
  // The fixture must have filled everything else, or this test stops isolating the
  // Pitfall block — a template rewording (CP-39) once left three placeholders behind.
  assert.doesNotMatch(result.output, /Giả thuyết H1|Triệu chứng/, 'chỉ Pitfall được phép còn chữ mẫu');
  assert.equal(existsSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md')), false,
    'không được ghi chữ mẫu vào kho pitfall');
});

test('CP-11-V7 a title left as template text blocks closing', () => {
  const root = makeRepo();
  investigateCommand({ cwd: root, taskId: 'INV-1' });
  const file = path.join(root, '.compass', 'INV-1', 'investigation.md');
  writeFileSync(file, FILLED.replace('# INV-1: Lịch ngừng cập nhật', '# INV-1: <triệu chứng, một câu>'));

  const result = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /tiêu đề/);
});

test('CP-11-EC5 an existing pitfalls file with no trailing newline stays readable', () => {
  const root = makeRepo();
  const pitfalls = path.join(root, '.knowledge', 'decided', 'pitfalls.md');
  mkdirSync(path.dirname(pitfalls), { recursive: true });
  writeFileSync(pitfalls, '# Bẫy đã từng sập\n\nMột đoạn cũ không xuống dòng ở cuối');

  investigateCommand({ cwd: root, taskId: 'INV-1' });
  writeFileSync(path.join(root, '.compass', 'INV-1', 'investigation.md'), FILLED);
  investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

  const text = readFileSync(pitfalls, 'utf8');
  // Đo đúng chỗ nối. Khẳng định `\n## INV-1` là rỗng nghĩa: chuỗi ghép đã có
  // `\n## ` cứng sẵn, nên nó đúng kể cả khi bỏ hẳn logic thêm dấu ngắt.
  const noi = text.slice(text.indexOf('không xuống dòng ở cuối'));
  assert.match(noi, /^không xuống dòng ở cuối\n\n## INV-1/,
    `đoạn cũ và mục mới phải cách nhau một dòng trống, thấy: ${JSON.stringify(noi.slice(0, 60))}`);
});

test('CP-11-EC6 a script opening with a block comment shows the line below it', () => {
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'block.mjs'), '/**\n * Đếm bản ghi mồ côi trong DB\n */\nconsole.log(1);\n');

  const result = scriptsCommand({ cwd: root });
  assert.match(result.output, /Đếm bản ghi mồ côi trong DB/);
  assert.ok(!/^\s+\*$/m.test(result.output), 'không được lấy dấu sao làm mô tả');
});

test('CP-11-P1 listing scripts reads headers, not whole files', () => {
  // Liệt kê một thư viện không được tốn bằng đọc nó.
  //
  // Fixture phải đặt phần mô tả **sau** vùng header và không có gì cản đường:
  // `purposeOf` dừng ở dòng không-comment đầu tiên, nên một khối code lớn ở
  // giữa sẽ chặn nó bất kể đọc bao nhiêu byte — và test xanh kể cả khi giới
  // hạn header bị gỡ sạch. Bản đầu của ca này đã mắc đúng lỗi đó.
  const root = makeRepo();
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });

  const SAU_HEADER = 'MO_TA_NAM_SAU_HEADER';
  writeFileSync(path.join(dir, 'to.mjs'), '\n'.repeat(200000) + `// ${SAU_HEADER}` + '\n');
  writeFileSync(path.join(dir, 'nho.mjs'), '// dọn thư mục tạm' + '\n');

  const result = scriptsCommand({ cwd: root });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /dọn thư mục tạm/, 'header trong tầm vẫn phải đọc được');
  assert.ok(!result.output.includes(SAU_HEADER), 'không được đọc quá vùng header');
});

// ---- CP-35: đóng lại không được chép trùng, và mô tả trong comment HTML ----

const PITFALL_FILE = ['.knowledge', 'decided', 'pitfalls.md'];
const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

function pitfallsOf(root) {
  return readFileSync(path.join(root, ...PITFALL_FILE), 'utf8');
}

function writePitfalls(root, text) {
  mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });
  writeFileSync(path.join(root, ...PITFALL_FILE), text);
}

// Mở rồi điền hồ sơ, sẵn sàng để `--close`.
function readyToClose(root, id = 'INV-1', doc = FILLED) {
  investigateCommand({ cwd: root, taskId: id });
  writeFileSync(path.join(root, '.compass', id, 'investigation.md'), doc.replace(/INV-1\b/g, id));
  return path.join(root, '.compass', id, 'investigation.md');
}

// Đếm mục theo heading cấp hai — đó là đơn vị mà `--close` ghi ra.
function entryTitles(text) {
  return text.split(/\r?\n/).filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
}

test('CP-35-H1 the first close appends the pitfall, exactly as before', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    const r = investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    assert.equal(r.exitCode, 0, r.output);
    assert.match(pitfallsOf(root), /deltaToken sống 30 ngày/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-H2 closing twice leaves one entry, not two', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const titles = entryTitles(pitfallsOf(root));
    const lan = titles.filter((t) => t.includes('Lịch ngừng cập nhật')).length;
    assert.equal(lan, 1, `mục xuất hiện ${lan} lần — đóng lại là chuyện thường, không phải chép thêm`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-H3 closing again after the pitfall text changed keeps only the new text', () => {
  const root = makeRepo();
  try {
    const file = readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // Sửa hồ sơ là chuyện làm docHash lệch và buộc đóng lại — chính đường dẫn
    // tới bug này.
    writeFileSync(file, readFileSync(file, 'utf8').replace('deltaToken sống 30 ngày', 'deltaToken sống 28 ngày'));
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /28 ngày/);
    assert.doesNotMatch(text, /30 ngày/, 'bản cũ phải được thay, không phải nằm cạnh bản mới');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC1 replacing the last entry does not eat the file', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    writePitfalls(root, '# Bẫy đã từng sập\n\n## Mục có trước\n\nGiữ nguyên.\n');
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /Mục có trước/, 'mục đứng trước phải còn');
    assert.match(text, /Giữ nguyên\./);
    assert.equal(entryTitles(text).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC2 replacing the first entry keeps the file title and intro', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    writePitfalls(root, pitfallsOf(root) + '\n## Mục đứng sau\n\nGiữ nguyên.\n');
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /^# Bẫy đã từng sập/, 'tiêu đề file phải còn');
    assert.match(text, /Mục đứng sau/, 'mục sau phải còn');
    assert.equal(entryTitles(text).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC3 a CRLF pitfalls file is rewritten without stray CR', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // Bẫy CRLF đã tái diễn ở năm file trong dự án này.
    writePitfalls(root, pitfallsOf(root).replace(/\n/g, '\r\n') + '\r\n## Mục sau\r\n\r\nGiữ.\r\n');
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /Mục sau/, 'mục sau phải còn');
    assert.equal(
      entryTitles(text).filter((t) => t.includes('Lịch ngừng cập nhật')).length,
      1,
      'CRLF không được làm mục nhân đôi',
    );
    for (const t of entryTitles(text)) {
      assert.doesNotMatch(t, /\r/, 'tiêu đề không được mang \\r');
    }
    // Và phải GIỮ CRLF, không chuyển cả file sang LF. Chỉ kiểm "tiêu đề không
    // mang \r" thì hardcode LF cũng qua — nó xoá sạch \r, và file thật (295 dòng
    // CRLF) bị đổi hết line ending trong một diff giả.
    const lfTron = (text.split(NL).length - 1) - (text.split(CRLF).length - 1);
    assert.equal(lfTron, 0, `${lfTron} dòng LF lẫn vào file CRLF`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC4 a title holding regex metacharacters is matched literally', () => {
  const root = makeRepo();
  try {
    const doc = FILLED.replace('# INV-1: Lịch ngừng cập nhật', '# INV-1: Lỗi (a.b)* ở [gate]');
    readyToClose(root, 'INV-1', doc);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const titles = entryTitles(pitfallsOf(root));
    assert.equal(titles.filter((t) => t.includes('Lỗi (a.b)*')).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC5 a title that is a prefix of another entry is not confused with it', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // `INV-1` là tiền tố của `INV-10`. Khớp bằng startsWith là thay nhầm mục.
    const daiHon = pitfallsOf(root).replace('## INV-1:', '## INV-10:');
    writePitfalls(root, pitfallsOf(root) + '\n' + daiHon.split('\n').filter((l) => !l.startsWith('# Bẫy')).join('\n'));

    // So nguyên khối, không so substring: `includes('INV-10')` vẫn đúng khi thân
    // mục đã bị ghi đè, nên nó không bắt được corruption.
    const truoc = pitfallsOf(root);
    const khoiCu = truoc.slice(truoc.indexOf('## INV-10:'));
    assert.ok(khoiCu.length > 20, 'điều kiện ban đầu: phải có mục INV-10 với thân');

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    const sau = pitfallsOf(root);
    assert.ok(sau.includes(khoiCu.trimEnd()), 'mục INV-10 phải còn nguyên từng byte');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC6 a ### subheading inside the entry is replaced with it', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    writePitfalls(root, pitfallsOf(root) + '\n### Chi tiết thêm\n\nDòng này thuộc mục trên.\n\n## Mục sau\n\nGiữ.\n');
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.doesNotMatch(text, /Chi tiết thêm/, 'quét phải dừng ở `## `, không dừng ở mọi heading');
    assert.match(text, /Mục sau/, 'mục cấp hai kế tiếp phải còn');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S1 replacing one entry leaves every other entry byte-for-byte', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    const giuNguyen = '## Mục A\n\nNội dung A, phải giữ từng byte.\n\n## Mục B\n\nNội dung B.\n';
    writePitfalls(root, '# Bẫy đã từng sập\n\n' + giuNguyen);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    assert.ok(pitfallsOf(root).includes(giuNguyen.trimEnd()), 'hai mục kia phải nguyên văn');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S2 the entry count is exactly right after a rewrite', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    writePitfalls(root, '# Bẫy đã từng sập\n\n## M1\n\na\n\n## M2\n\nb\n\n## M3\n\nc\n');
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    assert.equal(entryTitles(pitfallsOf(root)).length, 4, 'thêm một mục');

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    assert.equal(entryTitles(pitfallsOf(root)).length, 4, 'đóng lại thì vẫn bốn — không gộp, không thêm');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S3 a fenced ## line truncates the new entry but never eats a neighbour', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // Thân mục có khối code chứa dòng `## `. Dừng ở đó là cắt mục làm hai, và
    // nửa sau thành một mục không tiêu đề.
    writePitfalls(root, pitfallsOf(root).replace(
      'bắt 410 rồi full sync lại',
      'bắt 410 rồi full sync lại\n\n```md\n## Đây là ví dụ, không phải mục mới\n```\n\nCâu cuối của mục.',
    ) + '\n## Mục sau\n\nGiữ.\n');
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    // Đánh đổi có ý thức: dòng `## ` trong khối này được sửa tay vào file, thân
    // mới không có khối code nào làm chứng cho nó (luật nhân chứng, CP-53), nên
    // mục cũ hết ở đó và phần sau khối vẫn nằm lại. Thấy được ngay khi đọc file.
    // Đoán ngược lại — "đó không phải heading" — là quét tới cuối file và xoá
    // sạch mọi mục phía sau, im lặng, exit 0. Ba lần thử đọc fence đều sập.
    assert.match(text, /Mục sau/, 'điều phải giữ: mục kế tiếp không bao giờ mất');
    assert.match(text, /deltaToken/, 'mục mới vẫn được ghi');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-E1 a read-only pitfalls file reports not-written instead of throwing', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    // Thư mục thay vì file: mọi lệnh ghi đều lỗi, trên cả Windows lẫn POSIX.
    mkdirSync(path.join(root, '.knowledge', 'decided', 'pitfalls.md'), { recursive: true });

    let r;
    assert.doesNotThrow(() => { r = investigateCommand({ cwd: root, taskId: 'INV-1', close: true }); });
    assert.equal(r.exitCode, 0, 'ghi pitfall lỗi không được chặn việc đóng hồ sơ');
    assert.equal(readGate(root, 'INV-1', 'investigate').pitfallWritten, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-E2 an existing entry with an empty body is replaced cleanly', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    writePitfalls(root, '# Bẫy đã từng sập\n\n## INV-1: Lịch ngừng cập nhật\n\n## Mục sau\n\nGiữ.\n');
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /deltaToken sống 30 ngày/, 'mục rỗng phải được điền');
    assert.equal(entryTitles(text).filter((t) => t.includes('Lịch ngừng')).length, 1);
    assert.match(text, /Mục sau/);
    assert.doesNotMatch(text, /\n\n\n\n/, 'đừng để lại khối trắng');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-E3 a file with no trailing newline gets a heading on its own line', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    writePitfalls(root, '# Bẫy đã từng sập\n\n## Mục cũ\n\nKhông có newline cuối.');
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.doesNotMatch(text, /cuối\.## /, 'tiêu đề không được nối vào đoạn trước');
    assert.equal(entryTitles(text).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- purposeOf: mô tả trong comment HTML ----

function writeScript(root, name, body) {
  const file = path.join(root, '.compass', 'scripts', name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  return file;
}

test('CP-35-H4 an html file describes itself through an HTML comment', () => {
  const root = makeRepo();
  try {
    writeScript(root, 'inv1-timeline.html', '<!-- Dựng timeline từ log để xem thứ tự sự kiện -->\n<html></html>\n');
    const r = scriptsCommand({ cwd: root });
    assert.equal(r.exitCode, 0, r.output);
    assert.match(r.output, /Dựng timeline từ log/, r.output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-H5 files in queries/ and tools/ are listed with their subpath', () => {
  const root = makeRepo();
  try {
    writeScript(root, 'queries/inv1-prod-0909.sql', '-- Đếm contact chưa xác thực\nselect 1;\n');
    writeScript(root, 'tools/inv1-timeline.html', '<!-- Dựng timeline từ log -->\n');
    writeScript(root, 'port-holders.mjs', '// Ai giữ cổng 5173\n');

    const r = scriptsCommand({ cwd: root });
    assert.match(r.output, /queries\/inv1-prod-0909\.sql/, r.output);
    assert.match(r.output, /tools\/inv1-timeline\.html/, r.output);
    assert.match(r.output, /port-holders\.mjs/);
    assert.match(r.output, /Đếm contact chưa xác thực/);
    assert.match(r.output, /Dựng timeline từ log/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-V1 a bare <!-- opener reads the description from the next line', () => {
  const root = makeRepo();
  try {
    writeScript(root, 'x.html', '<!--\nSo hai bản export để tìm dòng lệch\n-->\n');
    const r = scriptsCommand({ cwd: root });
    assert.match(r.output, /So hai bản export/, r.output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-V2 a line holding only --> is not a description', () => {
  const root = makeRepo();
  try {
    writeScript(root, 'x.html', '-->\n<html></html>\n');
    const r = scriptsCommand({ cwd: root });
    assert.doesNotMatch(r.output, /-->/, r.output);
    assert.match(r.output, /chưa có dòng comment mô tả/, r.output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-V3 an @out declaration written as an HTML comment is not a description', () => {
  const root = makeRepo();
  try {
    writeScript(root, 'x.html', '<!-- @out: INV-1-x-0909.csv -->\n<!-- Mô tả thật nằm đây -->\n');
    const r = scriptsCommand({ cwd: root });
    assert.match(r.output, /Mô tả thật nằm đây/, r.output);
    assert.doesNotMatch(r.output, /@out/, 'khai tên file export không phải mô tả');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-V4 a file opening with a doctype has no description', () => {
  const root = makeRepo();
  try {
    writeScript(root, 'x.html', '<!DOCTYPE html>\n<html></html>\n');
    const r = scriptsCommand({ cwd: root });
    assert.match(r.output, /chưa có dòng comment mô tả/, r.output);
    assert.doesNotMatch(r.output, /DOCTYPE/, 'doctype không phải mô tả tác giả viết');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC7 <!--no space before the text still reads', () => {
  const root = makeRepo();
  try {
    writeScript(root, 'x.html', '<!--Dựng bảng so sánh-->\n');
    const r = scriptsCommand({ cwd: root });
    assert.match(r.output, /Dựng bảng so sánh/, r.output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC8 a README inside a subdirectory is excluded too', () => {
  const root = makeRepo();
  try {
    writeScript(root, 'queries/README.md', '# Query\n');
    writeScript(root, 'queries/inv1-a-0909.sql', '-- Có mô tả\nselect 1;\n');
    const r = scriptsCommand({ cwd: root });
    assert.doesNotMatch(r.output, /README/, r.output);
    assert.match(r.output, /inv1-a-0909\.sql/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S4 the listing prints one description line, never more of the file', () => {
  const root = makeRepo();
  try {
    writeScript(root, 'x.html', '<!-- Mô tả một dòng -->\n<p>BÍ MẬT KHÔNG ĐƯỢC IN</p>\n<p>DÒNG NỮA</p>\n');
    const r = scriptsCommand({ cwd: root });
    assert.match(r.output, /Mô tả một dòng/);
    assert.doesNotMatch(r.output, /BÍ MẬT/, 'chỉ in dòng mô tả, không in thân file');
    assert.doesNotMatch(r.output, /DÒNG NỮA/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S5 an unterminated fence inside the entry does not delete its neighbours', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // Fence lẻ trong thân mục làm cờ mắc tới hết file: không heading nào được
    // thấy nữa, và MỌI mục phía sau bị xoá — im lặng, exit 0, gate xanh.
    const F = String.fromCharCode(96).repeat(3);
    writePitfalls(root, pitfallsOf(root).replace(
      'bắt 410 rồi full sync lại',
      'bắt 410 rồi full sync lại' + NL + NL + F + 'sh' + NL + 'echo 1',
    ) + NL + '## Mục Y' + NL + NL + 'Phải còn.' + NL + NL + '## Mục Z' + NL + NL + 'Cũng phải còn.' + NL);

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /Mục Y/, 'mục sau fence lẻ phải còn');
    assert.match(text, /Mục Z/, 'mục cuối phải còn');
    assert.match(text, /Phải còn\./);
    assert.match(text, /Cũng phải còn\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S6 an unterminated HTML comment does not leak the file body', () => {
  const root = makeRepo();
  try {
    // Payload phải là thứ CHỈ chốt mới chặn được. Một dòng mở bằng `<` hay một
    // dòng CSV đều bị nhánh fallback trả null sẵn, nên test dùng chúng vẫn xanh
    // khi xoá hẳn chốt — đúng cái bẫy spec S8 đã nêu.
    writeScript(root, 'x.html', '<!--' + NL + '-- BÍ MẬT KHÁCH HÀNG' + NL);
    const r = scriptsCommand({ cwd: root });
    assert.doesNotMatch(r.output, /BÍ MẬT/, 'khối chưa đóng thì đừng nhận bừa dòng kế tiếp');
    assert.match(r.output, /chưa có dòng comment mô tả/, r.output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-V5 a bare @out line inside an HTML block is not a description', () => {
  const root = makeRepo();
  try {
    // Dòng tiếp trong khối không có tiền tố comment nên OUT_MARKER không khớp.
    writeScript(root, 'x.html', '<!--' + NL + '@out: INV-1-x-0909.csv' + NL + 'Mô tả thật nằm đây' + NL + '-->' + NL);
    const r = scriptsCommand({ cwd: root });
    assert.match(r.output, /Mô tả thật nằm đây/, r.output);
    assert.doesNotMatch(r.output, /@out/, 'khai tên file export không phải mô tả');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC9 appending to a CRLF file introduces no LF-only line', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    // Mục chưa có nên đi nhánh APPEND, không phải nhánh thay. Đó là chỗ EOL bị
    // hardcode LF và chèn dòng lệch kiểu vào file CRLF.
    writePitfalls(root, '# Bẫy đã từng sập' + CRLF + CRLF + '## Mục cũ' + CRLF + CRLF + 'Nội dung.' + CRLF);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /Mục cũ/, 'mục cũ phải còn');
    assert.match(text, /deltaToken sống 30 ngày/, 'mục mới phải được thêm');
    // Đếm LF không đi kèm CR: file CRLF thì phải là 0.
    const lfTron = (text.split(NL).length - 1) - (text.split(CRLF).length - 1);
    assert.equal(lfTron, 0, `${lfTron} dòng LF lẫn vào file CRLF`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC10 a title that is a true prefix of another is not confused with it', () => {
  const root = makeRepo();
  try {
    // Tiêu đề của điều tra là TIỀN TỐ của một mục đã có. Khớp bằng startsWith
    // theo chiều này sẽ thay nhầm mục dài hơn — và mục thật thì không bao giờ
    // được ghi.
    const doc = FILLED.replace('# INV-1: Lịch ngừng cập nhật', '# INV-1: Lịch');
    readyToClose(root, 'INV-1', doc);
    writePitfalls(root, [
      '# Bẫy đã từng sập', '',
      '## INV-1: Lịch ngừng cập nhật hoàn toàn', '', 'Mục dài, phải còn nguyên.', '',
      '## Mục sau', '', 'Cũng phải còn.', '',
    ].join(NL));

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /Mục dài, phải còn nguyên\./, 'mục có tiêu đề dài hơn không được bị thay');
    assert.match(text, /Cũng phải còn\./);
    assert.equal(entryTitles(text).length, 3, 'thêm một mục, không thay mục nào');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S7 two unterminated fences do not delete the entries between them', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // Ghép cặp fence theo thứ tự thì dấu lẻ của mục X ghép với dấu lẻ của mục Z,
    // và cả khoảng giữa — kể cả heading thật — bị coi là trong khối code.
    const F = String.fromCharCode(96).repeat(3);
    writePitfalls(root, pitfallsOf(root).replace(
      'bắt 410 rồi full sync lại',
      'bắt 410 rồi full sync lại' + NL + NL + F,
    ) + [
      '', '## Mục Y', '', 'Phải còn.', '',
      '## Mục Z', '', 'Fence lẻ nữa:', '', F, '',
      '## Mục W', '', 'Cũng phải còn.', '',
    ].join(NL));

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /Mục Y/, 'mục giữa hai fence lẻ phải còn');
    assert.match(text, /Mục Z/);
    assert.match(text, /Mục W/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S8 an unterminated HTML comment never leaks a data row', () => {
  const root = makeRepo();
  try {
    // Chốt cũ chỉ nhận dòng mở bằng `<`, nên một dòng CSV vẫn lọt ra.
    // `--` đầu dòng là comment SQL hợp lệ, nên nhánh fallback sẽ nhận nó làm mô
    // tả. Chỉ chốt "khối chưa đóng thì bỏ cả file" mới chặn được.
    writeScript(root, 'x.html', '<!--' + NL + '-- a@b.com,0901234567,5000000' + NL);
    const r = scriptsCommand({ cwd: root });
    assert.doesNotMatch(r.output, /a@b\.com/, 'khối chưa đóng thì đừng in gì từ file');
    assert.doesNotMatch(r.output, /0901234567/);
    assert.match(r.output, /chưa có dòng comment mô tả/, r.output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-V6 an empty HTML comment does not report --> as the description', () => {
  const root = makeRepo();
  try {
    for (const body of ['<!-- -->' + NL + '<p>x</p>' + NL, '<!---->' + NL]) {
      const root2 = makeRepo();
      try {
        writeScript(root2, 'x.html', body);
        const r = scriptsCommand({ cwd: root2 });
        assert.doesNotMatch(r.output, /-->/, JSON.stringify(body));
        assert.match(r.output, /chưa có dòng comment mô tả/, JSON.stringify(body));
      } finally {
        rmSync(root2, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC11 a ## line inside a tilde fence does not fabricate an entry', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    // Fence `~~~` thật, chứa một dòng `## `. Bản trước của ca này không có fence
    // nào nên nó không đo được gì.
    writePitfalls(root, pitfallsOf(root).replace(
      'bắt 410 rồi full sync lại',
      ['bắt 410 rồi full sync lại', '', '~~~', '## Ví dụ, không phải mục', '~~~'].join(NL),
    ) + [
      '', '## Mục sau', '', 'Phải còn nguyên.', '',
    ].join(NL));

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const text = pitfallsOf(root);
    assert.match(text, /Phải còn nguyên\./, 'mục sau phải còn');
    assert.equal(
      entryTitles(text).filter((t) => t.includes('Lịch ngừng cập nhật')).length,
      1,
      'không được nhân bản mục',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC12 repeated closing neither grows nor shrinks blank lines', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    const sauLan1 = pitfallsOf(root);

    // Đóng lại là chuyện thường. Bỏ chốt cắt dòng trắng đuôi thì mỗi lần đóng
    // lại thêm một dòng trắng, và file git-tracked phình ra qua từng vòng.
    for (let i = 0; i < 5; i++) investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    assert.equal(pitfallsOf(root), sauLan1, 'đóng lại nhiều lần phải cho ra đúng cùng một file');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S9 a stray --> followed by data never reaches the output', () => {
  const root = makeRepo();
  try {
    // `line === '-->'` chỉ bắt đúng dòng trơn. `--> a@b.com,...` rơi xuống regex
    // bên dưới, và nhánh `--` ở đó bắt phần còn lại — in ra dữ liệu khách hàng.
    writeScript(root, 'x.html', '--> a@b.com,0901234567,5000000' + NL);
    const r = scriptsCommand({ cwd: root });
    assert.doesNotMatch(r.output, /a@b\.com/, r.output);
    assert.doesNotMatch(r.output, /0901234567/);
    assert.match(r.output, /chưa có dòng comment mô tả/, r.output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S10 a mid-line <!-- does not turn the whole line into a description', () => {
  const root = makeRepo();
  try {
    // Khối chỉ tính khi `<!--` mở ĐẦU DÒNG. Nhận cả `<!--` giữa dòng thì dòng
    // đó có code trước nó, và trả cả dòng là in thân file ra.
    writeScript(root, 'x.html', '<tr><td>a@b.com</td><td>0901234567</td></tr> <!-- ghi chu -->' + NL);
    const r = scriptsCommand({ cwd: root });
    assert.doesNotMatch(r.output, /a@b\.com/, r.output);
    assert.doesNotMatch(r.output, /0901234567/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S11 a description followed by data on the same line drops the data', () => {
  const root = makeRepo();
  try {
    // `-->` giữa dòng: phần sau nó là thân file, không phải mô tả.
    writeScript(root, 'x.html', '<!-- Dựng timeline --> a@b.com,0901234567' + NL);
    const r = scriptsCommand({ cwd: root });
    assert.match(r.output, /Dựng timeline/, r.output);
    assert.doesNotMatch(r.output, /a@b\.com/, 'phần sau `-->` là thân file');
    assert.doesNotMatch(r.output, /0901234567/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S12 a tab after ## is not an entry boundary', () => {
  const root = makeRepo();
  try {
    // `/^##\s+/` khớp cả tab, còn parser hồ sơ dùng `/^## /` với khoảng trắng
    // literal. Lệch nhau thì dòng tab lọt vào thân pitfall rồi thành ranh giới,
    // và mỗi lần đóng lại nhân bản phần đuôi.
    const doc = FILLED.replace(
      '**Phòng tránh:** bắt 410 rồi full sync lại',
      ['**Phòng tránh:** bắt 410 rồi full sync lại', '', '##	Không phải mục', '', 'Câu cuối.'].join(NL),
    );
    readyToClose(root, 'INV-1', doc);

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    const sauLan1 = pitfallsOf(root);
    for (let i = 0; i < 5; i++) investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    assert.equal(pitfallsOf(root), sauLan1, 'đóng lại nhiều lần không được nhân bản gì');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC13 one stray CRLF in an LF file does not convert every line', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // Chọn EOL theo "có CRLF nào không" thì một dòng CRLF lạc làm cả file bị
    // join lại bằng CRLF — 291 dòng đổi hết trong một diff giả.
    const truoc = pitfallsOf(root).split(CRLF).join(NL);
    writePitfalls(root, truoc.replace('deltaToken', 'delta' + CRLF + 'Token'));
    const crlfTruoc = pitfallsOf(root).split(CRLF).length - 1;
    assert.equal(crlfTruoc, 1, 'điều kiện ban đầu: đúng một dòng CRLF');

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    const crlfSau = pitfallsOf(root).split(CRLF).length - 1;
    assert.ok(crlfSau <= 1, `${crlfSau} dòng CRLF — file LF bị chuyển hết sang CRLF`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S13 exotic line breaks do not collapse the file into one leaking line', () => {
  const root = makeRepo();
  try {
    // `.` trong regex khong khop U+2028/U+2029, va `split(/\r?\n/)` khong tach
    // o do — nen ca file gop thanh MOT dong: mo `<!--`, co `-->`, bi tinh la
    // khoi da dong, roi tra ve ca dong kem than file.
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    for (const sep of [LS, PS, String.fromCharCode(13)]) {
      const root2 = makeRepo();
      try {
        writeScript(root2, 'x.html', '<!-- Dựng timeline -->' + sep + 'a@b.com,0901234567,5000000');
        const r = scriptsCommand({ cwd: root2 });
        assert.doesNotMatch(r.output, /a@b\.com/, JSON.stringify(sep));
        assert.doesNotMatch(r.output, /0901234567/, JSON.stringify(sep));
      } finally {
        rmSync(root2, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S14 a minority-EOL neighbour keeps its own line endings', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // Join cả file bằng MỘT eol chung đổi luôn dấu kết thúc của dòng không ai
    // chạm tới — ràng buộc "mọi mục khác nguyên từng byte" vỡ.
    const lanCan = '## Mục CRLF' + CRLF + CRLF + 'Thân dùng CRLF.' + CRLF;
    writePitfalls(root, pitfallsOf(root).split(CRLF).join(NL) + NL + lanCan);

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // KHÔNG `.trimEnd()`: nó cắt đúng dấu kết thúc mà ca này sinh ra để bảo vệ.
    assert.ok(pitfallsOf(root).includes(lanCan), 'mục lân cận phải nguyên từng byte');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S15 a minority-EOL line BEFORE the replaced entry keeps its ending', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    // Mục của INV-1 nằm CUỐI, nên phần "trước" là chỗ mang dòng lạ kiểu. Phần
    // trước và phần sau được dựng lại riêng, nên mỗi bên cần một ca.
    const truoc = '## Mục CRLF' + CRLF + CRLF + 'Thân dùng CRLF.' + CRLF;
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    writePitfalls(root, '# Bẫy đã từng sập' + NL + NL + truoc + NL + pitfallsOf(root)
      .split(NL).filter((l) => !l.startsWith('# Bẫy')).join(NL).trimStart());

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
    assert.ok(pitfallsOf(root).includes(truoc), 'dòng đứng trước phải nguyên từng byte');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-S16 the separator blank line keeps the preceding entry own ending', () => {
  const root = makeRepo();
  try {
    readyToClose(root);
    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    // Dòng trắng phân cách bị pop rồi dựng lại bằng eol chung: mục đứng TRƯỚC
    // mất dấu kết thúc của chính nó. Mục INV-1 phải nằm CUỐI để chỗ này lộ ra.
    const lanCan = '## Mục CRLF' + CRLF + CRLF + 'Thân dùng CRLF.' + CRLF + CRLF;
    const cuaInv1 = pitfallsOf(root).split(CRLF).join(NL);
    const than = cuaInv1.slice(cuaInv1.indexOf('## INV-1'));
    writePitfalls(root, '# Bẫy đã từng sập' + NL + NL + lanCan + than);

    investigateCommand({ cwd: root, taskId: 'INV-1', close: true });

    assert.ok(pitfallsOf(root).includes(lanCan), 'mục đứng trước phải nguyên từng byte');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-35-EC14 a comment that merely mentions the HTML opener keeps its description', () => {
  const root = makeRepo();
  try {
    // Chốt phải NEO ở đầu dòng. Nhận `<!--` ở bất kỳ đâu thì một comment `//`
    // hay `--` chỉ NHẮC TỚI chuỗi đó cũng mất mô tả.
    writeScript(root, 'a.mjs', '// Lọc bỏ các khối <!-- --> khỏi file html' + NL);
    writeScript(root, 'b.sql', '-- Tìm chuỗi <!-- trong export' + NL);
    const r = scriptsCommand({ cwd: root });
    assert.match(r.output, /Lọc bỏ các khối/, r.output);
    assert.match(r.output, /Tìm chuỗi/, r.output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- CP-53: khối code trong Pitfall đi nguyên vào pitfalls.md, và ở yên đó ----

const F3 = String.fromCharCode(96).repeat(3);
const PITFALL_CU = '**Gặp:** 2026-09-05 · INV-1\n**Nguyên nhân:** deltaToken sống 30 ngày\n**Phòng tránh:** bắt 410 rồi full sync lại';
const CP53_PITFALL = [
  'Đừng tin heading.', '', F3 + 'md', '## Đây là ví dụ, không phải mục', F3, '',
  'Bài học: dòng ## trong code block không phải ranh giới.',
].join(NL);
const FENCED = FILLED.replace(PITFALL_CU, CP53_PITFALL);
const INV1_HEADING = '## INV-1: Lịch ngừng cập nhật';
const PITFALLS_HEADER = '# Bẫy đã từng sập' + NL + NL + 'Mỗi mục đến từ một điều tra đã đóng.' + NL;
const MUC_SAU = '## Mục sau' + NL + NL + 'Giữ nguyên.' + NL;

function dem(text, chuoi) {
  return text.split(chuoi).length - 1;
}

function dongBang(text, dong) {
  return text.split(/\r?\n/).filter((l) => l === dong).length;
}

function dongLai(root) {
  return investigateCommand({ cwd: root, taskId: 'INV-1', close: true });
}

// Kịch bản H3: đóng lần đầu, thêm một mục phía sau nếu cần, ghi lại byte, đóng
// lần hai. EC3 và EC4 là đúng kịch bản này với EOL và vị trí khác.
function cp53DongHaiLan(root, { eol = NL, hangXom = true } = {}) {
  assert.notEqual(FENCED, FILLED, 'fixture phải thật sự thay được mục Pitfall');
  readyToClose(root, 'INV-1', FENCED.split(NL).join(eol));
  const r1 = dongLai(root);
  assert.equal(r1.exitCode, 0, r1.output);
  if (hangXom) writePitfalls(root, pitfallsOf(root) + eol + MUC_SAU.split(NL).join(eol));
  const truoc = pitfallsOf(root);
  const r2 = dongLai(root);
  assert.equal(r2.exitCode, 0, r2.output);
  return { truoc, sau: pitfallsOf(root) };
}

test('CP-53-H3 re-closing an entry whose fence holds a ## line changes nothing', () => {
  const root = makeRepo();
  try {
    const { truoc, sau } = cp53DongHaiLan(root);

    assert.equal(sau, truoc, 'đóng lại phải cho ra đúng cùng một file');
    assert.equal(dongBang(sau, INV1_HEADING), 1);
    assert.equal(dem(sau, 'Bài học:'), 1, 'đoạn sau khối code phải vào mục, và chỉ một lần');
    assert.ok(sau.endsWith(NL + MUC_SAU), 'mục kế tiếp còn nguyên');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-53-E1 a Pitfall fence that never closes refuses the close and writes nothing', () => {
  const doc = FILLED.replace(PITFALL_CU, ['Đừng tin heading.', '', F3 + 'sh', 'rm -rf build'].join(NL));
  const dongMo = doc.split(NL).indexOf(F3 + 'sh') + 1;
  const dongLoi = new RegExp('dòng ' + dongMo + '(?!\\d)');

  const root = makeRepo();
  const coSan = makeRepo();
  try {
    readyToClose(root, 'INV-1', doc);
    const r = dongLai(root);
    assert.equal(r.exitCode, 1, r.output);
    const loi = r.output.split(/\r?\n/).find((l) => dongLoi.test(l));
    assert.ok(loi, `lỗi phải nêu dòng ${dongMo}:\n${r.output}`);
    assert.match(loi, /Pitfall/, 'lỗi phải nêu mục chứa khối chưa đóng');
    assert.equal(existsSync(path.join(root, ...PITFALL_FILE)), false, 'không được ghi pitfalls.md');
    assert.equal(readGate(root, 'INV-1', 'investigate'), null, 'không được ghi bản ghi gate');

    writePitfalls(coSan, PITFALLS_HEADER);
    readyToClose(coSan, 'INV-1', doc);
    assert.equal(dongLai(coSan).exitCode, 1);
    assert.equal(pitfallsOf(coSan), PITFALLS_HEADER, 'file có sẵn phải nguyên từng byte');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(coSan, { recursive: true, force: true });
  }
});

test('CP-53-E2 an unclosed fence in Bằng chứng is named, with no spurious empty-section error', () => {
  const doc = FILLED.replace(
    'GET /calendarView/delta → 410 Gone',
    ['GET /calendarView/delta → 410 Gone', '', F3, '{"error":"resyncRequired"}'].join(NL),
  );
  const dongMo = doc.split(NL).indexOf(F3) + 1;
  const root = makeRepo();
  try {
    readyToClose(root, 'INV-1', doc);
    const r = dongLai(root);

    assert.equal(r.exitCode, 1, r.output);
    const loi = r.output.split(/\r?\n/).find((l) => new RegExp('dòng ' + dongMo + '(?!\\d)').test(l));
    assert.ok(loi, `lỗi phải nêu dòng ${dongMo}:\n${r.output}`);
    assert.match(loi, /Bằng chứng/);
    assert.doesNotMatch(r.output, /Việc cần làm tiếp/, 'các mục khác vẫn đọc như cũ');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-53-EC1 re-closing repairs a stump that ends in an open fence without eating what follows', () => {
  const root = makeRepo();
  try {
    // Đúng thứ HEAD đã ghi: mục dừng ở dấu mở ```md. Mục Z có một khối cân
    // bằng mà dấu lẻ kia ghép được, và trong khối đó có dòng `## `.
    writePitfalls(root, PITFALLS_HEADER + [
      '', INV1_HEADING, '', 'Đừng tin heading.', '', F3 + 'md',
      '', '## Mục Y', '', 'Y phải còn.',
      '', '## Mục Z', '', 'Có code:', '', F3, '## trong Z', F3, '', 'Z phải còn.', '',
    ].join(NL));
    const truoc = pitfallsOf(root);

    readyToClose(root, 'INV-1', FENCED);
    const r = dongLai(root);
    assert.equal(r.exitCode, 0, r.output);

    const sau = pitfallsOf(root);
    assert.ok(sau.includes(INV1_HEADING + NL + NL + CP53_PITFALL + NL), 'mục INV-1 phải mang đủ thân mới');
    assert.equal(
      sau.slice(sau.indexOf('## Mục Y')),
      truoc.slice(truoc.indexOf('## Mục Y')),
      'Mục Y và Mục Z phải nguyên từng byte',
    );
    assert.equal(dongBang(sau, INV1_HEADING), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-53-EC2 editing the fenced line falls back to a visible tail, never a lost neighbour', () => {
  const root = makeRepo();
  try {
    const file = readyToClose(root, 'INV-1', FENCED);
    assert.equal(dongLai(root).exitCode, 0);
    writePitfalls(root, pitfallsOf(root) + NL + MUC_SAU);

    writeFileSync(file, FENCED.replace('## Đây là ví dụ, không phải mục', '## Ví dụ đã sửa'));
    const r = dongLai(root);
    assert.equal(r.exitCode, 0, r.output);

    const sau = pitfallsOf(root);
    assert.ok(sau.endsWith(NL + MUC_SAU), 'mục kế tiếp còn nguyên');
    assert.equal(dongBang(sau, '## Mục sau'), 1);
    assert.ok(dongBang(sau, '## Ví dụ đã sửa') >= 1, 'dòng mới phải có trong file');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-53-EC3 the same re-close in CRLF is byte-identical and adds no bare LF', () => {
  const root = makeRepo();
  try {
    writePitfalls(root, PITFALLS_HEADER.split(NL).join(CRLF));
    const { truoc, sau } = cp53DongHaiLan(root, { eol: CRLF });

    assert.equal(sau, truoc);
    assert.equal(sau.split(NL).length - sau.split(CRLF).length, 0, 'không được có LF trần');
    assert.equal(dongBang(sau, INV1_HEADING), 1);
    assert.equal(dem(sau, 'Bài học:'), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-53-EC4 the same re-close with the entry last in the file is byte-identical', () => {
  const root = makeRepo();
  try {
    const { truoc, sau } = cp53DongHaiLan(root, { hangXom: false });

    assert.equal(sau, truoc);
    assert.equal(dongBang(sau, INV1_HEADING), 1);
    assert.equal(dem(sau, 'Bài học:'), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-53-S1 an odd fence paired across entries cannot make a neighbour heading look hidden', () => {
  const root = makeRepo();
  try {
    // Dấu lẻ ở INV-1 ghép với dấu lẻ trong Mục Y, nên đọc fence thì `## Mục Y`
    // nằm trong khối. Thân mới cũng có dòng `## ` trong khối — nhưng không phải
    // dòng này, nên không có gì làm chứng cho việc nuốt nó.
    writePitfalls(root, PITFALLS_HEADER + [
      '', INV1_HEADING, '', 'Bản cũ.', '', F3,
      '', '## Mục Y', '', 'Y phải còn.', '', F3,
      '', '## Mục W', '', 'W phải còn.', '',
    ].join(NL));
    const truoc = pitfallsOf(root);

    readyToClose(root, 'INV-1', FENCED);
    const r = dongLai(root);
    assert.equal(r.exitCode, 0, r.output);

    const sau = pitfallsOf(root);
    assert.equal(
      sau.slice(sau.indexOf('## Mục Y')),
      truoc.slice(truoc.indexOf('## Mục Y')),
      'Mục Y phải nguyên từng byte',
    );
    assert.match(sau, /W phải còn\./);
    assert.match(sau, /Bài học:/, 'mục mới vẫn được ghi');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
