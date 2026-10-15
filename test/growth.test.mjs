import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssertionError } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureGrowth, assertLinear, SCAN_GROWTH } from './helpers/growth.mjs';

// CP-55 — harness đo hình dạng mà CP-10-P1 dùng. Mọi quyết định của nó được
// kiểm bằng đồng hồ giả (`now`), nên kết quả là tất định. Chỉ E1 dùng đồng hồ
// thật, để chứng minh harness vẫn bắt được code bậc hai thật.

const { small: SMALL, large: LARGE, limit: LIMIT } = SCAN_GROWTH;

// Đồng hồ giả: mỗi lần `run` được gọi thì thời gian nhảy thêm đúng số ms kế
// tiếp trong kịch bản, kể cả lượt khởi động. `calls` ghi lại cỡ của từng lần gọi.
function scripted(durations) {
  let t = 0;
  let i = 0;
  const calls = [];
  return {
    calls,
    now: () => t,
    run: (n) => {
      calls.push(n);
      assert.ok(i < durations.length, `kịch bản hết sau ${durations.length} lần gọi`);
      t += durations[i++];
    },
  };
}

// [[nhỏ, lớn], …] → danh sách phẳng theo đúng thứ tự gọi.
const flat = (pairs) => pairs.flat();

// H1: mọi mẫu nhỏ 30 ms, mọi mẫu lớn 220 ms.
const LINEAR = Array.from({ length: 5 }, () => [30, 220]);

// Các cặp đo thật trên bản sao bậc hai (spec CP-55, bảng thứ hai).
const QUADRATIC = [[63, 2224], [67, 2326], [58, 2063], [58, 2035], [58, 2053]];

function measure(durations, extra = {}) {
  const clock = scripted(durations);
  const result = measureGrowth({ run: clock.run, now: clock.now, small: SMALL, large: LARGE, pairs: 5, warmup: 0, ...extra });
  return { clock, result };
}

test('CP-55-H1 a linear workload reads its true ratio and passes', () => {
  const { result } = measure(flat(LINEAR));
  assert.equal(result.ratio.toFixed(2), '7.33');
  assert.equal(result.ratio, 220 / 30);
  assert.doesNotThrow(() => assertLinear(result, LIMIT));
});

test('CP-55-H2 warm-up then interleaved pairs, in that order', () => {
  const clock = scripted(Array(12).fill(10));
  const result = measureGrowth({ run: clock.run, now: clock.now, small: SMALL, large: LARGE, warmup: 1, pairs: 5 });
  assert.deepEqual(clock.calls, [
    500, 4000, // khởi động
    500, 4000, 500, 4000, 500, 4000, 500, 4000, 500, 4000,
  ]);
  assert.equal(result.small.length, 5);
  assert.equal(result.large.length, 5);
  assert.equal(result.ratios.length, 5);
});

test('CP-55-V1 a span it cannot read, or no pairs, is refused before running anything', () => {
  const cases = [
    [{ small: 500, large: 500, pairs: 5 }, /large/],
    [{ small: 500, large: 1000, pairs: 5 }, /large/],
    [{ small: 500, large: 4000, pairs: 0 }, /pairs/],
  ];
  for (const [args, name] of cases) {
    let called = 0;
    assert.throws(
      () => measureGrowth({ run: () => { called++; }, now: () => 0, ...args }),
      (err) => err instanceof Error && name.test(err.message),
      JSON.stringify(args),
    );
    assert.equal(called, 0, `run bị gọi với ${JSON.stringify(args)}`);
  }
});

test('CP-55-V2 a small sample under 5 ms is refused, not turned into a ratio', () => {
  const durations = flat(Array.from({ length: 5 }, () => [1, 220]));
  let result;
  assert.throws(
    () => { result = measure(durations).result; },
    (err) => /nhỏ/.test(err.message) && /\b1 ms/.test(err.message),
  );
  assert.equal(result, undefined);
});

