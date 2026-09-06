import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffImages } from '../lib/image-diff.mjs';

function image(width, height, fill = [255, 255, 255, 255]) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = fill[0];
    pixels[i + 1] = fill[1];
    pixels[i + 2] = fill[2];
    pixels[i + 3] = fill[3];
  }
  return { width, height, pixels };
}

test('CP-5-H3 two identical images differ in nothing', () => {
  const result = diffImages(image(4, 4), image(4, 4));
  assert.equal(result.differentPixels, 0);
  assert.equal(result.ratio, 0);
  assert.equal(result.sizeMismatch, false);
});

test('CP-5-H4 changing one pixel is counted as exactly one', () => {
  const baseline = image(4, 4);
  const actual = image(4, 4);
  actual.pixels[0] = 0; // one channel of one pixel

  const result = diffImages(baseline, actual);
  assert.equal(result.differentPixels, 1);
  assert.equal(result.ratio, 1 / 16);
});

test('CP-5-E1 images of different sizes count as wholly different', () => {
  const result = diffImages(image(4, 4), image(8, 4));
  assert.equal(result.sizeMismatch, true);
  assert.equal(result.ratio, 1);
  assert.match(result.reason, /4x4/);
  assert.match(result.reason, /8x4/);
});

test('CP-5-EC3 a 1x1 image does not divide by zero', () => {
  const a = image(1, 1);
  const b = image(1, 1, [0, 0, 0, 255]);
  const result = diffImages(a, b);
  assert.equal(result.differentPixels, 1);
  assert.equal(result.ratio, 1);
});

test('a pixel differing only in alpha still counts', () => {
  const baseline = image(2, 1);
  const actual = image(2, 1);
  actual.pixels[3] = 0;
  assert.equal(diffImages(baseline, actual).differentPixels, 1);
});

test('the diff image marks changed pixels and dims the rest', () => {
  const baseline = image(2, 1);
  const actual = image(2, 1);
  actual.pixels[0] = 0;

  const result = diffImages(baseline, actual);
  assert.equal(result.diffPixels.length, 2 * 1 * 4);
  // Changed pixel is painted red so a person can spot it.
  assert.deepEqual([...result.diffPixels.slice(0, 4)], [255, 0, 0, 255]);
  // Unchanged pixel is kept but dimmed, not blanked.
  assert.notDeepEqual([...result.diffPixels.slice(4, 8)], [255, 0, 0, 255]);
});

test('a tolerance per channel absorbs anti-aliasing noise', () => {
  const baseline = image(2, 1, [100, 100, 100, 255]);
  const actual = image(2, 1, [102, 100, 100, 255]);
  assert.equal(diffImages(baseline, actual, { channelTolerance: 3 }).differentPixels, 0);
  assert.equal(diffImages(baseline, actual, { channelTolerance: 1 }).differentPixels, 2);
});

test('ratio is the share of pixels that changed, not of bytes', () => {
  const baseline = image(10, 10);
  const actual = image(10, 10);
  for (let i = 0; i < 5; i++) actual.pixels[i * 4] = 0;
  const result = diffImages(baseline, actual);
  assert.equal(result.differentPixels, 5);
  assert.equal(result.ratio, 0.05);
});

test('CP-5-EC1 a difference exactly at the tolerance does not count', () => {
  // Biên phải rõ: đúng bằng ngưỡng thì chưa vượt. Không kiểm thì một ảnh lệch
  // đúng ngưỡng lúc đỏ lúc xanh tuỳ cách viết dấu so sánh.
  const a = image(4, 4, [100, 100, 100, 255]);
  const b = image(4, 4, [110, 100, 100, 255]);
  const r = diffImages(a, b, { channelTolerance: 10 });
  assert.equal(r.differentPixels, 0, 'lệch đúng bằng ngưỡng thì không tính là khác');
});

test('CP-5-EC2 one step past the tolerance counts every pixel', () => {
  const a = image(4, 4, [100, 100, 100, 255]);
  const b = image(4, 4, [111, 100, 100, 255]);
  const r = diffImages(a, b, { channelTolerance: 10 });
  assert.equal(r.differentPixels, 16, 'quá ngưỡng một bậc là khác, cả 16 pixel');
});

test('CP-5-E2 a baseline whose pixel buffer is truncated is reported, not read past', () => {
  // Baseline hỏng: khai 4x4 nhưng buffer chỉ đủ một hàng. Đọc bừa thì được số
  // rác; phải báo lỗi.
  const a = image(4, 4);
  const hong = { width: 4, height: 4, pixels: Buffer.alloc(16) };
  assert.throws(() => diffImages(hong, a), /kích thước|buffer|pixel/i,
    'buffer thiếu so với kích thước khai là baseline hỏng');
});
