// CP-62 — test đo giờ không được đỏ chỉ vì máy bận, và không được mù trước code chậm thật.
//
// Hai hình dạng hỏng, hai cách sửa. Hình dạng tăng trưởng (CP-32-P1) chuyển sang
// harness của CP-55. Ngân sách tuyệt đối đi qua `withinBudget`: thử tối đa ba lần,
// qua ở lần đầu tiên dưới ngân sách. Tải phải làm chậm *mọi* lần thử mới đỏ được,
// còn một bản hồi quy thật thì chậm ở từng lần.
//
// Quyết định của helper được kiểm bằng đồng hồ giả (`now`), như CP-55 đã làm, nên
// kết quả là tất định. Chỉ E3, E4, E5, E6 dùng đồng hồ thật.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssertionError } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  withinBudget, withinBudgetAsync, withDeadline, busyWait, stopTwice, readMarker, answersOnFirstProbe,
} from './helpers/timing.mjs';
import { measureGrowth, catchQuadratic, QUERY_GROWTH, queryScript } from './helpers/growth.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');

// Đồng hồ giả: mỗi lần `run` được gọi thì thời gian nhảy thêm đúng số ms kế tiếp
// trong kịch bản. `calls` đếm số lần gọi.
function scripted(durations) {
  let t = 0;
  let i = 0;
  const state = {
    calls: 0,
    now: () => t,
    run: () => {
      state.calls++;
      assert.ok(i < durations.length, `kịch bản hết sau ${durations.length} lần gọi`);
      t += durations[i++];
      return 'xong';
    },
  };
  return state;
}

// Kết quả giả của `measureGrowth`, đủ trường để `assertLinear` đọc.
function fakeGrowth(ratio) {
  return { sizes: { small: 500, large: 4000 }, span: 8, small: [10], large: [10 * ratio], ratios: [ratio], ratio };
}

// Vòng thử của CP-55-E1, nạp kết quả giả: mỗi lần đo trả tỉ số kế tiếp và đẩy
// đồng hồ giả thêm đúng số ms của lần đó.
function scriptedAttempts(attempts) {
  let t = 0;
  let i = 0;
  const state = {
    calls: 0,
    now: () => t,
    measure: () => {
      state.calls++;
      assert.ok(i < attempts.length, `kịch bản hết sau ${attempts.length} lần thử`);
      const { ratio, ms } = attempts[i++];
      t += ms;
      return fakeGrowth(ratio);
    },
  };
  return state;
}

const count = (text, needle) => text.split(needle).length - 1;

// ---------------------------------------------------------------- Happy

test('CP-62-H1 a first try under budget returns at once', () => {
  const s = scripted([3]);
  const r = withinBudget({ run: s.run, budgetMs: 200, tries: 3, now: s.now });
  assert.equal(s.calls, 1);
  assert.deepEqual(r.tries, [3]);
  assert.equal(r.value, 'xong');
});

test('CP-62-H2 withDeadline hands back the value and leaves no timer behind', async () => {
  // Hẹn giờ còn treo thì tiến trình test phải đợi hết một giây mới thoát được.
  const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const before = timers();
  assert.equal(await withDeadline(Promise.resolve(42), 1000, 'x'), 42);
  assert.equal(await withDeadline(delay(20, 7), 1000, 'y'), 7);
  assert.equal(timers(), before, 'hẹn giờ của withDeadline vẫn còn treo');
});

test('CP-62-H3 stopTwice stops a healthy server twice and sees it dead each time', async () => {
  const seen = [];
  let exited = false;
  const server = {
    calls: 0,
    get exited() { seen.push({ after: server.calls, exited }); return exited; },
    stop() {
      server.calls++;
      return delay(30).then(() => { exited = true; });
    },
  };
  await stopTwice(server);
  assert.equal(server.calls, 2);
  for (const call of [1, 2]) {
    const reads = seen.filter((s) => s.after === call);
    assert.ok(reads.length > 0, `không đọc exited sau lần stop ${call}`);
    assert.ok(reads.every((s) => s.exited === true), `exited chưa true sau lần stop ${call}`);
  }
});

// ---------------------------------------------------------------- Validation

test('CP-62-V1 a bad budget, try count or run is refused before anything runs', () => {
  let calls = 0;
  const run = () => { calls++; };
  const cases = [
    [{ run, budgetMs: 0 }, /budgetMs/],
    [{ run, budgetMs: -5 }, /budgetMs/],
    [{ run, budgetMs: NaN }, /budgetMs/],
    [{ run, budgetMs: 200, tries: 0 }, /tries/],
    [{ run, budgetMs: 200, tries: 1.5 }, /tries/],
    [{ run: 'không phải hàm', budgetMs: 200 }, /run/],
  ];
  for (const [args, name] of cases) {
    assert.throws(() => withinBudget(args), name, `nhận ${JSON.stringify(args)} mà không báo`);
  }
  assert.equal(calls, 0, 'run không được chạy khi tham số sai');
});

