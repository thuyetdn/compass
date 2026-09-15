#!/usr/bin/env node
// Stop hook: chặn lượt khi câu trả lời dính cụm giọng dịch.
//
// Nhắc thì tôi quên, nên phải có cái chặn thật. Hook đọc câu trả lời cuối
// trong transcript, dò các cụm trong bảng "Giọng dịch" của language.md rồi
// exit 2 kèm stderr. Claude Code đưa stderr đó lại cho model như instruction,
// model viết lại trước khi câu trả lời đến tay người dùng.
//
// Bảng nằm trong language.md chứ không chép sang đây: thêm một dòng vào bảng
// là hook bắt thêm cụm đó, không phải sửa hai chỗ.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Hook hỏng thì cho qua, không chặn người dùng làm việc.
function passThrough() {
  process.exit(0);
}

const raw = readStdin();
let input;
try {
  input = JSON.parse(raw);
} catch {
  passThrough();
}

// Hook trước đã chặn một lần rồi: lần này cho qua, nếu không sẽ lặp vô hạn
// khi model viết lại mà vẫn dính.
if (input.stop_hook_active) passThrough();

// --- lấy câu trả lời cuối ---------------------------------------------------

function lastAssistantText(transcriptPath) {
  let content;
  try {
    content = readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  let last = null;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant' || entry.isSidechain) continue;

    const text = (entry.message?.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    // Lượt cuối thường kết thúc bằng tool_use, nên phải giữ text block gần
    // nhất chứ không lấy dòng cuối cùng của file.
    if (text.trim()) last = text;
  }
  return last;
}

const answer = input.last_assistant_message?.trim()
  ? input.last_assistant_message
  : input.transcript_path
    ? lastAssistantText(input.transcript_path)
    : null;

if (!answer) passThrough();

// --- lấy bảng cụm từ language.md -------------------------------------------

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
if (rules === null) passThrough();

// Bảng có dạng | "cụm sai" | "cách viết đúng" |. Chỉ lấy cột trái, và chỉ lấy
// phần trong ngoặc kép, vì có ô cột phải viết tự do ("bỏ hẳn, nói thẳng vào ý").
const phrases = [];
for (const line of rules.split('\n')) {
  const m = line.match(/^\|\s*"([^"]+)"\s*\|/);
  if (m) phrases.push(m[1]);
}
if (phrases.length === 0) passThrough();

// Em dash: luật cấm hẳn trong văn xuôi. Bảng không có nên bắt riêng.
const EM_DASH = '—';

// --- dò ---------------------------------------------------------------------

// Bỏ block code trước khi dò: output lệnh và code mẫu không phải văn của tôi,
// dính cụm trong đó không tính là lỗi.
const prose = answer
  .replace(/```[\s\S]*?```/g, '')
  .replace(/`[^`\n]*`/g, '');

const lower = prose.toLowerCase();
const hits = phrases.filter((p) => lower.includes(p.toLowerCase()));

if (prose.includes(EM_DASH)) hits.push(EM_DASH + ' (dấu gạch dài)');

if (hits.length === 0) passThrough();

const list = hits.map((h) => `  - ${h}`).join('\n');

process.stderr.write(
  `compass: câu trả lời dính ${hits.length} chỗ giọng dịch, chưa gửi đi được.\n\n` +
    `${list}\n\n` +
    `Viết lại đoạn có mấy chỗ đó rồi trả lời lại. Bảng thay thế nằm ở mục\n` +
    `"Không viết giọng dịch" trong language.md. Đừng chỉ đổi đúng từ bị bắt:\n` +
    `đọc lại cả đoạn xem còn câu nào người Việt không nói ngoài đời không.\n`
);
process.exit(2);
