import { lstatSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Worktree liên kết (`git worktree add`) nằm trong repo là một bản checkout đầy
// đủ của chính repo đó — Claude Code đặt agent ở `.claude/worktrees/<tên>/`. Quét
// nó là quét code task không hề đụng: gate `knowledge` đỏ với hàng trăm file "mới
// thêm", `convention` đổ lỗi cho code của agent, và `sourceHash` đổi theo từng
// lần agent gõ phím.
//
// Nhận theo cấu trúc, không theo tên. `D/.git` là file, dòng đầu là `gitdir: <p>`,
// và `<p>` (tính từ D) là thư mục có file `commondir`. Git dùng chính file đó để
// nhận ra worktree liên kết; submodule cũng có `.git` là file nhưng thư mục quản
// trị của nó không có `commondir`, nên submodule vẫn được quét như trước. Repo lồng
// có `.git` là thư mục thì không bao giờ bị bỏ — dự án nhiều repo cần chúng.
//
// Không quyết được — không đọc được `.git`, dòng đầu không phải `gitdir:`, đích
// không còn, thiếu `commondir` — thì trả `false` và thư mục được quét. Sai mà kêu
// (gate đỏ vì code trong worktree) hơn sai mà im (bỏ qua một thư mục chứa `.env`
// thật). Git cũng xử như vậy: worktree mồ côi bị liệt kê từng file.
//
// Giới hạn đã biết: một file `.git` tự viết trỏ vào bất kỳ thư mục nào có
// `commondir` sẽ giấu thư mục của nó khỏi ba bộ duyệt cây (không giấu được khỏi lý
// do 2 của `secrets`, vì lý do đó hỏi git). Compass chặn sơ suất, không chặn cố ý.

// File `.git` của worktree chỉ có một dòng đường dẫn. Lớn hơn thế thì không phải
// thứ git viết ra, và không cần đọc hết để biết.
const MAX_DOTGIT_BYTES = 4096;

// `entries` là kết quả `readdirSync(dir, { withFileTypes: true })` mà bộ duyệt cây
// đã có trong tay. Truyền vào thì thư mục không có file `.git` không tốn thêm một
// lời gọi hệ thống nào — gần như mọi thư mục của một dự án.
//
// `.git` là thư mục bị chặn ở ba lớp chồng nhau: `e.isFile()` ở đây, `isFile()`
// của `lstat`, và `readFileSync` ném lỗi trên thư mục. Mutation bỏ một lớp sẽ sống
// sót — đó là chủ ý, không phải test rỗng (CP-60-V2 canh cả ba cùng lúc).
//
// Người gọi tự giữ luật "gốc không bao giờ bị bỏ": predicate không biết gốc ở đâu,
// và Compass chạy ngay trong worktree (cách agent chạy gate) phải thấy code của nó.
export function isLinkedWorktree(dir, entries = null) {
  if (entries !== null && !entries.some((e) => e.name === '.git' && e.isFile())) return false;

  try {
    const dotGit = path.join(dir, '.git');
    const stats = lstatSync(dotGit);
    if (!stats.isFile() || stats.size > MAX_DOTGIT_BYTES) return false;

    // CR trần cũng là dấu ngắt dòng (pitfall CP-32), nên tách bằng cả ba dạng.
    const first = readFileSync(dotGit, 'utf8').split(/\r\n|\r|\n/)[0];
    const match = /^gitdir: (.+)$/.exec(first.trimEnd());
    if (!match) return false;

    const admin = path.resolve(dir, match[1]);
    return statSync(admin).isDirectory() && statSync(path.join(admin, 'commondir')).isFile();
  } catch {
    return false;
  }
}
