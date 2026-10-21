import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkSize } from './review-brief.mjs';
import { gitTopLevel } from './git-files.mjs';
import { code } from './convention-draft.mjs';

// CP-81 — nguồn của một PR cần soi: ref nào, so với nhánh nào, và một bản checkout
// tạm của đầu PR để đọc ngữ cảnh. Không đụng branch, index hay cây làm việc của
// người dùng: mọi thứ đọc từ object của git, và worktree tạm nằm ngoài repo.
//
// Mọi lệnh git truyền đối số dạng mảng, không qua shell. Ref còn được kiểm tra
// trước khi tới tay git: một ref mở đầu bằng `-` là cờ (`--upload-pack=` chạy
// lệnh tùy ý), và ref có ký tự lạ không phải tên nhánh nào cả.

// Danh sách cấm thay cho danh sách cho phép: tên nhánh hợp lệ có thể chứa `#`, `+`
// hay chữ không phải ASCII (lần soi đầu của CP-81). Cấm khoảng trắng, ký tự điều
// khiển, những ký tự git không nhận trong tên ref, và ký tự shell — lệnh không qua
// shell, nhưng một ref như vậy không phải tên nhánh nào cả.
const BAD_REF = /[\s\x00-\x1f\x7f:?*[\\;|&$<>`'"]/;

// Không lệnh git nào ở đây được dừng lại hỏi người: một `git fetch` treo chờ
// mật khẩu là một lệnh Compass treo mãi (lần soi thứ hai của CP-81).
// SSH cũng hỏi được (passphrase, host key lạ): `BatchMode` cho nó hỏng ngay thay
// vì chờ. Nhưng `GIT_SSH_COMMAND` thắng mọi cách người dùng tự cấu hình SSH —
// `GIT_SSH` (plink trên Windows), `core.sshCommand` (một khóa riêng) — nên chỉ đặt
// khi họ chưa cấu hình gì, kẻo `compass pr 123` hỏng xác thực ở máy họ (lần soi
// thứ tư của CP-81).
const sshEnv = new Map();
export function quietEnv(root) {
  if (!sshEnv.has(root)) {
    let own = Boolean(process.env.GIT_SSH_COMMAND || process.env.GIT_SSH);
    if (!own) {
      try {
        own = execFileSync('git', ['config', '--get', 'core.sshCommand'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
      } catch { /* không khai */ }
    }
    sshEnv.set(root, own ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' });
  }
  return { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...sshEnv.get(root) };
}

function git(root, args, { input, env } = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 50_000_000,
    input,
    env: { ...process.env, ...quietEnv(root), ...env },
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
}

// Lý do git đưa ra khi một lệnh hỏng, gọn một dòng.
function gitReason(err) {
  const text = String(err.stderr ?? err.message ?? '').trim().split(/\r?\n/).filter(Boolean);
  return text.length ? text[text.length - 1] : 'git không nói lý do';
}

export function checkRef(ref) {
  if (typeof ref !== 'string' || ref === '') return 'Ref rỗng.';
  if (ref.startsWith('-')) return `Ref "${ref}" không hợp lệ: mở đầu bằng "-" thì git đọc nó là cờ.`;
  if (BAD_REF.test(ref) || ref.includes('..')) return `Ref "${ref}" không hợp lệ: chỉ nhận tên nhánh, tag, sha hay số PR.`;
  return null;
}

export function resolveCommit(root, ref) {
  try {
    return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

// Tên thư mục cho một PR dưới `.compass/pr/`. Hai ref khác nhau không được ra cùng
// một key, kẻo review của PR này ghi đè review của PR kia: nhánh tên `pr-7` với
// PR #7, hay `feat/x` với `feat-x` (lần soi thứ hai của CP-81). Tên phải đổi ký tự,
// hay trùng dạng key Compass dành riêng, thì kèm 6 ký tự băm của chính ref.
export function prKey(ref, sha = null) {
  if (/^\d+$/.test(ref)) return `pr-${ref}`;
  if (sha && /^[0-9a-f]{7,64}$/.test(ref) && sha.startsWith(ref)) return `sha-${sha.slice(0, 7)}`;
  const key = ref.replace(/[^A-Za-z0-9._-]/g, '-');
  // Không phân biệt hoa thường: trên Windows và macOS `PR-7` và `pr-7`, hay `Feature`
  // và `feature`, là một thư mục. Tên có chữ hoa nào cũng kèm băm của chính nó.
  const clash = key !== ref || /[A-Z]/.test(key) || /-[0-9a-f]{6}$/.test(key) || /^(?:pr-\d+|sha-[0-9a-f]{7})$/i.test(key) || /^\.*$/.test(key);
  return clash ? `${key}-${createHash('sha256').update(ref).digest('hex').slice(0, 6)}` : key;
}

// `ref` là số PR (GitHub, lấy qua `git fetch` từ `origin`, không cần `gh`), tên
// nhánh, tag hay sha. Trả `{ sha, key, label }` hoặc `{ error }`.
//
// Với số PR, nhánh gốc cũng được fetch cùng lúc. Chỉ fetch đầu PR thì `origin/HEAD`
// vẫn cũ như lần fetch trước của người soi, và PR dựa trên một `main` mới hơn ra
// brief chứa cả commit của người khác merge vào `main` sau đó (lần soi thứ tư của
// CP-81). `base` là nhánh gốc người dùng khai: `origin/x` thì fetch đúng nhánh đó.
export function resolveSource(root, ref, base = null) {
  const bad = checkRef(ref);
  if (bad) return { error: bad };
  if (/^\d+$/.test(ref)) {
    // Ref riêng cho mỗi lần chạy: hai lần `compass pr 7` chồng nhau từng xóa ref của
    // nhau, và lần sau lặng lẽ dùng base cũ (lần soi thứ mười hai của CP-81).
    const local = localRef(ref);
    try {
      git(root, ['fetch', '--quiet', '--no-tags', 'origin', `+refs/pull/${ref}/head:${local}`]);
    } catch (err) {
      // Toàn chữ số thì Compass hiểu là số PR; một sha ngắn toàn số thì không phải.
      const hint = ref.length >= 7 ? ' Nếu đây là sha chứ không phải số PR, viết đủ dài cho nó có chữ cái.' : '';
      return { error: `Không lấy được refs/pull/${ref}/head từ origin: ${gitReason(err)}${hint}` };
    }
    const sha = resolveCommit(root, local);
    if (!sha) return { error: `Đã fetch PR ${ref} mà không đọc được commit của nó.` };
    let freshBase = null;
    // `--base=origin/HEAD` là nhánh mặc định của remote, như khi không khai gì: fetch
    // `refs/heads/HEAD` thì không có, lỗi bị nuốt, và base cũ lại được dùng (lần soi
    // thứ bảy của CP-81).
    const defaultBase = base === null || base === undefined || base === 'origin/HEAD';
    const remoteBranch = typeof base === 'string' ? /^origin\/(.+)$/.exec(base)?.[1] : null;
    const spec = defaultBase
      ? `+HEAD:${local}-base`
      : remoteBranch && !checkRef(remoteBranch) ? `+refs/heads/${remoteBranch}:refs/remotes/origin/${remoteBranch}` : null;
    // Không fetch được nhánh gốc thì vẫn soi được, bằng bản đang có — nhưng phải nói
    // ra: bản cũ là đúng cái từng kéo commit của người khác vào diff (lần soi thứ chín
    // của CP-81).
    let baseWarning = null;
    if (spec) {
      try {
        git(root, ['fetch', '--quiet', '--no-tags', 'origin', spec]);
        if (spec.startsWith('+HEAD:')) freshBase = `${local}-base`;
      } catch (err) {
        baseWarning = `Không fetch được nhánh gốc từ origin (${gitReason(err)}), nên diff tính từ bản local đang có. Nếu bản đó cũ hơn nhánh gốc trên remote, diff có thể lẫn commit đã merge vào nhánh gốc sau lần fetch trước.`;
      }
    }
    return { sha, key: prKey(ref), label: `PR #${ref}`, freshBase, baseWarning };
  }
  const sha = resolveCommit(root, ref);
  if (!sha) return { error: `Không tìm thấy "${ref}": không phải nhánh, tag hay commit nào trong repo này.` };
  return { sha, key: prKey(ref, sha), label: ref };
}