// Tên của 21 test mà task này sửa, chép đúng từng byte từ a369838. Bằng chứng
// của task khác đếm chúng theo tên, nên đổi một chữ là task đó mất bằng chứng.
const EDITED = [
  'CP-4-P2 stopping a dev server leaves no process behind',
  'CP-4-P3 stopping a server twice is harmless',
  'CP-8-H1 a server already up answers on the first probe',
  'CP-32-P1 parse cost stays linear in query count',
  'CP-42-P1 fifty props, half of them nested, scan in under 200 ms',
  'CP-52-P1 a first commit of 2000 small files is collected in under 5 s',
  'CP-56-P1 each repo is walked once, not the root twice',
  "CP-56-E1 the dev server starts in fe, and a dead one fails ui with fe's command",
  'CP-40-P2 scanning this repo end to end stays under 3 s',
  'CP-55-E1 real quadratic code, timed for real, still trips the limit',
  'CP-56-P3 done reads six per-repo slots over 500 files quickly',
  'CP-13-P2 a single-repo project pays nothing for the multi-repo path',
  'CP-46-P1 two hundred staged files collect in under five seconds',
  'CP-40-P1 a 300-file diff with 20k added lines scans under 500 ms',
  'CP-45-E1 two hundred spaces alone parse quickly and do not throw',
  'CP-45-S1 forty spaces before a non-matching line cost almost nothing',
  'CP-45-P1 a file whose hypothesis lines carry 16-space indents parses fast',
  'CP-43-P1 two thousand lines, half holding a #, scan in under 200 ms',
  'CP-39-P2 a 2000-line spec with the new keyword parses in under 50 ms',
  'CP-39-P1 scanning every in-scope file takes under 500 ms',
  'CP-3-S1 a catastrophic pattern is cut off rather than hanging',
];

// Ba dạng đồng hồ tìm thấy hôm nay. Viết bằng regex để chính file này không khớp.
const CLOCK = /\bDate\.now\(\)|\bperformance\.now\(\)|\bprocess\.hrtime\b/g;

