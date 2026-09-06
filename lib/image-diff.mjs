// Pixel comparison against an approved baseline. This catches what the ui gate
// cannot: text overflowing, elements overlapping, a layout that collapses at a
// narrow width — none of which any single CSS property reports.

const DIM = 0.15; // unchanged pixels fade into the background of the diff image

export function diffImages(baseline, actual, { channelTolerance = 0 } = {}) {
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      sizeMismatch: true,
      differentPixels: baseline.width * baseline.height,
      ratio: 1,
      reason: `kích thước khác nhau: baseline ${baseline.width}x${baseline.height}, hiện tại ${actual.width}x${actual.height}`,
      diffPixels: null,
    };
  }

  const total = baseline.width * baseline.height;

  // Buffer ngắn hơn kích thước khai là ảnh hỏng, không phải ảnh giống nhau.
  // Đọc quá cuối buffer cho `undefined`, rồi `Math.abs(NaN) > tol` là `false`,
  // nên mọi pixel thiếu bị tính là khớp — một baseline cụt sẽ báo xanh.
  for (const [ten, anh] of [['baseline', baseline], ['ảnh hiện tại', actual]]) {
    if (anh.pixels.length < total * 4) {
      throw new Error(
        `${ten} hỏng: khai ${anh.width}x${anh.height} (cần ${total * 4} byte) nhưng buffer chỉ có ${anh.pixels.length}`,
      );
    }
  }

  const diffPixels = Buffer.alloc(total * 4);
  let differentPixels = 0;

  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const changed =
      Math.abs(baseline.pixels[p] - actual.pixels[p]) > channelTolerance ||
      Math.abs(baseline.pixels[p + 1] - actual.pixels[p + 1]) > channelTolerance ||
      Math.abs(baseline.pixels[p + 2] - actual.pixels[p + 2]) > channelTolerance ||
      Math.abs(baseline.pixels[p + 3] - actual.pixels[p + 3]) > channelTolerance;

    if (changed) {
      differentPixels += 1;
      diffPixels[p] = 255;
      diffPixels[p + 1] = 0;
      diffPixels[p + 2] = 0;
      diffPixels[p + 3] = 255;
    } else {
      // Keep the picture readable: a person needs to see where on the page the
      // red marks sit, so the unchanged parts stay visible but faint.
      diffPixels[p] = 255 - (255 - actual.pixels[p]) * DIM;
      diffPixels[p + 1] = 255 - (255 - actual.pixels[p + 1]) * DIM;
      diffPixels[p + 2] = 255 - (255 - actual.pixels[p + 2]) * DIM;
      diffPixels[p + 3] = 255;
    }
  }

  return {
    sizeMismatch: false,
    differentPixels,
    ratio: total === 0 ? 0 : differentPixels / total,
    reason: null,
    diffPixels,
  };
}
