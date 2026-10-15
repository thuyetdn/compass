import { AssertionError } from 'node:assert';
import { performance } from 'node:perf_hooks';

// Đo **hình dạng** của một hàm theo cỡ dữ liệu, không đo tốc độ của nó.
//
// Bản cũ của CP-10-P1 lấy một mẫu cho mỗi cỡ rồi chia. Một đợt tải rơi vào mẫu
// lớn là đủ đỏ: code tuyến tính đọc 3.5 thành 8.7 khi hai agent khác đang chạy.
// Ở đây lấy nhiều cặp xen kẽ (nhỏ, lớn, nhỏ, lớn, …), mỗi cặp chia mẫu lớn cho
// mẫu nhỏ đo **ngay trước nó**, rồi lấy tỉ số **nhỏ nhất**. Muốn đẩy tỉ số đó
// qua ngưỡng thì tải phải rơi vào mẫu lớn của *mọi* cặp cùng lúc.
//
// Lấy nhỏ nhất là nghiêng về phía cho qua, có chủ đích: một mẫu nhỏ bị chậm
// hơn ~2.2× có thể cho code bậc hai qua *lần chạy đó*, và lần chạy yên tiếp theo
// bắt lại. Còn một lần đỏ oan thì chặn `done` của mọi người.

// Cỡ và ngưỡng mà CP-10-P1 dùng, để test của harness đo đúng cấu hình đó.
// 500→4000 là gấp tám lần file: tuyến tính đọc quanh 7–8, bậc hai quanh 35.
// Ngưỡng 16 nằm cách cả hai phía khoảng 2×.
export const SCAN_GROWTH = Object.freeze({
  small: 500,
  large: 4000,
  warmup: 1,
  pairs: 5,
  limit: 16,
});

// Cỡ và ngưỡng của CP-32-P1 (CP-62). Bản cũ lấy một mẫu cho mỗi cỡ, mẫu nhỏ 400
// truy vấn chỉ 2–4 ms, nên một lần khựng vài ms ở mẫu lớn đọc ra 72× trên code
// tuyến tính. Ở 3200 mẫu nhỏ đã 10–16 ms, trên sàn 5 ms. Tuyến tính đọc 6–7 dù
// máy rỗi hay bận; bản hồi quy lịch sử (`lastIndexOf` lùi về đầu file ở mỗi chú
// thích) đọc 47–50. Ngưỡng 16 nằm giữa.
export const QUERY_GROWTH = Object.freeze({
  small: 3200,
  large: 25600,
  warmup: 1,
  pairs: 5,
  limit: 16,
});

// Script .sql của CP-32-P1: mỗi truy vấn một dòng `-- @out:` và một `;` nằm trong
// chuỗi lẫn trong chú thích khối. CP-62-E4 dùng đúng hình dạng này để chứng minh
// cấu hình trên vẫn bắt được bản hồi quy.
export function queryScript(n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(`-- @out: INV-4-q${i}-work-0908.csv`);
    parts.push(`select ${i} from t where s = 'a;b' /* c ; d */;`);
  }
  return parts.join('\n');
}

// Dưới mức này thì độ phân giải đồng hồ và nhiễu lịch chạy lấn hết tín hiệu,
// và tỉ số không còn nghĩa gì. `Math.max(do1, 1)` cũ biến mẫu 0 ms thành một
// lần qua vô nghĩa — ở đây từ chối hẳn.
const MIN_SMALL_MS = 5;

// Gấp bốn là khoảng nhỏ nhất mà tuyến tính (~4×) và bậc hai (~16×) còn tách
// được nhau. Hẹp hơn thì hai đường chồng lên nhau trong nhiễu.
const MIN_SPAN = 4;