// Ref `refs/compass/pr/N` mà `resolveSource` tạo ra chỉ sống trong một lần chạy:
// lần sau fetch lại, nên để lại chỉ làm đầy danh sách ref của người dùng.
const localRef = (ref) => `refs/compass/pr/${ref}-${process.pid}`;

export function dropFetched(root, ref) {
  if (!/^\d+$/.test(String(ref))) return;
  for (const name of [localRef(ref), `${localRef(ref)}-base`]) {
    try { git(root, ['update-ref', '-d', name]); } catch { /* không có thì thôi */ }
  }
}

// Nhánh để so: `--base`, hoặc nhánh gốc vừa fetch cùng PR, hoặc `origin/HEAD`,
// `main`, `master`, cái đầu tiên có.
export function resolvePrBase(root, base, freshBase = null) {
  if ((base === null || base === undefined || base === 'origin/HEAD') && freshBase) {
    const sha = resolveCommit(root, freshBase);
    if (sha) return { sha, label: 'origin/HEAD (vừa fetch)' };
  }
  if (base !== null && base !== undefined) {
    const bad = checkRef(base);
    if (bad) return { error: bad.replace('Ref', 'Nhánh gốc') };
    const sha = resolveCommit(root, base);
    if (!sha) return { error: `Không tìm thấy nhánh gốc "${base}".` };
    return { sha, label: base };
  }
  for (const name of ['origin/HEAD', 'main', 'master']) {
    const sha = resolveCommit(root, name);
    if (sha) return { sha, label: name };
  }
  return { error: 'Không tìm thấy nhánh gốc để so (đã thử origin/HEAD, main, master). Chạy lại với --base=<nhánh>.' };
}

