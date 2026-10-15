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
