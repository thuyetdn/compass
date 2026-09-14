#!/usr/bin/env node
// SessionStart hook: nạp quy tắc trả lời tiếng Việt vào context mỗi phiên.
//
// Đọc thẳng từ references/ngon-ngu.md để chỉ có một bản nguồn duy nhất —
// sửa file đó là hook đổi theo, không phải sửa hai chỗ.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const goc = join(dirname(fileURLToPath(import.meta.url)), '..');
const duongDan = join(goc, 'skills', 'compass', 'references', 'ngon-ngu.md');

let quyTac;
try {
  quyTac = readFileSync(duongDan, 'utf8');
} catch (err) {
  // Hook hỏng thì im lặng thoát — không chặn phiên làm việc của người dùng.
  process.stderr.write(`compass: không đọc được ${duongDan}: ${err.message}\n`);
  process.exit(0);
}

// Bỏ phần đầu file (giải thích cho người đọc repo, không cần vào context).
const than = quyTac.split(/^---$/m).pop().trim();

// Thêm tiêu đề dẫn: không có nó thì context chỉ là một loạt heading rời rạc.
const context = `# Cách trả lời tiếng Việt (compass)

Quy tắc bắt buộc cho mọi câu trả lời bằng tiếng Việt trong phiên này.

${than}`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: context,
  },
}));