export function mergeBase(root, a, b) {
  try {
    return git(root, ['merge-base', a, b]).trim() || null;
  } catch {
    return null;
  }
}

// Commit message của PR, cũ trước mới sau: khi PR không có spec, đây là thứ duy
// nhất nói người viết định làm gì.
export function commitMessages(root, from, to) {
  return git(root, ['log', '--reverse', '--format=- %h %s%n%b', `${from}..${to}`])
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Trạng thái của Compass mà diff của PR bỏ qua — chỉ bên trong một thư mục
// `.compass/`. Áp cho cả repo thì mọi file của PR trong `review/`, `evidence/`
// hay tên `review-brief.md` biến khỏi brief: một cách giấu code khỏi người soi
// (lần soi thứ ba của CP-81). `:/` là gốc repo: gốc Compass ở thư mục con thì PR
// vẫn được soi trọn, kể cả `package.json` hay CI ở gốc.
// `top`: tính từ gốc repo, không từ thư mục đang đứng — gốc Compass ở thư mục con
// thì không có nó, trạng thái của một `.compass/` khác trong repo lọt vào diff
// (lần soi thứ năm của CP-81).
//
// Chỉ bỏ đúng bốn tên file trạng thái, không bỏ cả thư mục. Ba lần soi liền (thứ
// tám tới thứ mười một) tìm ra một cách giấu code mới dưới `review/` hay
// `evidence/`: file đuôi code, rồi script không đuôi, rồi đẩy tên ra khỏi danh
// sách bằng 60 file giả. Lọc theo tên thì không còn chỗ giấu: mọi file khác của PR
// đều vào diff, còn bốn tên này chỉ là dữ liệu, và được nêu tên hết.
//
// Và chỉ ở đúng chỗ Compass đặt chúng: `.compass/<task>/evidence/gate.json` (cả bản
// ghi theo repo ở `evidence/repos/<repo>/`), `findings.json` cạnh nó, `.compass/<task>/
// review-brief.md`, `.compass/.salt`. Khớp tên ở mọi độ sâu thì một script đặt tên
// `.compass/scripts/.salt`, gọi từ `package.json`, lại ra khỏi diff (lần soi thứ mười
// chín của CP-81).
const PR_STATE = [
  '**/.compass/*/evidence/gate.json',
  '**/.compass/*/evidence/repos/*/gate.json',
  '**/.compass/*/evidence/findings.json',
  '**/.compass/*/review-brief.md',
  '**/.compass/.salt',
].map((p) => `:(exclude,glob,top)${p}`);

// Diff của PR, commit tới commit, chạy ngay trong repo của người dùng chứ không
// trong worktree của PR. Ở đó git đọc `.gitattributes` của người dùng: chạy trong
// worktree thì một PR thêm `*.js -diff` biến code của nó thành "Binary files
// differ" trước mắt người soi (lần soi thứ hai của CP-81). Không dùng
// `collectDiff`: nó đo mọi thứ theo HEAD của người dùng, còn PR không nằm trên đó.
//
// `.compass/` của PR được soi như mọi thư mục khác — PR đổi lệnh test trong
// `config.json` là việc người soi phải thấy — trừ trạng thái của chính Compass.
// Cấu hình git của người dùng không được đổi thứ người soi thấy: textconv
// (Git for Windows gán sẵn `*.pdf`, `*.docx` cho `astextplain`, và một `.pdf` thực ra
// là JS thì ra diff rỗng, lần soi thứ mười bốn của CP-81), `diff.relative` (diff co
// lại chỉ còn thư mục con), màu ANSI (`color.ui=always`), hay diff ngoài.
const PLAIN_DIFF = ['--no-ext-diff', '--no-textconv', '--no-relative', '--no-color'];

// File git coi là nhị phân. `--numstat` ghi `-\t-\t` cho chúng; với `-z`, một
// file đổi tên ghi đường dẫn mới ở trường thứ hai sau đó.
function binaryPaths(root, from, to, spec) {
  const fields = git(root, ['diff', ...PLAIN_DIFF, '--numstat', '-z', from, to, ...spec]).split('\0');
  const out = [];
  for (let i = 0; i < fields.length; i += 1) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[i]);
    if (!m) continue;
    let name = m[3];
    if (name === '') { name = fields[i + 2]; i += 2; }
    if (m[1] === '-' && m[2] === '-' && name) out.push(name);
  }
  return out;
}

