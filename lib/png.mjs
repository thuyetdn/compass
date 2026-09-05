import zlib from 'node:zlib';

// A minimal PNG reader for exactly what Playwright writes: 8-bit RGB or RGBA,
// no interlacing. Anything else is refused by name rather than guessed at.
// Compass stays dependency-free, and node:zlib already does the hard part.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A screenshot larger than this is not a screenshot. The cap exists so a
// corrupt or hostile header cannot ask for gigabytes before anything is read.
const MAX_PIXELS = 50_000_000;

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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Each scanline picks its own filter; undoing them needs the line above, so
// this walks top to bottom and keeps the previous line as it goes.
function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(height * stride);

  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;

    const target = out.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const left = i >= bytesPerPixel ? target[i - bytesPerPixel] : 0;
      const up = above ? above[i] : 0;
      const upLeft = above && i >= bytesPerPixel ? above[i - bytesPerPixel] : 0;

      switch (filter) {
        case 0: target[i] = line[i]; break;
        case 1: target[i] = (line[i] + left) & 0xff; break;
        case 2: target[i] = (line[i] + up) & 0xff; break;
        case 3: target[i] = (line[i] + ((left + up) >> 1)) & 0xff; break;
        case 4: target[i] = (line[i] + paeth(left, up, upLeft)) & 0xff; break;
        default: throw new Error(`PNG dùng filter ${filter} không hợp lệ`);
      }
    }
  }

  return out;
}

export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('File không phải PNG (thiếu chữ ký PNG ở đầu file)');
  }

  let offset = 8;
  let header = null;
  const data = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error(`PNG hỏng: chunk ${type} vượt quá cuối file`);

    if (type === 'IHDR') {
      header = {
        width: buffer.readUInt32BE(start),
        height: buffer.readUInt32BE(start + 4),
        bitDepth: buffer[start + 8],
        colourType: buffer[start + 9],
        interlace: buffer[start + 12],
      };
    } else if (type === 'IDAT') {
      data.push(buffer.subarray(start, end));
    } else if (type === 'IEND') {
      break;
    }

    offset = end + 4;
  }

  if (!header) throw new Error('PNG hỏng: không tìm thấy chunk IHDR');

  const { width, height, bitDepth, colourType, interlace } = header;

  if (width <= 0 || height <= 0) throw new Error('PNG khai kích thước không hợp lệ');
  if (width * height > MAX_PIXELS) {
    throw new Error(`PNG khai kích thước quá lớn: ${width}x${height}`);
  }
  if (bitDepth !== 8) throw new Error(`PNG ${bitDepth}-bit chưa hỗ trợ, chỉ đọc được 8-bit`);
  if (colourType !== 2 && colourType !== 6) {
    throw new Error(`PNG kiểu màu ${colourType} chưa hỗ trợ, chỉ đọc được RGB (2) và RGBA (6)`);
  }
  if (interlace !== 0) throw new Error('PNG interlaced chưa hỗ trợ');
  if (data.length === 0) throw new Error('PNG hỏng: không có dữ liệu ảnh');

  const channels = colourType === 6 ? 4 : 3;
  const raw = unfilter(zlib.inflateSync(Buffer.concat(data)), width, height, channels);

  // Normalise to RGBA so callers never branch on colour type.
  if (channels === 4) return { width, height, pixels: raw };

  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
    pixels[j] = raw[i];
    pixels[j + 1] = raw[i + 1];
    pixels[j + 2] = raw[i + 2];
    pixels[j + 3] = 255;
  }
  return { width, height, pixels };
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

// Used for the diff image written into evidence, so a person can look at what
// changed rather than trusting a percentage.
export function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0; // filter: none
    pixels.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
