import assert, { AssertionError } from 'node:assert';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// Một luật chung cho mọi ngân sách thời gian tuyệt đối trong suite (CP-62).
//
// Bản cũ đo một lần rồi `assert.ok(ms < N)`. Khi vài agent chạy suite cùng lúc,
// một lần khựng vài chục ms là đủ đỏ trên code không hề chậm: CP-42-P1 từng tốn
// 134 ms cho một việc 1 ms. Ở đây chạy tối đa `tries` lần và qua ở **lần đầu
// tiên dưới ngân sách**. Tải phải làm chậm mọi lần thử; một bản hồi quy thật thì
// chậm ở từng lần.
//
// Nghiêng về phía cho qua, có chủ đích, như CP-55: một bản hồi quy chỉ chậm
// *thỉnh thoảng* có thể lọt một lần chạy và bị lần sau bắt, còn một lần đỏ oan
// thì chặn `done` của mọi người. Mọi hồi quy mà các test này canh (ReDoS, vòng
// bậc hai, spawn từng file, treo) đều chậm ở mọi lần.
//
// File test không đọc đồng hồ; mọi phép đo đi qua đây (CP-62-V2 canh việc đó).

// Một lần thử dài từ mức này trở lên thì không thử lại: ReDoS tốn vài phút mà
// thử ba lần là tốn gấp ba. Sàn 2 giây để ngân sách nhỏ (50 ms) không bị cắt ở
// 500 ms — mức mà một lần khựng khi máy bận vẫn chạm tới được.
const NO_RETRY_FLOOR_MS = 2000;
const NO_RETRY_FACTOR = 10;

const fmt = (ms) => `${Math.round(ms * 10) / 10}`;

function checkArgs(name, { run, budgetMs, tries, now }) {
  if (typeof run !== 'function') throw new TypeError(`${name}: run phải là hàm, nhận ${typeof run}`);
  if (!(Number.isFinite(budgetMs) && budgetMs > 0)) {
    throw new RangeError(`${name}: budgetMs phải là số dương, nhận ${budgetMs}`);
  }
  if (!(Number.isInteger(tries) && tries >= 1)) {
    throw new RangeError(`${name}: tries phải là số nguyên ≥ 1, nhận ${tries}`);
  }
  if (typeof now !== 'function') throw new TypeError(`${name}: now phải là hàm, nhận ${typeof now}`);
}

const noRetryLine = (budgetMs) => Math.max(NO_RETRY_FACTOR * budgetMs, NO_RETRY_FLOOR_MS);

// Quyết định sau một lần thử: `pass`, `retry`, hoặc ném lỗi. `took` đã có lần này.
function verdict({ took, budgetMs, tries, label }) {
  const ms = took[took.length - 1];
  if (ms < budgetMs) return 'pass';
  const what = label ? `${label}: ` : '';
  const line = noRetryLine(budgetMs);
  if (ms >= line) {
    throw new AssertionError({
      message: `${what}lần thử ${took.length} mất ${fmt(ms)} ms, từ ${fmt(line)} ms `
        + `(max(${NO_RETRY_FACTOR} × ${fmt(budgetMs)}, ${NO_RETRY_FLOOR_MS})) trở lên thì không thử lại — `
        + `ngân sách ${fmt(budgetMs)} ms`,
      actual: took,
      expected: budgetMs,
      operator: '<',
    });
  }
  if (took.length < tries) return 'retry';
  throw new AssertionError({
    message: `${what}vượt ngân sách ${fmt(budgetMs)} ms ở cả ${took.length} lần thử: `
      + `${took.map(fmt).join(' / ')} ms`,
    actual: took,
    expected: budgetMs,
    operator: '<',
  });
}