// Đuôi mà git có coi là nhị phân thì cũng không đáng tin: một byte NUL trong file
// `.js` là đủ để diff chỉ còn "Binary files differ", trong khi Node vẫn chạy file đó
// bình thường (lần soi thứ sáu của CP-81). Những file này được diff lại với `--text`.
// Cả file không đuôi (script như `run`, `deploy`) và file chấm đầu: đuôi không nói
// được file đó có chạy hay không (lần soi thứ mười hai của CP-81).
const TEXTY = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|toml|ini|sh|bash|zsh|ps1|psm1|bat|cmd|py|rb|go|rs|java|kt|kts|scala|groovy|php|pl|lua|r|dart|swift|m|mm|c|h|cc|cpp|cxx|hpp|cs|fs|ex|exs|erl|clj|hs|tf|nix|html?|css|scss|vue|svelte|sql|txt|xml|gradle|lock|env)$|(?:^|\/)(?:\.[^/]+|[^/.]+|Dockerfile|Makefile)$/i;

// Nội dung file ở `to` có phải chữ không, dù git coi là nhị phân: một byte NUL trong
// file `.js` thì phải, một công cụ dựng sẵn không đuôi thì không. Ép `--text` lên một
// file nhị phân 1,5 MB từng đẩy PR quá giới hạn 2 MB, và cả lần soi bị từ chối (lần
// soi thứ mười bảy của CP-81). Ngưỡng: dưới 10 % byte điều khiển trong 8 KB đầu.
//
// Đọc theo lô — một lần `--batch-check` lấy kích thước, rồi `--batch` theo nhóm
// không quá 40 MB — chứ không mỗi file một tiến trình git: 1.000 file không đuôi
// từng tốn thêm 14 giây (lần soi thứ mười chín của CP-81). Tên có xuống dòng thì
// không đi qua giao thức theo dòng được: coi là chữ, ép `--text` cho chắc.
function textualSet(root, to, files) {
  const out = new Set(files.filter((f) => /[\r\n]/.test(f)));
  const plain = files.filter((f) => !/[\r\n]/.test(f));
  if (!plain.length) return out;
  const cat = (args, input) => execFileSync('git', args, { cwd: root, input, maxBuffer: 64_000_000, stdio: ['pipe', 'pipe', 'ignore'] });
  let sizes;
  try {
    sizes = cat(['cat-file', '--batch-check=%(objectsize)'], `${plain.map((f) => `${to}:${f}`).join('\n')}\n`).toString('latin1').split('\n');
  } catch {
    return out;
  }
  let group = [];
  let bytes = 0;
  const flush = () => {
    if (!group.length) return;
    let buf;
    try {
      buf = cat(['cat-file', '--batch'], `${group.map((f) => `${to}:${f}`).join('\n')}\n`);
    } catch {
      group = [];
      bytes = 0;
      return;
    }
    let at = 0;
    for (const f of group) {
      const nl = buf.indexOf(10, at);
      const size = Number(buf.subarray(at, nl).toString('latin1').split(' ')[2]);
      const head = buf.subarray(nl + 1, nl + 1 + Math.min(size, 8192));
      let control = 0;
      for (const b of head) if ((b < 32 && b !== 9 && b !== 10 && b !== 13) || b === 127) control += 1;
      if (head.length === 0 || control / head.length < 0.1) out.add(f);
      at = nl + 1 + size + 1;
    }
    group = [];
    bytes = 0;
  };
  plain.forEach((f, i) => {
    const size = Number(sizes[i]);
    if (!(size <= 1_000_000)) return;
    if (bytes + size > 40_000_000) flush();
    group.push(f);
    bytes += size;
  });
  flush();
  return out;
}

