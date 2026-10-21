import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

// Liệt kê file qua git, dùng chung cho gate `secrets` và ngữ cảnh review (CP-78).
// Hai chỗ từng tự viết riêng, và chỗ viết sau gặp lại đúng hai lỗi chỗ viết trước
// đã sửa: bộ đệm mặc định 1 MiB tràn trên repo nhiều file rồi bị nuốt thành danh
// sách rỗng, và đường dẫn tính từ thư mục chạy lệnh thay vì từ gốc git.

// Trả mảng dòng, hoặc `null` khi git không chạy được. `null` khác `[]`: người gọi
// phải nói "không lấy được" thay vì "không có gì".
export function gitLines(root, args) {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 50_000_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').flatMap((s) => s.split(/\r?\n/)).filter(Boolean);
  } catch {
    return null;
  }
}

// `ls-files` trả đường dẫn tương đối với thư mục nó chạy, còn `collectDiff` trả
// đường dẫn tương đối với gốc GIT. Hai gốc trùng nhau thì không sao — và đó là
// bố cục duy nhất test dựng — nhưng `.compass/` nằm trong thư mục con của một
// repo lớn hơn thì cùng một file hiện dưới hai tên. `--full-name` đưa `ls-files`
// về đúng không gian của diff.
export function gitFilesFromRepoRoot(root, args) {
  return gitLines(root, [args[0], '--full-name', ...args.slice(1)]);
}

// Gốc git chứa `root`, và đường dẫn từ gốc đó tới `root` (`''` khi trùng). So bằng
// đường dẫn thật ở cả hai phía: git trả tên dài (`C:/Users/Thuyet Do`), còn `root`
// có thể mang tên 8.3 (`C:\Users\THUYET~1`), và so thẳng thì ra `../../..` (CP-81).
// `null` khi không hỏi được git, hay `root` không nằm trong gốc đó.
export function gitSubdir(root) {
  const top = gitTopLevel(root);
  if (!top) return null;
  const real = (p) => { try { return realpathSync.native(p); } catch { return p; } };
  const realTop = real(top);
  const sub = path.relative(realTop, real(root)).split(path.sep).join('/');
  if (sub.startsWith('..') || path.isAbsolute(sub)) return null;
  return { top: realTop, sub };
}

// Gốc git chứa `root`, để đọc được file theo đường dẫn mà `--full-name` trả về.
export function gitTopLevel(root) {
  const lines = gitLines(root, ['rev-parse', '--show-toplevel']);
  return lines && lines.length ? lines[0] : null;
}