// Chạy `run` tối đa `tries` lần, trả `{ value, tries, ms }` của lần đầu dưới
// `budgetMs` (so sánh `<`, như các assertion cũ). Lỗi từ chính `run` đi ra
// nguyên vẹn ngay lần đầu: fixture hỏng không phải chuyện thời gian.
export function withinBudget({ run, budgetMs, tries = 3, now = () => performance.now(), label } = {}) {
  checkArgs('withinBudget', { run, budgetMs, tries, now });
  const took = [];
  for (;;) {
    const t0 = now();
    const value = run();
    took.push(now() - t0);
    if (verdict({ took, budgetMs, tries, label }) === 'pass') return { value, tries: took, ms: took[took.length - 1] };
  }
}

export async function withinBudgetAsync({ run, budgetMs, tries = 3, now = () => performance.now(), label } = {}) {
  checkArgs('withinBudgetAsync', { run, budgetMs, tries, now });
  const took = [];
  for (;;) {
    const t0 = now();
    const value = await run();
    took.push(now() - t0);
    if (verdict({ took, budgetMs, tries, label }) === 'pass') return { value, tries: took, ms: took[took.length - 1] };
  }
}

// Chốt chống treo cho test mà ý nghĩa là "có trả về", không phải "trả về nhanh".
// Kiểm `ms` trước khi chạm vào promise, và dọn hẹn giờ khi promise xong, để tiến
// trình test không phải đợi hết hạn chót mới thoát.
export function withDeadline(promise, ms, label) {
  if (!(Number.isFinite(ms) && ms > 0)) {
    throw new RangeError(`withDeadline: ms phải là số dương, nhận ${ms}`);
  }
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label ?? 'promise'}: chưa xong sau ${ms} ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// Chờ bận đúng `ms` theo đồng hồ của helper, cho case cần code chậm thật.
export function busyWait(ms, now = () => performance.now()) {
  const t0 = now();
  while (now() - t0 < ms) { /* chờ */ }
}

// Thân của CP-4-P3: dừng một server hai lần, đợi `stop()` thật sự trả về thay vì
// ngủ một khoảng đoán trước. `stop()` chỉ resolve khi cây tiến trình đã chết
// (CP-8-P1 dựa vào đó), nên giấc ngủ cố định cũ là một lời đoán về `taskkill`
// — khi máy bận nó mất tới 1.5 giây, quá giấc 1.2 giây của P3.
export async function stopTwice(server, { deadlineMs = 20000 } = {}) {
  await withDeadline(server.stop(), deadlineMs, 'server.stop() lần một');
  assert.equal(server.exited, true, 'server.exited vẫn false sau lần stop() thứ nhất');
  await withDeadline(server.stop(), deadlineMs, 'server.stop() lần hai'); // không được ném
  assert.equal(server.exited, true, 'server.exited phải vẫn true sau lần stop() thứ hai');
}

// Thân của CP-8-H1. Nhịp 5000 ms và ngân sách 2500 ms: đợi một nhịp trước lần hỏi
// đầu tốn ≥ 5000 ms, gấp đôi ngân sách; lần hỏi đầu chậm nhất đo được khi máy bận
// là 218 ms, dưới ngân sách 11 lần. Bản cũ để hồi quy rơi đúng vào ngân sách 500 ms.
export function answersOnFirstProbe({
  waitForUrl, url, intervalMs = 5000, timeoutMs = 10000, budgetMs = 2500, tries = 3,
}) {
  return withinBudgetAsync({
    budgetMs,
    tries,
    label: `server sẵn sàng thì không được đợi hết một nhịp ${intervalMs} ms`,
    run: async () => {
      const result = await waitForUrl(url, { timeoutMs, intervalMs });
      assert.equal(result.ok, true, result.reason);
      return result;
    },
  });
}

// Dấu cwd mà dev server giả của CP-56-E1 ghi lúc khởi động. Thiếu nó thì nói rõ
// là server chưa kịp ghi trước khi bị giết sau `devTimeoutMs`, thay vì một ENOENT
// trần không ai đọc ra nghĩa.
export function readMarker(file, { devTimeoutMs }) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    throw new AssertionError({
      message: `dev server chưa ghi ${file} trước khi bị dừng sau devTimeoutMs ${devTimeoutMs} ms — `
        + 'nó khởi động chậm hơn hạn chờ, hoặc chạy sai thư mục',
    });
  }
}