// File mà `.gitattributes` của người dùng (cây làm việc của họ, không phải của PR)
// đặt `diff` là unset, tức `-diff` hay macro `binary`.
//
// Chỉ tin khi `.gitattributes` trong cây làm việc giống hệt ở commit gốc: người
// soi đang checkout chính nhánh PR (`gh pr checkout 123`) thì `.gitattributes` đó
// là của PR, và một `*.js -diff` do PR thêm lại giấu được code (lần soi thứ mười
// hai của CP-81). Git ở đây chưa có `check-attr --source`, nên so cả file.
function userMarkedBinary(root, names, fork) {
  const marked = new Set();
  if (!names.length) return marked;
  const top = gitTopLevel(root) ?? root;
  try {
    git(top, ['diff', '--quiet', fork, '--', ':(top,glob)**/.gitattributes']);
  } catch {
    return marked;
  }
  for (const part of chunks(names)) {
    let fields;
    try {
      // Tên trong diff tính từ gốc repo, còn `check-attr` đọc theo thư mục đang đứng.
      fields = git(top, ['check-attr', '-z', 'diff', '--', ...part]).split('\0');
    } catch {
      continue;
    }
    for (let i = 0; i + 2 < fields.length; i += 3) {
      if (fields[i + 2] === 'unset') marked.add(fields[i]);
    }
  }
  return marked;
}

