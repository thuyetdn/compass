#!/usr/bin/env node
// SessionStart hook: nạp quy tắc trả lời tiếng Việt vào context mỗi phiên.
//
// Đọc thẳng từ references/language.md để chỉ có một bản nguồn duy nhất:
// sửa file đó là hook đổi theo, không phải sửa hai chỗ.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Hai kiểu bố trí: script nằm trong scripts/ (bản repo), hoặc nằm ngay gốc
// thư mục cài (bản copy tay). Thử cả hai thay vì giả định một kiểu.
const candidates = [
  join(here, '..', 'skills', 'flow', 'references', 'language.md'),
  join(here, 'skills', 'flow', 'references', 'language.md'),
];

let rules = null;
for (const path of candidates) {
  try {
    rules = readFileSync(path, 'utf8');
    break;
  } catch {
    // thử nơi tiếp theo
  }
}

if (rules === null) {
  // Hook hỏng thì thoát im lặng, không chặn phiên làm việc của người dùng.
  process.stderr.write(
    `compass: khong tim thay language.md, da thu:\n  ${candidates.join('\n  ')}\n`
  );
  process.exit(0);
}

// Bỏ phần đầu file (giải thích cho người đọc repo, không cần vào context).
const body = rules.split(/^---$/m).pop().trim();

// Thêm tiêu đề dẫn: không có nó thì context chỉ là một loạt heading rời rạc.
const context = `# Cách trả lời tiếng Việt (compass)

Quy tắc bắt buộc cho mọi câu trả lời bằng tiếng Việt trong phiên này.

${body}`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: context,
  },
}));
