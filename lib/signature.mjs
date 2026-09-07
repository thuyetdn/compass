import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from './hash.mjs';
import { saltPath, compassDir } from './paths.mjs';

// Che `.salt` ở đây chứ không ở từng lệnh. `init` từng là nơi duy nhất làm việc
// này, nên dự án mở bằng `investigate` có salt trần — gặp thật ở MEI/multi-repo.
// Salt lên git thì ai clone repo cũng ký được bản ghi gate, và chữ ký hết tác
// dụng. Nơi nào sinh salt thì nơi đó che; vá từng lệnh thì lệnh viết sau vẫn hở.
function cheSalt(root) {
  const file = compassDir(root) + '/.gitignore';
  // Đã có thì không đụng — người dùng có thể đã thêm dòng của họ.
  if (existsSync(file)) return;
  try {
    // `data/` chứa kết quả query, log, dump — điều tra thật phải chạy query
    // production, và cái trả về là email với tên khách hàng. Che sẵn thay vì
    // đợi người dùng nhớ; quên một lần là dữ liệu khách nằm trên repo.
    //
    // Không che `output/` và `evidence/`: sản phẩm là thứ mang đi dùng và có khi
    // muốn commit, còn bằng chứng phải review được. Chỉ `data/` là dữ liệu thô.
    // `data/` không có dấu `/` đầu nên git khớp ở mọi cấp — che được
    // `.compass/INV-1/data/` lẫn thư mục sâu hơn, mà không đụng `output/`.
    writeFileSync(file, '.salt\ndata/\n');
  } catch {
    // Ghi hỏng thì thôi. Ký bản ghi quan trọng hơn che file: thư mục chỉ đọc
    // vẫn phải ký được, còn salt trần là chuyện `compass status` nói sau.
  }
}

export function getSalt(root) {
  const file = saltPath(root);
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const salt = randomBytes(32).toString('hex');
  writeFileSync(file, salt);
  cheSalt(root);
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