// Hình dạng lịch sử của `usedIn` mà pitfall CP-10 mô tả ("bỏ được thừa số đắt
// nhưng giữ vòng lồng"): với mỗi tên component, thử từng file — vòng lồng
// component × file. Các file nằm sẵn trong bộ nhớ, cùng dạng với cây nguồn của
// CP-10-P1, để chỉ còn số hạng bậc hai và đồng hồ đo đúng nó.
function inMemoryTree(n) {
  const names = [];
  const texts = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    names.push(`C${i}`);
    texts.push(`import { C${next} } from "./C${next}.jsx";\nexport function C${i}({ a, b }) { return null; }\n`);
  }
  return { names, texts };
}

function quadraticUsedIn({ names, texts }) {
  let used = 0;
  for (const name of names) {
    const clause = `{ ${name} }`;
    for (const text of texts) if (text.includes(clause)) used++;
  }
  return used;
}

test('CP-55-E1 real quadratic code, timed for real, still trips the limit', (t) => {
  const started = performance.now();
  const trees = { [SMALL]: inMemoryTree(SMALL), [LARGE]: inMemoryTree(LARGE) };
  // Fixture hỏng thì vòng lặp chạy rỗng; chốt trước khi tính giờ. Lượt này
  // cũng là lượt khởi động JIT, nên harness không chạy thêm lượt nào: một lượt
  // khởi động ở cỡ lớn tốn gần một giây, đủ đẩy case qua 5 giây khi máy bận.
  assert.equal(quadraticUsedIn(trees[SMALL]), SMALL);

  // Cùng cỡ, cùng ngưỡng với CP-10-P1, nhưng một cặp: mẫu lớn ở đây gần một
  // giây khi máy rỗi, và chạy chung suite thì hai cặp đã mất tới 4 giây. Một
  // cặp cũng là phía khó cho qua hơn — tỉ số nhỏ nhất chỉ có thể thấp đi khi
  // thêm cặp.
  const result = measureGrowth({
    run: (n) => quadraticUsedIn(trees[n]),
    small: SMALL,
    large: LARGE,
    warmup: 0,
    pairs: 1,
  });
  t.diagnostic(`tỉ số ${result.ratio.toFixed(1)}; nhỏ ${result.small.map((x) => x.toFixed(1)).join('/')} ms; `
    + `lớn ${result.large.map((x) => x.toFixed(0)).join('/')} ms`);

  assert.ok(result.ratio >= LIMIT, `stub bậc hai chỉ đọc ${result.ratio.toFixed(1)}`);
  assert.throws(() => assertLinear(result, LIMIT), (err) => err instanceof AssertionError && /bậc hai/.test(err.message));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5000, `E1 phải xong dưới 5 giây, mất ${elapsed.toFixed(0)} ms`);
});

test('CP-55-E2 an error from the measured code comes out unchanged', () => {
  const boom = new Error('fixture hỏng');
  assert.throws(
    () => measureGrowth({
      run: (n) => { if (n === LARGE) throw boom; },
      now: (() => { let t = 0; return () => (t += 10); })(),
      small: SMALL,
      large: LARGE,
      pairs: 5,
    }),
    (err) => err === boom && err.message === 'fixture hỏng',
  );
});

test('CP-55-E3 the measured quadratic pairs, replayed, are caught', () => {
  const { result } = measure(flat(QUADRATIC));
  assert.ok(result.ratio > 34, `tỉ số ${result.ratio}`);
  assert.throws(() => assertLinear(result, LIMIT), (err) => err instanceof AssertionError && /bậc hai/.test(err.message));
});

test('CP-55-EC1 one burst of load on a large sample does not move the verdict', () => {
  const pairs = LINEAR.map((p) => [...p]);
  pairs[1][1] = 660;
  const { result } = measure(flat(pairs));
  assert.equal(result.ratio.toFixed(2), '7.33');
  assert.equal(result.ratios[1], 22, 'cách cũ một mẫu mỗi cỡ sẽ đọc cặp này là 22');
  assert.doesNotThrow(() => assertLinear(result, LIMIT));
});

test('CP-55-EC2 load that starts mid-run slows both samples and keeps the ratio', () => {
  const pairs = LINEAR.map(([s, l], i) => (i >= 2 ? [s * 2.5, l * 2.5] : [s, l]));
  const { result } = measure(flat(pairs));
  assert.equal(result.ratio.toFixed(2), '7.33');
  assert.doesNotThrow(() => assertLinear(result, LIMIT));
});

