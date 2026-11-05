import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
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
  const realTop = realPath(top);
  const sub = path.relative(realTop, realPath(root)).split(path.sep).join('/');
  if (sub.startsWith('..') || path.isAbsolute(sub)) return null;
  return { top: realTop, sub };
}

// Hỏi "đường dẫn này có đi qua một thư mục symlink hay junction không", tính từ `base`
// (thư mục git đã chạy `ls-files`). Trả thư mục link đầu tiên trên đường, hay `null`.
// Đoạn cuối không tính: git trên Linux và macOS liệt kê chính symlink như một file, và
// diff của nó chỉ chứa đường dẫn đích. Git for Windows thì coi junction là thư mục thường
// và liệt kê từng file phía sau, nên nội dung file ngoài repo từng vào brief (issue #5).
// Mỗi thư mục chỉ `lstat` một lần. Không `lstat` được thì coi như không phải link: git
// vừa liệt kê file trong đó, nên chỗ đó có trên đĩa lúc nãy.
export function linkGuard(base) {
  const seen = new Map();
  const isLink = (dir) => {
    if (!seen.has(dir)) {
      let link = false;
      try { link = lstatSync(path.join(base, dir)).isSymbolicLink(); } catch { /* xem trên */ }
      seen.set(dir, link);
    }
    return seen.get(dir);
  };
  return (rel) => {
    const segs = String(rel).split('/');
    for (let i = 1; i < segs.length; i += 1) {
      const dir = segs.slice(0, i).join('/');
      if (isLink(dir)) return dir;
    }
    return null;
  };
}

// `p` là `dir` hay nằm dưới nó (đường dẫn posix, `/` cuối không tính). `fold` là hệ
// thống file không phân biệt hoa thường: config khai `Hub` cho thư mục `hub` từng lọt
// qua bước bỏ qua (lần soi thứ ba của CP-88). Người gọi truyền `fold` dò từ chính
// thư mục (`foldsCase`); mặc định theo hệ điều hành. Một hàm cho mọi chỗ hỏi câu này.
export function isUnder(p, dir, { fold = process.platform === 'win32' || process.platform === 'darwin' } = {}) {
  const norm = (s) => { const t = scopeForm(s); return fold ? t.toLowerCase() : t; };
  const a = norm(p);
  const d = norm(dir);
  return a === d || a.startsWith(`${d}/`);
}

// Một đường dẫn tương đối về một dạng: bỏ `./` ở đầu, gộp `a//b` và `a/./b`, bỏ `/` ở
// cuối. `./be/x.js` trong Phạm vi từng không khớp repo `be`, và repo của task thành
// "ngoài Phạm vi" (lần soi thứ năm của CP-88). Không đụng `..`: Phạm vi đã từ chối nó.
export function scopeForm(p) {
  const t = path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/\/+$/, '');
  return t === '.' ? '' : t;
}

// Hệ thống file chứa `root` có phân biệt hoa thường không, dò bằng chính thư mục
// `.compass` của nó: tên điều hành không nói được (ổ phân biệt hoa thường trên macOS,
// WSL trên `/mnt/c`, thư mục bật `setCaseSensitiveInfo` trên Windows — lần soi thứ tư).
export function foldsCase(root) {
  try {
    return existsSync(path.join(root, '.compass')) && existsSync(path.join(root, '.COMPASS'));
  } catch {
    return process.platform === 'win32' || process.platform === 'darwin';
  }
}

// Đường dẫn thật (tên dài, junction đã giải), hay chính nó khi không giải được.
export function realPath(p) {
  try { return realpathSync.native(p); } catch { return p; }
}

// Gốc git chứa `root`, để đọc được file theo đường dẫn mà `--full-name` trả về.
export function gitTopLevel(root) {
  const lines = gitLines(root, ['rev-parse', '--show-toplevel']);
  return lines && lines.length ? lines[0] : null;
}
