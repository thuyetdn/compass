import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SECRET_FILE } from './secrets-scan.mjs';
import { isLinkedWorktree } from './worktree.mjs';
import { configPath } from './paths.mjs';
import { repoDir } from './repos.mjs';

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

const SKIPPED = (rel) => rel.split('/').some((s) => SKIP_DIRS.has(s));

// `git ls-files` của một thư mục, đường dẫn tính từ thư mục đó. Null khi git không đọc được.
function lsFiles(dir, extra) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', ...extra], {
      cwd: dir, encoding: 'utf8', maxBuffer: 200_000_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

// Thư mục `dir` là gốc của chính git của nó: `git -C` trên một `.git` hỏng có thể đi lên git
// cha và liệt kê file theo index của git cha.
function isOwnTop(dir) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-prefix'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === '';
  } catch {
    return false;
  }
}

// File git biết dưới `dir` (CP-117): theo dõi, hay chưa theo dõi mà không bị ignore, cộng file
// `.env` bị ignore (băm theo kích thước). Repo lồng và submodule đi bằng git của chúng. Trả false
// khi git không liệt kê được `dir`; người gọi đi cây thay thế.
function listGit(root, dir, out, seen) {
  const known = lsFiles(dir, ['--cached', '--others', '--exclude-standard']);
  if (known === null) return false;
  const ignored = lsFiles(dir, ['--others', '--ignored', '--exclude-standard', '--directory']) ?? [];
  const rel = (entry) => path.relative(root, path.join(dir, entry));
  for (const entry of new Set(known)) {
    const name = entry.replace(/\/$/, '');
    if (SKIPPED(name)) continue;
    const full = path.join(dir, name);
    let stats;
    try { stats = lstatSync(full); } catch { continue; }
    if (stats.isFile() && !entry.endsWith('/')) out.push(rel(name));
    else if (stats.isDirectory()) nested(root, full, out, seen);
  }
  for (const entry of ignored) {
    if (entry.endsWith('/') || SKIPPED(entry) || !SECRET_FILE.test(entry)) continue;
    try { if (lstatSync(path.join(dir, entry)).isFile()) out.push(rel(entry)); } catch { /* đã mất */ }
  }
  return true;
}

// Repo lồng có git riêng, hay submodule: liệt kê bằng git của nó, hay đi cây khi git hỏng.
// Worktree liên kết thì bỏ, như bộ đi cây vẫn làm (CP-60).
function nested(root, dir, out, seen) {
  if (seen.has(dir) || isLinkedWorktree(dir)) return;
  seen.add(dir);
  if (!(isOwnTop(dir) && listGit(root, dir, out, seen))) walk(root, dir, out);
}

// Repo khai trong config mà git của gốc ignore (gốc nhiều repo hay ignore mọi thư mục con):
// git của gốc không liệt kê chúng, nên tự tìm theo lời khai.
function declaredRepos(root, out, seen) {
  let config;
  try { config = JSON.parse(readFileSync(configPath(root), 'utf8')); } catch { return; }
  const repos = config?.repos;
  if (typeof repos !== 'object' || repos === null || Array.isArray(repos)) return;
  for (const [name, own] of Object.entries(repos)) {
    const where = repoDir(root, name, own);
    if (where.error || where.dir === root || !existsSync(path.join(where.dir, '.git'))) continue;
    if (SKIPPED(path.relative(root, where.dir).split(path.sep).join('/'))) continue;
    nested(root, where.dir, out, seen);
  }
}

function listSource(root) {
  const files = [];
  const seen = new Set([root]);
  if (listGit(root, root, files, seen)) declaredRepos(root, files, seen);
  else walk(root, root, files);
  return files;
}

// Identifies the source tree a gate ran against, so `done` can tell whether the
// code still matches the evidence. Paths are part of the hash: renaming a file
// changes what the code is, even when every byte survives.
//
// Trong git, chỉ file git biết mới là nguồn (CP-117): thư mục bị ignore như `.venv` hay
// `vendor` không bị đọc. Ngoài git, hay git hỏng, thì đi cả cây như trước.
export function hashSource(root) {
  const files = listSource(root);
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