test('CP-55-EC3 warm-up runs are not timed', () => {
  const warm = [90, 660]; // gấp ba lượt tính giờ
  const { result } = measure([...warm, ...flat(LINEAR)], { warmup: 1 });
  assert.equal(result.ratio.toFixed(2), '7.33');
  assert.deepEqual(result.small, [30, 30, 30, 30, 30]);
  assert.deepEqual(result.large, [220, 220, 220, 220, 220]);
});

test('CP-55-EC4 load on one small sample lowers the verdict but cannot hide a 35x shape', () => {
  const pairs = QUADRATIC.map((p) => [...p]);
  pairs[3][0] = 90;
  const { result } = measure(flat(pairs));
  assert.equal(result.ratio, 2035 / 90);
  assert.equal(result.ratio.toFixed(1), '22.6');
  assert.throws(() => assertLinear(result, LIMIT), (err) => err instanceof AssertionError && /bậc hai/.test(err.message));
});

// H3 — pitfall CP-10 từng khai tỉ số "vừa canh được vừa không chập chờn". CP-55
// đo được điều ngược lại, và chủ dự án duyệt sửa đúng câu đó. Mọi mục khác phải
// giữ nguyên từng byte so với gốc soi.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PITFALLS = '.knowledge/decided/pitfalls.md';
const BASE = 'f94ebdd';
const TARGET = '## CP-10: Ngưỡng thời gian tuyệt đối không canh được hiệu năng';

// So theo nội dung, không theo kiểu xuống dòng: checkout Windows có thể là CRLF.
const lf = (text) => text.replace(/\r\n/g, '\n');

// Tách theo tiêu đề `## `, giữ tiêu đề làm khoá. Hai mục cùng tiền tố "CP-10:"
// nhưng khác tiêu đề, nên khoá vẫn duy nhất.
function entries(text) {
  const out = new Map();
  for (const chunk of lf(text).split(/\n(?=## )/)) {
    if (!chunk.startsWith('## ')) continue;
    const heading = chunk.split('\n', 1)[0];
    assert.ok(!out.has(heading), `hai mục trùng tiêu đề: ${heading}`);
    out.set(heading, chunk.replace(/\n+$/, ''));
  }
  return out;
}

test('CP-55-H3 the CP-10 pitfall no longer promises a ratio cannot flake; nothing else moved', () => {
  const before = entries(execFileSync('git', ['show', `${BASE}:${PITFALLS}`], { cwd: ROOT, encoding: 'utf8' }));
  const after = entries(readFileSync(path.join(ROOT, PITFALLS), 'utf8'));

  assert.ok(before.has(TARGET) && after.has(TARGET), 'không thấy mục pitfall CP-10 cần sửa');
  for (const [heading, body] of before) {
    if (heading === TARGET) continue;
    assert.equal(after.get(heading), body, `mục "${heading}" đã bị đổi`);
  }

  const entry = after.get(TARGET);
  assert.doesNotMatch(entry, /không chập chờn/);
  const avoid = entry.split('\n').find((l) => l.startsWith('**Phòng tránh:**'));
  assert.ok(avoid, 'mục không còn dòng Phòng tránh');
  assert.match(avoid, /xen kẽ/);
  assert.match(avoid, /nhiều cặp/);
  assert.match(avoid, /tỉ số nhỏ nhất/);

  // Chỉ câu cuối của dòng Phòng tránh được sửa; mọi dòng khác và phần đầu dòng giữ nguyên.
  const old = before.get(TARGET).split('\n');
  const now = entry.split('\n');
  assert.equal(now.length, old.length);
  for (let i = 0; i < old.length; i++) {
    if (old[i].startsWith('**Phòng tránh:**')) {
      const kept = old[i].slice(0, old[i].indexOf('Tỉ số không phụ thuộc'));
      assert.ok(now[i].startsWith(kept), 'phần đầu dòng Phòng tránh đã bị đổi');
    } else {
      assert.equal(now[i], old[i]);
    }
  }
});
