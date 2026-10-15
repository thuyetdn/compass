import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SECRET_FILE } from './secrets-scan.mjs';
import { isLinkedWorktree } from './worktree.mjs';

// Directories that are not the project's source: dependencies, build output,
// and Compass's own state. `.compass` matters most — every gate writes a record
// there on every run, so counting it would make each gate invalidate its own
// evidence the moment it recorded it.
export const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.compass', '.knowledge',
]);

// A file this large is generated or binary, not something a person edits. Its
// size stands in for its content so a big asset does not slow every gate down.
const MAX_READ_BYTES = 5_000_000;

function walk(root, current, out) {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return; // an unreadable directory contributes nothing rather than crashing
  }
  // Worktree liên kết lồng trong repo không phải code của dự án (CP-60). Gốc thì
  // không bao giờ bỏ: agent chạy gate ngay trong worktree của nó.
  if (current !== root && isLinkedWorktree(current, entries)) return;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(root, path.join(current, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, path.join(current, entry.name)));
    }
  }
}

// Identifies the source tree a gate ran against, so `done` can tell whether the
// code still matches the evidence. Paths are part of the hash: renaming a file
// changes what the code is, even when every byte survives.
export function hashSource(root) {
  const files = [];
  walk(root, root, files);
  files.sort();

  const digest = createHash('sha256');

  for (const relPath of files) {
    const full = path.join(root, relPath);
    digest.update(relPath.split(path.sep).join('/'));
    digest.update('\0');

    try {
      const stats = statSync(full);
      if (SECRET_FILE.test(relPath.split(path.sep).join('/'))) {
        // File `.env` thì băm kích thước và thời điểm sửa, không băm nội dung.
        //
        // `hashSource` chạy cho MỌI gate, nên nó là đường duy nhất mà nội dung
        // một file bí mật đi vào `gate.json` — và `gate.json` thì nằm trong
        // evidence, được ký, và có thể bị gửi đi nơi khác. Băm là một chiều,
        // nhưng nó vẫn là hàm của nội dung: đổi một ký tự trong `.env` là đổi
        // `sourceHash`, nên bản ghi mang thông tin về file bí mật dù không đọc
        // ngược ra được.
        //
        // Chỉ kích thước, không kèm thời điểm sửa: `mtime` đổi mỗi lần chạm file
        // kể cả khi nội dung y nguyên, nên đưa nó vào là bản ghi tự hỏng vì một
        // thao tác không đổi gì. Đánh đổi đã biết: sửa `.env` mà giữ nguyên độ dài
        // thì `sourceHash` không thấy. Chấp nhận được — `sourceHash` canh code của
        // task, còn `.env` thì gate `secrets` canh bằng ba lý do riêng của nó.
        digest.update(`secret:${stats.size}`);
      } else if (stats.size > MAX_READ_BYTES) {
        digest.update(`size:${stats.size}`);
      } else {
        digest.update(readFileSync(full));
      }
    } catch {
      // A file that cannot be read now is a file that changed, as far as any
      // evidence recorded earlier is concerned.
      digest.update('unreadable');
    }
    digest.update('\0');
  }

  return 'sha256:' + digest.digest('hex');
}