test('CP-62-V2 no test file reads a clock, and the 21 edited test names are unchanged', () => {
  const files = readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.mjs'));
  const clocks = [];
  const names = [];
  for (const f of files) {
    const src = readFileSync(path.join(TEST_DIR, f), 'utf8');
    for (const m of src.matchAll(/^test\('((?:[^'\\]|\\.)*)'/gm)) names.push(m[1].replace(/\\(.)/g, '$1'));

    // Ngoại lệ duy nhất: vòng chờ bận trong chuỗi script tiến trình con của
    // CP-13-P1. Đồng hồ đó chạy trong tiến trình con, không trong tiến trình test.
    const cp13p1 = f === 'multi-repo.test.mjs'
      ? (() => {
        const start = src.indexOf("test('CP-13-P1 ");
        const end = src.indexOf('\ntest(', start + 1);
        return start === -1 ? null : [start, end === -1 ? src.length : end];
      })()
      : null;
    for (const m of src.matchAll(CLOCK)) {
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      const inChildScript = cp13p1 && m.index > cp13p1[0] && m.index < cp13p1[1]
        && src.slice(lineStart, m.index).trimStart().startsWith('`');
      if (!inChildScript) {
        const line = src.slice(0, m.index).split('\n').length;
        clocks.push(`${f}:${line}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(clocks, [], 'đo giờ phải đi qua test/helpers/');

  for (const name of EDITED) {
    const n = names.filter((x) => x === name).length;
    assert.equal(n, 1, `"${name}" xuất hiện ${n} lần, phải đúng 1 lần và giữ nguyên từng byte`);
  }
});

test('CP-62-V3 withDeadline refuses a zero or negative ms without touching the promise', () => {
  let touched = 0;
  const thenable = { then() { touched++; } };
  assert.throws(() => withDeadline(thenable, 0, 'x'), /\bms\b/);
  assert.throws(() => withDeadline(thenable, -5, 'x'), /\bms\b/);
  assert.equal(touched, 0, 'promise không được await khi ms sai');
});

// ---------------------------------------------------------------- Error

test('CP-62-E1 every try over budget fails and names each try', () => {
  const s = scripted([250, 250, 250]);
  assert.throws(
    () => withinBudget({ run: s.run, budgetMs: 200, tries: 3, now: s.now }),
    (err) => err instanceof AssertionError && /200/.test(err.message) && count(err.message, '250') === 3,
  );
  assert.equal(s.calls, 3);
});

test('CP-62-E2 a try past the no-retry line fails after that one try', () => {
  const s = scripted([2500, 3, 3]);
  assert.throws(
    () => withinBudget({ run: s.run, budgetMs: 200, tries: 3, now: s.now }),
    (err) => err instanceof AssertionError && /2500/.test(err.message) && /không thử lại/.test(err.message),
  );
  assert.equal(s.calls, 1, 'quá ngưỡng không-thử-lại thì không được chạy thêm');
});

test('CP-62-E3 real code that is slow on every try fails on the real clock', () => {
  // Bọc cả case trong một lần thử 1 giây: chính lời hứa "xong dưới 1 s" cũng
  // phải đo bằng helper, vì file test không được đọc đồng hồ.
  const { value: err } = withinBudget({
    budgetMs: 1000,
    tries: 1,
    run: () => {
      try {
        withinBudget({ run: () => busyWait(30), budgetMs: 10, tries: 3 });
      } catch (e) {
        return e;
      }
      return null;
    },
  });
  assert.ok(err instanceof AssertionError, `phải ném AssertionError, nhận ${err}`);
  assert.equal(err.actual.length, 3);
  for (const ms of err.actual) assert.ok(ms >= 30, `một lần thử chỉ đo được ${ms} ms`);
});

// Mỏ neo của E4. Dòng `const before = text.slice(lineStart, i);` có hai lần
// trong lib/query-outputs.mjs: một ở nhánh `--`, một ở nhánh `/*`. Bản hồi quy
// lịch sử nằm ở nhánh `--`, nên mỏ neo kèm dòng chú thích ngay trên nó để chỉ
// khớp đúng một chỗ. Chỉ dòng code được thay.
const ANCHOR_CONTEXT = '      // made parsing quadratic (P1 caught it at 154x instead of 16x).\n';
const ANCHOR_LINE = '      const before = text.slice(lineStart, i);';
const REGRESSED_LINE = '      const before = text.slice(Math.max(text.lastIndexOf(LF, i), text.lastIndexOf(CR, i)) + 1, i);';

test('CP-62-E4 the historical quadratic parser still trips QUERY_GROWTH on the real clock', async () => {
  const source = readFileSync(path.join(ROOT, 'lib', 'query-outputs.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const anchor = ANCHOR_CONTEXT + ANCHOR_LINE;
  const found = count(source, anchor);
  assert.equal(found, 1,
    `mỏ neo của bản hồi quy tìm thấy ${found} lần trong lib/query-outputs.mjs, cần đúng 1 — `
    + 'thay không được mà vẫn chạy tiếp là sed không thay được mà vẫn báo test xanh');
  const regressed = source.replace(anchor, ANCHOR_CONTEXT + REGRESSED_LINE);
  assert.notEqual(regressed, source, 'bản sao không khác bản gốc');

  const dir = mkdtempSync(path.join(tmpdir(), 'compass-cp62-'));
  const copy = path.join(dir, 'query-outputs.mjs');
  writeFileSync(copy, regressed);
  assert.equal(readFileSync(copy, 'utf8'), regressed);
  assert.notEqual(readFileSync(copy, 'utf8'), source, 'file ghi ra không khác bản gốc');
  const { parseQueryOutputs } = await import(pathToFileURL(copy).href);

  // 800→6400 thay vì 3200→25600: mẫu lớn của bản hồi quy ở 25600 mất 12 giây.
  // Cùng khoảng gấp 8, và khi số hạng bậc hai đã trội thì tỉ số không phụ thuộc cỡ.
  const SMALL = 800;
  const LARGE = 6400;
  const sqls = { [SMALL]: queryScript(SMALL), [LARGE]: queryScript(LARGE) };
  assert.equal(parseQueryOutputs(sqls[SMALL], 'INV-4').queries.length, SMALL, 'bản sao phải đọc đủ 800 truy vấn');

  const caught = catchQuadratic({
    measure: () => measureGrowth({
      run: (n) => parseQueryOutputs(sqls[n], 'INV-4'),
      small: SMALL,
      large: LARGE,
      warmup: 0,
      pairs: 1,
    }),
    limit: QUERY_GROWTH.limit,
    attempts: 3,
  });
  assert.match(caught.error.message, /bậc hai/);
});

test('CP-62-E5 stopTwice fails loudly against three broken servers', async () => {
  await withinBudgetAsync({
    budgetMs: 2000,
    tries: 1,
    run: async () => {
      // (a) stop() trả về nhưng tiến trình vẫn sống.
      await assert.rejects(
        stopTwice({ exited: false, stop: async () => {} }),
        (err) => err instanceof AssertionError && /exited/.test(err.message),
      );

      // (b) lần stop thứ hai ném lỗi: lỗi đó đi ra nguyên vẹn.
      const boom = new Error('lần hai');
      let calls = 0;
      const twice = {
        exited: false,
        async stop() {
          calls++;
          if (calls === 2) throw boom;
          twice.exited = true;
        },
      };
      await assert.rejects(stopTwice(twice), (err) => err === boom);

      // (c) stop() không bao giờ trả về: hạn chót 300 ms cắt nó.
      await assert.rejects(
        stopTwice({ exited: false, stop: () => new Promise(() => {}) }, { deadlineMs: 300 }),
        /300/,
      );
    },
  });
});

test('CP-62-E6 a probe that waits one interval first fails all three tries', async () => {
  // Bản hồi quy mà CP-8-H1 canh: đợi hết một nhịp rồi mới hỏi lần đầu. +2 ms vì
  // libuv đếm hẹn giờ theo ms đã làm tròn xuống, nên hẹn 400 có thể nổ ở 399.x.
  const sleepy = async (url, { intervalMs }) => { await delay(intervalMs + 2); return { ok: true }; };
  const prompt = async () => ({ ok: true });
  const opts = { url: 'http://127.0.0.1:9/', intervalMs: 400, timeoutMs: 2000, budgetMs: 200, tries: 3 };

  await assert.rejects(
    answersOnFirstProbe({ waitForUrl: sleepy, ...opts }),
    (err) => err instanceof AssertionError && err.actual.length === 3 && err.actual.every((ms) => ms >= 400),
  );
  const ok = await answersOnFirstProbe({ waitForUrl: prompt, ...opts });
  assert.equal(ok.value.ok, true);
});

test('CP-62-E7 an attempt loop fed linear results never reports the stub as caught', () => {
  const s = scriptedAttempts([{ ratio: 7.0, ms: 900 }, { ratio: 7.0, ms: 900 }, { ratio: 7.0, ms: 900 }]);
  let returned = null;
  assert.throws(
    () => { returned = catchQuadratic({ measure: s.measure, limit: 16, attempts: 3, budgetMs: 5000, now: s.now }); },
    (err) => err instanceof AssertionError && count(err.message, '7.0') === 3 && !/bậc hai/.test(err.message),
  );
  assert.equal(returned, null);
  assert.equal(s.calls, 3);
});

// ---------------------------------------------------------------- Edge

test('CP-62-EC1 one stall does not fail the budget', () => {
  const s = scripted([600, 3, 3]);
  const r = withinBudget({ run: s.run, budgetMs: 200, tries: 3, now: s.now });
  assert.equal(s.calls, 2);
  assert.deepEqual(r.tries, [600, 3]);
});

test('CP-62-EC2 a try exactly on the budget is over it', () => {
  const s = scripted([200, 200, 200]);
  assert.throws(() => withinBudget({ run: s.run, budgetMs: 200, tries: 3, now: s.now }), AssertionError);
  assert.equal(s.calls, 3);
});

test('CP-62-EC3 an error from run comes out unchanged and is not retried', async () => {
  const boom = new Error('fixture hỏng');
  let calls = 0;
  await assert.rejects(
    withinBudgetAsync({ run: async () => { calls++; throw boom; }, budgetMs: 200, tries: 3 }),
    (err) => err === boom,
  );
  assert.equal(calls, 1);
});

test('CP-62-EC4 a missing dev-server marker names the path and the timeout, not ENOENT', () => {
  const missing = path.join(tmpdir(), 'compass-cp62-khong-co', 'cwd.txt');
  assert.throws(
    () => readMarker(missing, { devTimeoutMs: 3000 }),
    (err) => err instanceof AssertionError && err.message.includes(missing) && /3000/.test(err.message)
      && !/ENOENT/.test(err.message),
  );
});

test('CP-62-EC5 a loaded small sample costs one attempt, not the case', () => {
  const s = scriptedAttempts([{ ratio: 12.0, ms: 900 }, { ratio: 48.0, ms: 900 }, { ratio: 48.0, ms: 900 }]);
  const r = catchQuadratic({ measure: s.measure, limit: 16, attempts: 3, budgetMs: 5000, now: s.now });
  assert.equal(r.attempt, 2);
  assert.equal(s.calls, 2, 'đã bắt được thì không chạy lần thứ ba');
});

test('CP-62-EC6 a catch that took over 5 s does not count', () => {
  const s = scriptedAttempts([{ ratio: 48.0, ms: 5200 }, { ratio: 48.0, ms: 900 }]);
  const r = catchQuadratic({ measure: s.measure, limit: 16, attempts: 3, budgetMs: 5000, now: s.now });
  assert.equal(r.attempt, 2);
  assert.equal(s.calls, 2);
});