export function prDiff(root, from, to) {
  const spec = ['--', ':/', ...PR_STATE];
  let diff;
  let files;
  let deleted;
  let binaries = [];
  try {
    // File chính người dùng đánh dấu `-diff` (hay `binary`) trong `.gitattributes` của
    // họ thì giữ ý họ: ép `--text` lên `yarn.lock -diff` là đổ cả lockfile vào brief
    // và có khi đẩy PR quá giới hạn kích thước (lần soi thứ bảy của CP-81).
    const binary = binaryPaths(root, from, to, spec);
    const marked = userMarkedBinary(root, binary, from);
    const candidates = binary.filter((f) => TEXTY.test(f) && !marked.has(f));
    const textual = textualSet(root, to, candidates);
    const forced = candidates.filter((f) => textual.has(f));
    // Mọi file còn lại mà diff không hiện nội dung đều được nêu tên, kể cả file
    // người dùng đánh dấu `-diff`: đánh dấu đó nói về cách hiện, không nói PR được
    // đổi gì trong đó mà không ai biết (lần soi thứ tám của CP-81).
    binaries = binary.filter((f) => !forced.includes(f));
    // Diff chính giữ nguyên; bản `--text` của những file bị ép được nối thêm theo
    // từng lô vừa dòng lệnh. Dòng "Binary files differ" của chúng còn ở trên là thừa
    // nhưng vô hại, còn một danh sách loại trừ dài thì làm dòng lệnh vượt giới hạn.
    diff = git(root, ['diff', ...PLAIN_DIFF, from, to, ...spec]);
    for (const part of chunks(forced)) {
      diff += git(root, ['diff', ...PLAIN_DIFF, '--text', from, to, '--', ...part.map((f) => `:(top,literal)${f}`)]);
    }
    files = git(root, ['diff', ...PLAIN_DIFF, '--name-only', '-z', from, to, ...spec]).split('\0').filter(Boolean);
    deleted = git(root, ['diff', ...PLAIN_DIFF, '--name-only', '--diff-filter=D', '-z', from, to, ...spec]).split('\0').filter(Boolean);
  } catch (err) {
    // Diff vượt bộ đệm 50 MB là PR quá lớn, không phải lỗi git (lần soi thứ mười một).
    if (err.code === 'ENOBUFS') return { ok: false, reason: TOO_BIG_PR };
    return { ok: false, reason: `Không lấy được diff của PR: ${gitReason(err)}` };
  }
  // File trạng thái Compass mà PR đổi thì không vào diff, nhưng phải được nêu
  // tên: bỏ đi im lặng là một chỗ để giấu (lần soi thứ tư của CP-81).
  let hidden = [];
  try {
    const all = git(root, ['diff', ...PLAIN_DIFF, '--name-only', '-z', from, to, '--', ':/']).split('\0').filter(Boolean);
    const shown = new Set(files);
    hidden = all.filter((f) => !shown.has(f));
  } catch { /* không liệt kê được thì thôi: diff chính đã có */ }
  if (diff.trim() === '') {
    // Tên file do người viết PR đặt: in ra terminal thì phải qua `code()`, kẻo một
    // chuỗi ESC trong tên xóa màn hình hay giả một dòng của Compass.
    const named = hidden.length ? ` PR chỉ đổi ${hidden.length} file trạng thái: ${hidden.slice(0, 20).map(code).join(', ')}${hidden.length > 20 ? ', …' : ''}.` : '';
    return { ok: false, reason: `Khoảng ${from.slice(0, 7)}..${to.slice(0, 7)} không đổi file nào ngoài trạng thái của Compass — không có gì để soi.${named}` };
  }
  // Lời khuyên của `checkSize` là cho task của chính mình (chia task, khai Gốc soi);
  // người soi PR của người khác không làm được việc đó.
  const tooBig = checkSize(diff, files);
  if (tooBig) return { ok: false, reason: [tooBig.reason.split('\n')[0], TOO_BIG_PR].join('\n') };
  return { ok: true, diff, files, deleted, hidden, binaries, base: from };
}

const TOO_BIG_PR = 'Diff của PR quá lớn: không ai đọc hết được chừng này. Nhờ người viết chia PR nhỏ ra, hoặc soi từng phần với --base=<commit giữa chừng>.';

// Chia danh sách đường dẫn thành từng phần vừa dòng lệnh: Windows giới hạn dòng
// lệnh quanh 32k ký tự, và một PR 600 ảnh từng làm `check-attr` hỏng rồi lỗi bị
// nuốt (lần soi thứ tám của CP-81).
function chunks(list, budget = 24_000) {
  const out = [];
  let part = [];
  let size = 0;
  for (const item of list) {
    if (part.length && size + item.length + 24 > budget) {
      out.push(part);
      part = [];
      size = 0;
    }
    part.push(item);
    size += item.length + 24;
  }
  if (part.length) out.push(part);
  return out;
}

