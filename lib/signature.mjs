import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from './hash.mjs';
import { saltPath, compassDir } from './paths.mjs';

// Nội dung mặc định của `.compass/.gitignore`, viết đúng một chỗ.
//
// `.salt`: salt lên git thì ai clone repo cũng ký được bản ghi gate, và chữ ký
// hết tác dụng.
//
// `data/` chứa kết quả query, log, dump — điều tra thật phải chạy query
// production, và cái trả về là email với tên khách hàng. Che sẵn thay vì đợi
// người dùng nhớ; quên một lần là dữ liệu khách nằm trên repo.
//
// Không che `output/` và `evidence/`: sản phẩm là thứ mang đi dùng và có khi
// muốn commit, còn bằng chứng phải review được. Chỉ `data/` là dữ liệu thô.
// `data/` không có dấu `/` đầu nên git khớp ở mọi cấp — che được
// `.compass/INV-1/data/` lẫn thư mục sâu hơn, mà không đụng `output/`.
//
// `review-brief.md`: bản sao spec, diff và ngữ cảnh mà `compass review` sinh lại
// mỗi lần code đổi. Đồ dùng một lần, không phải bằng chứng — `findings.json` mới
// là bằng chứng, và nó vẫn được theo dõi (CP-80). Cũng không có `/`, nên che
// được brief ở mọi task.
export const COMPASS_GITIGNORE = '.salt\ndata/\nreview-brief.md\n';

// Mọi bản mặc định `init` từng viết, cũ nhất trước. Gặp đúng một trong số này
// thì nâng; còn lại là file của người dùng.
const MAC_DINH_CU = ['.salt', '.salt\ndata/'];

// File `init` bản cũ viết — một bản trong `MAC_DINH_CU`, LF, CRLF hay không
// xuống dòng cuối (autocrlf đưa nó ra working tree thành CRLF). Đổi CRLF về LF,
// bỏ đúng một dấu xuống dòng cuối rồi so bằng: thêm một dòng trống, một comment,
// một luật nào nữa là file của người dùng, kể cả khi nó thiếu `data/`.
function laFileCu(text) {
  return MAC_DINH_CU.includes(text.replace(/\r\n/g, '\n').replace(/\n$/, ''));
}

// Những dòng của mặc định mà file cũ chưa có, để `init` nói đúng cái vừa thêm.
function dongThem(text) {
  const co = new Set(text.split(/\r?\n/));
  return COMPASS_GITIGNORE.split('\n').filter((l) => l !== '' && !co.has(l));
}

// `init` và `getSalt` cùng gọi hàm này. Hai nơi từng viết hai nội dung khác
// nhau, và `init` — bước đầu tiên theo tài liệu — luôn chạy trước, nên dự án
// mở đúng cách lại là dự án không che `data/` (CP-59). Một hằng, một hàm ghi:
// lệnh nào chạm `.compass/` trước cũng ra cùng một file.
//
// Trả về `{ state }`, chuyện đã xảy ra, để `init` báo cho người dùng:
//   'created'  — chưa có, đã viết mặc định
//   'upgraded' — file mặc định của bản cũ, đã nâng; `added` là các dòng vừa thêm
//   'current'  — đã đúng mặc định
//   'user'     — người dùng đã sửa; không đụng một byte
//   'failed'   — không đọc hay không ghi được (thư mục, chỉ đọc); không ném
export function ensureCompassGitignore(root) {
  const file = compassDir(root) + '/.gitignore';
  try {
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8');
      if (text === COMPASS_GITIGNORE) return { state: 'current' };
      if (!laFileCu(text)) return { state: 'user' };
      writeFileSync(file, COMPASS_GITIGNORE);
      return { state: 'upgraded', added: dongThem(text) };
    }
    writeFileSync(file, COMPASS_GITIGNORE);
    return { state: 'created' };
  } catch {
    // Ghi hỏng thì thôi. Ký bản ghi quan trọng hơn che file: thư mục chỉ đọc
    // vẫn phải ký được, còn chuyện chưa che thì `init` nói.
    return { state: 'failed' };
  }
}

// Che `.salt` ở đây chứ không chỉ ở `init`: dự án mở bằng `investigate` từng có
// salt trần — gặp thật ở MEI/multi-repo. Nơi nào sinh salt thì nơi đó che.
// Chỉ ghi khi sinh salt mới: `getSalt` chạy ở mọi lần đọc ghi gate, và đường
// đọc không được bắt đầu ghi file.
export function getSalt(root) {
  const file = saltPath(root);
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const salt = randomBytes(32).toString('hex');
  writeFileSync(file, salt);
  ensureCompassGitignore(root);
  return salt;
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  const keys = Object.keys(value).sort();
  const sorted = {};
  for (const key of keys) {
    sorted[key] = canonicalize(value[key]);
  }
  return sorted;
}

function canonical(record) {
  const { sig, ...rest } = record;
  return JSON.stringify(canonicalize(rest));
}

export function signRecord(record, salt) {
  return sha256(canonical(record) + '|' + salt);
}

export function verifyRecord(record, salt) {
  if (!record || typeof record.sig !== 'string') return false;
  return signRecord(record, salt) === record.sig;
}
