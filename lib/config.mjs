import { existsSync, readFileSync } from 'node:fs';
import { configPath } from './paths.mjs';

export const DEFAULT_CONFIG = {
  test: 'npm test',
};

// `testReporter` từng được kiểm tra hợp lệ rồi trả về, nhưng không chỗ nào đọc —
// một trường hứa việc nó không làm. Nó bẫy đúng chiều tệ nhất: người dùng khai
// "tap" rồi tin là xong, không ghép `--reporter=tap` vào lệnh Vitest, nên output
// chỉ in tên file. Mọi ID biến mất và gate `test` báo thiếu case mà không rõ vì sao.
//
// Bỏ kiểm tra, nhưng không chặn config cũ: `status` nói trường này vô tác dụng và chỉ
// chỗ đúng để ghép cờ. Compass không tự đoán runner rồi ghép hộ — đoán từ chuỗi
// như `yarn test:ci --shard=2/4` mà sai thì hỏng lệnh test đang chạy tốt.
export const DEAD_FIELDS = ['testReporter'];

export function loadConfig(root) {
  const file = configPath(root);
  if (!existsSync(file)) {
    return { ok: false, errors: [`Không tìm thấy config: ${file}`] };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`config.json không phải JSON hợp lệ: ${err.message}`] };
  }

  const errors = [];
  if (typeof raw.test !== 'string' || raw.test.trim() === '') {
    errors.push('config.json thiếu trường "test" (lệnh chạy test)');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, config: raw };
}
