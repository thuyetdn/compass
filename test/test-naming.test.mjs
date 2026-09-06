// CP-18 — mọi test mang ID phải mang cả task id.
//
// CP-15 làm gate `test` phát hiện được khi một ID khớp nhiều test khác nhau.
// Hệ quả đã lường trước: 13 task cũ đều đỏ, vì 222 test dùng chung bộ ID `H1`,
// `V1`, `EC1`. Không task nào đóng được, nên Compass chưa từng chạy trọn đường
// trên chính nó.
//
// Suite này canh việc đó không quay lại: một test mới mang ID trần sẽ đỏ ngay,
// thay vì đợi tới lúc ai đó chạy gate của một task khác và thấy đụng độ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');

// Mọi tên test trong suite, kèm file chứa nó.
function moiTest() {
  const ra = [];
  for (const f of readdirSync(TEST_DIR).filter((x) => x.endsWith('.mjs'))) {
    const s = readFileSync(path.join(TEST_DIR, f), 'utf8');
    for (const m of s.matchAll(/^test\('([^']+)'/gm)) ra.push({ file: f, ten: m[1] });
  }
  return ra;
}

// Tên bắt đầu bằng một ID trần: `H1 …`, `test_H1_…`, `EC12 …`.
const ID_TRAN = /^(?:test_)?([A-Z]+[0-9]+)[_\s]/;
// Tên bắt đầu bằng task id: `CP-15-H1 …`, `T-1-H2 …`.
const CO_TIEN_TO = /^[A-Za-z]+-[0-9]+-/;

test('CP-18-H1 no test starts with a bare spec ID', () => {
  // ID trần là ID không thuộc về ai. Gate của task khác sẽ thấy nó và báo đụng
  // độ, hoặc tệ hơn: tính nó là ca của mình rồi báo xanh cho việc chưa ai làm.
  const tran = moiTest()
    .filter((t) => !CO_TIEN_TO.test(t.ten) && ID_TRAN.test(t.ten))
    .map((t) => `${t.file}: ${t.ten.slice(0, 60)}`);

  assert.deepEqual(tran, [],
    `còn ${tran.length} test mang ID trần — thêm tiền tố task id vào tên`);
});

test('CP-18-H2 every prefixed test names an ID after its task id', () => {
  // `CP-15-` rồi thôi thì tiền tố vô nghĩa: gate tìm ID chứ không tìm task id.
  const hong = moiTest()
    .filter((t) => CO_TIEN_TO.test(t.ten))
    .filter((t) => !/^[A-Za-z]+-[0-9]+-(?:test_)?[A-Z]+[0-9]+[_\s]/.test(t.ten))
    .map((t) => `${t.file}: ${t.ten.slice(0, 60)}`);

  assert.deepEqual(hong, [], 'tiền tố task id phải đi kèm một ID');
});

test('CP-18-H3 tests without an ID keep their plain names', () => {
  // 321 test không mang ID nào — chúng không gây đụng độ, nên không phải đổi.
  // Ép chúng mang tiền tố chỉ làm tên dài ra mà không thêm gì.
  const khongId = moiTest().filter((t) => !CO_TIEN_TO.test(t.ten) && !ID_TRAN.test(t.ten));
  assert.ok(khongId.length > 100,
    `chỉ còn ${khongId.length} test tên thường — có vẻ ai đó đã đổi tên hàng loạt quá tay`);
});

test('CP-18-V1 no task id owns the same ID twice', () => {
  // Hai test cùng task cùng ID vẫn là đụng độ — gate không biết chọn cái nào.
  // Đây là thứ đã bắt được 26 cặp trùng lúc đổi tên.
  const theo = new Map();
  for (const t of moiTest()) {
    const m = t.ten.match(/^([A-Za-z]+-[0-9]+)-(?:test_)?([A-Z]+[0-9]+)[_\s]/);
    if (!m) continue;
    const khoa = `${m[1]}-${m[2]}`;
    (theo.get(khoa) ?? theo.set(khoa, []).get(khoa)).push(`${t.file}: ${t.ten.slice(0, 50)}`);
  }
  const trung = [...theo.entries()].filter(([, ds]) => ds.length > 1);
  assert.deepEqual(trung.map(([k]) => k), [],
    `ID bị dùng hai lần trong cùng task: ${trung.map(([k, ds]) => `${k} (${ds.length})`).join(', ')}`);
});