const OWNER_FILE = 'owner.pid';

// Tiến trình còn sống không. `EPERM` là còn sống mà của người dùng khác.
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Worktree tạm của một lần chạy bị ngắt giữa chừng (Ctrl-C lúc test chạy) không
// tự mất đi. Gỡ những cái Compass để lại trước khi mở cái mới — nhưng chỉ cái mà
// tiến trình sở hữu đã chết. Hai lần `compass pr` chạy chồng nhau thì lần sau từng
// gỡ worktree lần trước đang dùng, và báo cáo của lần trước ghi test fail cho một
// PR có test xanh (lần soi thứ ba của CP-81).
function sweep(root) {
  // Ref tạm `refs/compass/pr/<N>-<pid>` của lần chạy đã chết cũng phải đi: lần chạy
  // đó không tới được bước dọn của nó (lần soi thứ mười ba của CP-81).
  try {
    for (const name of git(root, ['for-each-ref', '--format=%(refname)', 'refs/compass/pr/']).split(/\r?\n/).filter(Boolean)) {
      const pid = Number(/-(\d+)(?:-base)?$/.exec(name)?.[1]);
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && !alive(pid)) {
        try { git(root, ['update-ref', '-d', name]); } catch { /* lần sau */ }
      }
    }
  } catch { /* không liệt kê được thì thôi */ }

  let list;
  try {
    list = git(root, ['worktree', 'list', '--porcelain']);
  } catch {
    return;
  }
  for (const line of list.split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const dir = line.slice('worktree '.length);
    if (!/[\\/]compass-pr-[^\\/]+[\\/]head$/.test(dir)) continue;
    let owner = null;
    try { owner = Number(readFileSync(path.join(path.dirname(dir), OWNER_FILE), 'utf8')); } catch { /* không có chủ: sót lại */ }
    if (Number.isInteger(owner) && owner > 0 && alive(owner)) continue;
    try { git(root, ['worktree', 'remove', '--force', dir]); } catch { /* prune dọn bên dưới */ }
    // Cả thư mục cha `compass-pr-*`, không chỉ worktree bên trong: nó còn file
    // owner.pid và thư mục hook rỗng (lần soi thứ sáu của CP-81).
    try { rmSync(path.dirname(dir), { recursive: true, force: true }); } catch { /* thư mục tạm */ }
  }
  pruneOurs(root);
  // Thư mục tạm không còn đăng ký worktree nào — `rmSync` hỏng giữa chừng khi một
  // tiến trình còn giữ nó trên Windows — thì danh sách worktree không thấy nó nữa.
  // Dọn theo thư mục: chủ đã chết, hoặc không có chủ mà đã cũ hơn một phút (lần soi
  // thứ bảy của CP-81).
  let names = [];
  try { names = readdirSync(tmpdir()).filter((n) => n.startsWith('compass-pr-')); } catch { return; }
  for (const name of names) {
    const holder = path.join(tmpdir(), name);
    let owner = null;
    try { owner = Number(readFileSync(path.join(holder, OWNER_FILE), 'utf8')); } catch { /* không có chủ */ }
    if (Number.isInteger(owner) && owner > 0 && alive(owner)) continue;
    if (!Number.isInteger(owner) || owner <= 0) {
      try { if (Date.now() - statSync(holder).mtimeMs < 60_000) continue; } catch { continue; }
    }
    try { rmSync(holder, { recursive: true, force: true }); } catch { /* lần sau */ }
  }
}

// Tắt mọi filter đã khai trong config của người dùng cho lần checkout này. Một filter
// `smudge = node tools/smudge.js` chạy file trong repo, nên PR sửa file đó và trỏ
// `.gitattributes` của nó vào filter là chạy được code của nó lúc checkout, khi chưa
// ai bật `--run-tests` (lần soi thứ mười tám của CP-81). Lệnh rỗng và
// `required=false` để git chép nguyên nội dung blob ra đĩa.
function noFilters(root) {
  let names = [];
  try {
    names = [...new Set(git(root, ['config', '--name-only', '--get-regexp', '^filter\\.']).split(/\r?\n/)
      .map((k) => /^filter\.(.+)\.[^.]+$/.exec(k.trim())?.[1])
      .filter(Boolean))];
  } catch { /* không có filter nào */ }
  return names.flatMap((n) => ['-c', `filter.${n}.smudge=`, '-c', `filter.${n}.process=`, '-c', `filter.${n}.required=false`]);
}

