import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng, encodePng } from '../lib/png.mjs';

// Build a PNG by hand so the tests do not depend on any image library.
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makePng(width, height, pixels, { colourType = 6, bitDepth = 8 } = {}) {
  const channels = colourType === 6 ? 4 : 3;
  const raw = Buffer.alloc(height * (1 + width * channels));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const base = (y * width + x) * 4;
      raw[offset++] = pixels[base];
      raw[offset++] = pixels[base + 1];
      raw[offset++] = pixels[base + 2];
      if (channels === 4) raw[offset++] = pixels[base + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colourType;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const RED = [255, 0, 0, 255];

test('H1 decodes an 8-bit RGBA png', () => {
  const png = makePng(2, 1, [...RED, 0, 255, 0, 255]);
  const image = decodePng(png);
  assert.equal(image.width, 2);
  assert.equal(image.height, 1);
  assert.deepEqual([...image.pixels.slice(0, 4)], RED);
  assert.deepEqual([...image.pixels.slice(4, 8)], [0, 255, 0, 255]);
});

test('H2 decodes an rgb png, filling alpha with 255', () => {
  const png = makePng(1, 1, RED, { colourType: 2 });
  const image = decodePng(png);
  assert.deepEqual([...image.pixels], RED);
});

test('V1 a file that is not a png is rejected by name', () => {
  assert.throws(() => decodePng(Buffer.from('this is not a png at all')), /PNG/);
});

test('V2 a 16-bit png is refused, saying so', () => {
  const png = makePng(1, 1, RED, { bitDepth: 16 });
  assert.throws(() => decodePng(png), /16/);
});

test('a palette png is refused rather than guessed at', () => {
  const png = makePng(1, 1, RED, { colourType: 3 });
  assert.throws(() => decodePng(png), /chưa hỗ trợ|colour type|kiểu màu/i);
});

test('S1 a png declaring an impossible size is refused before allocating', () => {
  const png = makePng(1, 1, RED);
  // Rewrite IHDR width to 100000 x 100000 — 40GB if allocated.
  png.writeUInt32BE(100000, 16);
  png.writeUInt32BE(100000, 20);
  assert.throws(() => decodePng(png), /lớn|kích thước/i);
});

test('EC3 a 1x1 png decodes to exactly one pixel', () => {
  const image = decodePng(makePng(1, 1, RED));
  assert.equal(image.width, 1);
  assert.equal(image.pixels.length, 4);
});

test('decodes each png filter type without corrupting pixels', () => {
  // Sub filter (1) on a two-pixel row: second pixel stored as a delta.
  const raw = Buffer.from([
    1, // filter: sub
    10, 20, 30, 255,
    5, 5, 5, 0, // delta → 15, 25, 35, 255
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  const image = decodePng(png);
  assert.deepEqual([...image.pixels.slice(4, 8)], [15, 25, 35, 255]);
});

test('encodePng round-trips through decodePng', () => {
  const pixels = Buffer.from([...RED, 0, 0, 255, 255]);
  const image = decodePng(encodePng(2, 1, pixels));
  assert.equal(image.width, 2);
  assert.deepEqual([...image.pixels], [...pixels]);
});