export function measureGrowth({ run, small, large, pairs, warmup = 0, now = () => performance.now() }) {
  if (typeof run !== 'function') throw new TypeError('measureGrowth: run phải là hàm');
  if (!(Number.isFinite(small) && small > 0)) {
    throw new RangeError(`measureGrowth: small phải là số dương, nhận ${small}`);
  }
  if (!(Number.isFinite(large) && large / small >= MIN_SPAN)) {
    throw new RangeError(`measureGrowth: large phải gấp ít nhất ${MIN_SPAN} lần small, nhận large=${large}, small=${small}`);
  }
  if (!(Number.isInteger(pairs) && pairs >= 1)) {
    throw new RangeError(`measureGrowth: pairs phải là số nguyên ≥ 1, nhận ${pairs}`);
  }
  if (!(Number.isInteger(warmup) && warmup >= 0)) {
    throw new RangeError(`measureGrowth: warmup phải là số nguyên ≥ 0, nhận ${warmup}`);
  }

  // Lượt khởi động không tính giờ: JIT, cache đĩa, cấp phát lần đầu.
  for (let i = 0; i < warmup; i++) {
    run(small);
    run(large);
  }

  const smallMs = [];
  const largeMs = [];
  const ratios = [];
  for (let i = 0; i < pairs; i++) {
    const t0 = now();
    run(small);
    const t1 = now();
    run(large);
    const t2 = now();

    const s = t1 - t0;
    const l = t2 - t1;
    if (!(s >= MIN_SMALL_MS)) {
      throw new RangeError(`measureGrowth: mẫu nhỏ (cỡ ${small}) chỉ đo được ${+s.toFixed(3)} ms, dưới ${MIN_SMALL_MS} ms — quá ngắn để lấy tỉ số`);
    }
    smallMs.push(s);
    largeMs.push(l);
    ratios.push(l / s);
  }

  return {
    sizes: { small, large },
    span: large / small,
    small: smallMs,
    large: largeMs,
    ratios,
    ratio: Math.min(...ratios),
  };
}

export function assertLinear(result, limit) {
  if (result.ratio >= limit) {
    throw new AssertionError({
      message: `gấp ${result.span} lần cỡ dữ liệu làm thời gian gấp ${result.ratio.toFixed(1)} lần `
        + `(tỉ số nhỏ nhất của ${result.ratios.length} cặp, ngưỡng ${limit}) — bậc hai`,
      actual: result.ratio,
      expected: limit,
      operator: '<',
    });
  }
}

// Vòng thử của CP-55-E1 và CP-62-E4: chứng minh code bậc hai thật vẫn bị
// `assertLinear` bắt khi đo bằng đồng hồ thật.
//
// Một lần đo duy nhất thì mẫu nhỏ bị tải làm chậm 3× là đủ kéo tỉ số xuống dưới
// ngưỡng, và case đỏ dù harness không mù. Ở đây đo tối đa `attempts` lần và qua
// ở lần đầu tiên vừa bị bắt vừa xong dưới `budgetMs`. Harness mù thật trước code
// bậc hai thì trượt cả ba lần, và lỗi liệt kê tỉ số cùng thời gian từng lần.
export function catchQuadratic({ measure, limit, attempts = 3, budgetMs = Infinity, now = () => performance.now() }) {
  if (typeof measure !== 'function') throw new TypeError('catchQuadratic: measure phải là hàm');
  if (!(Number.isInteger(attempts) && attempts >= 1)) {
    throw new RangeError(`catchQuadratic: attempts phải là số nguyên ≥ 1, nhận ${attempts}`);
  }
  const log = [];
  for (let i = 1; i <= attempts; i++) {
    const t0 = now();
    const result = measure();
    const ms = now() - t0;
    let error = null;
    try {
      assertLinear(result, limit);
    } catch (err) {
      if (!(err instanceof AssertionError)) throw err;
      error = err;
    }
    log.push({ ratio: result.ratio, ms, over: ms >= budgetMs });
    if (error && ms < budgetMs) return { attempt: i, result, ms, error, log };
  }
  const budget = Number.isFinite(budgetMs) ? ` và xong dưới ${budgetMs} ms` : '';
  throw new AssertionError({
    message: `sau ${attempts} lần thử, không lần nào vừa đạt ngưỡng ${limit}${budget}: `
      + log.map((a, i) => `lần ${i + 1} tỉ số ${a.ratio.toFixed(1)} trong ${a.ms.toFixed(0)} ms${a.over ? ' (quá giờ)' : ''}`).join('; '),
    actual: log.map((a) => a.ratio),
    expected: limit,
    operator: '>=',
  });
}
