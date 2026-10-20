import { execFileSync } from 'node:child_process';

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

// Gốc git chứa `root`, để đọc được file theo đường dẫn mà `--full-name` trả về.
export function gitTopLevel(root) {
  const lines = gitLines(root, ['rev-parse', '--show-toplevel']);
  return lines && lines.length ? lines[0] : null;
}