// Mở một worktree tạm ở `sha`, chạy `fn(dir)`, rồi gỡ nó đi kể cả khi `fn` ném.
// `git worktree remove` rồi `prune`: một bản đăng ký sót lại trong
// `.git/worktrees` làm hỏng các lệnh `git worktree` sau này của người dùng.
//
// Checkout không được chạy gì của PR. Hook `post-checkout` của người dùng chạy
// trong worktree của PR, nên một hook gọi `node sync.js` hay `npm install` là
// chạy code của PR khi chưa ai bật `--run-tests` (lần soi thứ hai của CP-81):
// `core.hooksPath` trỏ vào một thư mục rỗng tắt mọi hook cho lệnh này. LFS cũng
// không được kéo file qua mạng lúc checkout.
export function withWorktree(root, sha, fn) {
  sweep(root);
  const holder = mkdtempSync(path.join(tmpdir(), 'compass-pr-'));
  const dir = path.join(holder, 'head');
  const noHooks = path.join(holder, 'no-hooks');
  try {
    mkdirSync(noHooks);
    writeFileSync(path.join(holder, OWNER_FILE), String(process.pid));
    git(root, ['-c', `core.hooksPath=${noHooks}`, ...noFilters(root), 'worktree', 'add', '--detach', '--quiet', dir, sha], { env: { GIT_LFS_SKIP_SMUDGE: '1' } });
  } catch (err) {
    rmSync(holder, { recursive: true, force: true });
    // Checkout hỏng thường vì một tên file hệ điều hành này không nhận (`a:b.js` trên
    // Windows): nói ra thay vì chỉ "Could not reset index file" (lần soi thứ mười một).
    throw new Error([
      `Không checkout được ${sha.slice(0, 7)} vào worktree tạm: ${gitReason(err)}`,
      'Hay gặp nhất là PR có tên file máy này không tạo được (trên Windows: `:`, `*`, `?`, `"`, `<`, `>`, `|`, hay tên như `con`, `aux`).',
      'Soi PR này trên máy Linux hay macOS, hoặc nhờ người viết đổi tên file.',
    ].join('\n'));
  }
  try {
    return fn(dir);
  } finally {
    // Gỡ thư mục trước rồi mới dọn bản đăng ký: chỉ bản của worktree đã mất thư
    // mục mới được dọn. Không bước nào được ném, kẻo lỗi dọn dẹp đè lên kết quả thật.
    try { git(root, ['worktree', 'remove', '--force', dir]); } catch { /* prune dọn bên dưới */ }
    try { rmSync(holder, { recursive: true, force: true }); } catch { /* thư mục tạm, hệ điều hành dọn */ }
    pruneOurs(root);
  }
}

// Bản đăng ký worktree của Compass mà thư mục đã mất. Không gọi `git worktree prune`:
// lệnh đó gỡ cả worktree của người dùng nằm trên ổ đang rút ra hay chưa mount, và
// git không nhận lại chúng nữa (lần soi thứ hai mươi của CP-81). Chỉ đụng bản ghi
// trỏ vào `compass-pr-*/head`.
function pruneOurs(root) {
  let admin;
  try {
    admin = path.join(path.resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim()), 'worktrees');
  } catch {
    return;
  }
  let names = [];
  try { names = readdirSync(admin); } catch { return; }
  for (const name of names) {
    let target;
    try { target = readFileSync(path.join(admin, name, 'gitdir'), 'utf8').trim(); } catch { continue; }
    if (!/[\\/]compass-pr-[^\\/]+[\\/]head[\\/]\.git$/.test(target)) continue;
    if (existsSync(target)) continue;
    try { rmSync(path.join(admin, name), { recursive: true, force: true }); } catch { /* lần sau */ }
  }
}
