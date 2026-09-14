// Paths and diff text only. This module never opens a `.env` file, and nothing
// it returns carries a line that came from one — reason 1 reports a path, never
// a value. A gate that leaks the secret it is guarding is worse than no gate,
// so the rule is structural rather than a promise: no read function is imported
// here at all.
//
// Pattern matching, not a parser, for the same reason the convention and
// knowledge gates use it: zero dependencies. The cost is stated where it bites,
// in `readsEnv` — a `.env` inside an expression this scanner cannot see through
// reads as no mention rather than as a guess.

// `.env`, `.env.local`, `.env.production`, `.env.production.local`. Not
// `.environment`, not `env.mjs`, not `.envrc` — each of those was a false
// positive worth naming, because a gate that cries wolf on a normal filename
// gets switched off.
//
// More than one suffix segment, because the highest-risk names in the family
// carry two: `.env.production.local` and `.env.development.local` are what
// Next.js, Vite and CRA all designate as "local overrides, never commit", so
// they hold real keys more often than plain `.env` does. A first version allowed
// one segment and let a tracked `.env.production.local` pass all three reasons
// at once — the worst possible miss, since it is the likeliest file to hold a
// live key.
// Đánh đổi đã cân nhắc, không phải sơ suất: luật này bắt cả `.env.mjs` và
// `.env.ts` — tên hợp lệ cho một file cấu hình bình thường — vì nó cũng phải bắt
// `.env.backup`, `.env.old`, `.env.bak`, và không có cách nào phân biệt hai nhóm
// bằng tên. Nghiêng về phía chặn nhầm: chặn nhầm thì người dùng đổi tên file,
// bỏ sót một bản sao `.env` thì khoá rò rỉ. Repo này không có file nào thuộc cả
// hai nhóm, nên chưa đo được nhóm nào gặp nhiều hơn ngoài thực tế.
export const SECRET_FILE = /(^|\/)\.env(\.[A-Za-z0-9_-]+)*$/i;

// Documentation that ships in the repo on purpose. These hold placeholders, and
// blocking them would block the very file that teaches people not to commit the
// real one.
const EXEMPT_SUFFIX = new Set(['example', 'sample', 'template']);

// Windows `git status --porcelain` and directory listings return `\`; diff
// paths always use `/`. Comparing the two forms without normalising let a
// backslash path slip past every pattern here (CP-36 hit the same edge).
export function normalisePath(p) {
  return String(p).split('\\').join('/').replace(/^\.\//, '');
}

export function isSecretFile(p) {
  const path = normalisePath(p);
  if (!SECRET_FILE.test(path)) return false;
  return !isExemptExample(path);
}

export function isExemptExample(p) {
  const path = normalisePath(p);
  if (!SECRET_FILE.test(path)) return false;

  // Chỉ segment CUỐI mới quyết định, không phải "có chữ example ở đâu đó".
  // Bản trước dùng `.some()` nên chèn chữ `example` vào bất kỳ vị trí nào là
  // được miễn: `.env.production.example` mang khoá production thật vẫn lọt sạch
  // cả ba lý do. Quy ước đặt tên là phần đuôi nói file dùng vào việc gì, nên
  // `.env.example.production` đọc đúng là file production — và bị chặn.
  const name = path.slice(path.lastIndexOf('/') + 1);
  const parts = name.split('.').slice(2);
  if (parts.length === 0) return false;
  return EXEMPT_SUFFIX.has(parts[parts.length - 1].toLowerCase());
}

// Files whose `.env` mentions are talk about `.env`, not a read of one. A test
// that asserts the gate catches `readFileSync('.env')` has to contain that
// string; flagging it would make the gate unable to have tests.
const NON_CODE_EXT = new Set(['.md', '.markdown', '.txt', '.json', '.yml', '.yaml']);

function isNonCodePath(path) {
  const p = normalisePath(path);

  // Chính file `.env` thì không bao giờ quét nội dung. Nó đã bị lý do 1 chặn rồi,
  // còn đọc từng dòng của nó là mở đúng thứ gate sinh ra để canh: `KEY="/srv/.env.production"`
  // là cú pháp dotenv bình thường, và gate in ra `new code reads /srv/.env.production
  // at .env:2` — tức là đưa nội dung file bí mật ra output, đúng điều spec case S2 cấm.
  if (SECRET_FILE.test(p)) return true;

  if (p === '.gitignore' || p.endsWith('/.gitignore')) return true;
  if (p.startsWith('test/') || p.includes('/test/')) return true;
  if (/(^|\/)[^/]*\.test\.[A-Za-z0-9]+$/.test(p)) return true;
  const dot = p.lastIndexOf('.');
  return dot !== -1 && NON_CODE_EXT.has(p.slice(dot).toLowerCase());
}

// Strip what a `.env` mention can hide behind and still not be a read: a line
// comment, a block comment, and — deliberately not — a string, because the
// string is exactly where a real path lives.
//
// A diff gives added lines without the lines around them, so the inside of a
// multi-line block comment arrives here with no `/*` on it. The gate flagged
// three lines of its own doc comments this way on its first run. A line whose
// first non-space character is `*` is that case, and treating it as prose costs
// nothing: a statement never starts with a bare `*`.
// Cắt theo trạng thái chuỗi, không cắt ở dấu đầu tiên tìm thấy. Bản đầu cắt mù
// tại `#` hay `//` bất kể chúng nằm trong dấu nháy, nên một mã màu `"#fff"` hay
// một URL `"https://…"` đứng cùng dòng xoá sạch phần đọc `.env` phía sau — và
// gate xanh trên đúng dòng có lỗi. Tách ra hai dòng thì lại bắt được, tức là
// hành vi phụ thuộc cách xuống dòng chứ không phải giới hạn đã ghi trong tài liệu.
// Một dấu nháy KHÔNG ĐÓNG trước cuối dòng thì không phải dấu mở chuỗi.
//
// `const Q = /['"]/g;` có số dấu nháy lẻ. Coi dấu đầu là mở chuỗi thì trạng thái
// treo tới hết dòng và nuốt luôn `readFileSync('.env')` phía sau — gate xanh trên
// đúng dòng có lỗi. Đây là cùng một lớp lỗi với trường hợp mã màu và URL đã vá trước đó:
// kết quả phụ thuộc chỗ xuống dòng.
//
// Nhìn trước xem có dấu đóng không thì bỏ hẳn trạng thái treo, nên mọi biến thể
// còn lại của lớp lỗi này — regex literal, chia lấy dư, chuỗi bắc cầu hai dòng —
// đều rơi về cùng một hành vi: bỏ qua dấu đó, đọc tiếp phần sau.
function stripComments(line) {
  if (/^\s*\*(?!\/)/.test(line) || /^\s*\*\//.test(line)) return '';

  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (quote) {
      out += ch;
      if (ch === '\\') { out += line[i + 1] ?? ''; i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      if (coDauDong(line, i, ch)) { quote = ch; out += ch; continue; }
      out += ch;
      continue;
    }
    // Bỏ qua nguyên khối regex literal. `/['"]/` chứa dấu nháy đơn có dấu đóng
    // thật ở phía sau (dấu của `'.env'`), nên phép nhìn trước không cứu được —
    // phải nhận ra chính khối regex thì mới không đọc dấu bên trong nó.
    if (ch === '/' && line[i + 1] !== '/' && line[i + 1] !== '*') {
      const end = ketRegex(line, i);
      if (end !== -1) { i = end; continue; }
    }
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '#') break;
    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

// Vị trí dấu `/` đóng regex bắt đầu tại `from`, hoặc -1 nếu đây không phải regex.
//
// Thận trọng có chủ đích: nhận nhầm một phép chia thành regex sẽ nuốt code thật
// và làm gate mù, tệ hơn hẳn việc bỏ sót một regex. Nên chỉ nhận khi khối đó
// CHỨA dấu nháy — trường hợp duy nhất gây hại — và không chứa khoảng trắng, thứ mà một
// regex viết liền không có còn `a / b` thì luôn có.
function ketRegex(line, from) {
  let coNhay = false;
  for (let i = from + 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === ' ' || ch === '\t') return -1;
    if (ch === "'" || ch === '"' || ch === '`') { coNhay = true; continue; }
    if (ch === '/') return coNhay ? i : -1;
  }
  return -1;
}

// Có dấu đóng cùng loại ở phía sau không, tính cả dấu thoát `\`?
function coDauDong(line, from, quote) {
  for (let i = from + 1; i < line.length; i++) {
    if (line[i] === '\\') { i += 1; continue; }
    if (line[i] === quote) return true;
  }
  return false;
}

// `process.env.X` is an environment variable, not a file. It is the single most
// common way `.env` appears in code that never touches the file, and matching it
// would make the gate red on almost every project on its first run.
function stripProcessEnv(line) {
  return line.replace(/\bprocess\s*\.\s*env\b/g, '').replace(/\bimport\s*\.\s*meta\s*\.\s*env\b/g, '');
}

// A quoted path that names a `.env` file, or a `dotenv` import. Both are reads;
// nothing else in a line of code is.
//
// Single and double quotes only. A backtick around `.env` is markdown far more
// often than it is a path — every hint and message this gate prints writes it
// that way — and on the first run that cost three false positives inside the
// gate's own output strings. A real backtick path is nearly always a template
// with `${...}` in it, which this scanner could not resolve anyway.
// Bắt MỌI chuỗi trong dấu nháy rồi để `SECRET_FILE` phán, thay vì tả lại hình
// dạng `.env` lần thứ hai. Hai bản mô tả tách rời nhau thì lệch nhau, và đã lệch
// thật: `isSecretFile('.env.production.local')` trả true trong khi `readsEnv`
// của cùng đường dẫn trả null, vì bản ở đây mới chỉ cho một segment hậu tố.
// `\'` bên trong chuỗi không đóng chuỗi. Regex `[^'"]*` không biết điều đó nên
// `'don\'t'` cắt sai chỗ, và mọi chuỗi sau nó trên cùng dòng lệch nhịp — kể cả
// một `'.env'` thật. Bản trước chữa lỗi này ở `stripComments` mà để nguyên ở đây,
// nên nó chỉ dời chỗ chứ chưa đóng.
function quotedStrings(line) {
  const out = [];
  let quote = null;
  let buf = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') { buf += line[i + 1] ?? ''; i += 1; continue; }
      if (ch === quote) { out.push(buf); buf = ''; quote = null; continue; }
      buf += ch;
      continue;
    }
    // Cùng hai lý do như `stripComments`: bỏ qua nguyên khối regex literal, và
    // dấu nháy không có dấu đóng phía sau thì không mở chuỗi. Thiếu một trong
    // hai là `/['"]/` nuốt hết phần còn lại của dòng.
    if (ch === '/' && line[i + 1] !== '/' && line[i + 1] !== '*') {
      const end = ketRegex(line, i);
      if (end !== -1) { i = end; continue; }
    }
    if ((ch === '"' || ch === "'") && coDauDong(line, i, ch)) { quote = ch; buf = ''; }
  }
  return out;
}
// Gồm cả `await import('dotenv')`: trong ESM đó là cách nạp dotenv có điều kiện,
// tức đúng hình dạng mà một task "chỉ chạy local" viết ra — chính nhóm mà lý do 3
// sinh ra để hỏi. Bản đầu chỉ bắt cú pháp tĩnh nên bỏ lọt hẳn nhóm này.
const DOTENV_IMPORT = /\b(?:require\s*\(\s*['"`]dotenv|from\s+['"`]dotenv|import\s*\(\s*['"`]dotenv|import\s+['"`]dotenv)/;

export function readsEnv(line) {
  const stripped = stripProcessEnv(stripComments(line));
  if (stripped.trim() === '') return null;

  if (DOTENV_IMPORT.test(stripped)) return 'dotenv';

  for (const raw of quotedStrings(stripped)) {
    // Một URL không phải đường dẫn file. `"https://x.com/.env"` kết thúc bằng
    // `/.env` nên khớp mọi luật về tên, mà mở nó ra là gọi mạng chứ không phải
    // đọc đĩa — gate đỏ ở đây là bắt nhầm đúng thứ lập trình viên hay viết.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim())) continue;

    const inner = normalisePath(raw);
    if (SECRET_FILE.test(inner) && !isExemptExample(inner)) return inner;
  }
  return null;
}

// One added line of a unified diff, with the file it belongs to. `+++ b/path`
// names the file; a `+` line is added content. Anything else is context the task
// did not write, and blaming a task for code it did not add was the whole reason
// CP-38 existed.
export function addedLines(diff) {
  const out = [];
  let file = null;
  let lineNo = 0;
  // `+++ b/x` chỉ là tiêu đề khi ĐỨNG NGOÀI hunk. Bên trong hunk nó là một dòng
  // code bắt đầu bằng `++ `, và đọc nó như tiêu đề cho task một đường thoát rẻ
  // hơn mọi đường khác: thêm dòng `++ b/notes.md` vào file của mình là mọi dòng
  // sau đó bị tính cho một file `.md`, mà `.md` thì lý do 3 bỏ qua. Dựng lại
  // được: cùng một `readFileSync('.env')` cho exit 0 khi có dòng đó, exit 1 khi không.
  let trongHunk = false;
  for (const raw of String(diff).split(/\r?\n/)) {
    if (raw.startsWith('diff --git ')) { trongHunk = false; continue; }

    if (!trongHunk && raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      file = p === '/dev/null' ? null : normalisePath(p.replace(/^b\//, ''));
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { lineNo = Number(hunk[1]); trongHunk = true; continue; }

    if (!trongHunk) continue;

    if (raw.startsWith('+')) {
      if (file) out.push({ file, line: lineNo, text: raw.slice(1) });
      lineNo += 1;
      continue;
    }
    if (raw.startsWith('-')) continue;
    lineNo += 1;
  }
  return out;
}

// `dotenv` appearing under dependencies is worth saying aloud — it is how a read
// arrives next — but on its own it reads nothing, so it never fails the gate.
export function mentionsDotenvDependency(files) {
  return files.map(normalisePath).some((f) => f === 'package.json' || f.endsWith('/package.json'));
}

/**
 * The three reasons, measured against paths and diff text.
 *
 * `declared` is the owner's consent from the spec header. It covers reason 3
 * only: agreeing that a task may read `.env` is not agreeing that it may commit
 * one, and conflating the two would let one approval ship a key.
 */
export function scanSecrets({
  diff = '',
  diffFiles = [],
  trackedFiles = [],
  untrackedUnignored = [],
  declared = null,
} = {}) {
  const problems = [];
  const notes = [];

  const diffPaths = diffFiles.map(normalisePath);
  const exemptInDiff = diffPaths.filter(isExemptExample);

  // Reason 1 — a secret file is in the diff, or tracked from an earlier commit.
  const inDiff = diffPaths.filter(isSecretFile);
  const tracked = trackedFiles.map(normalisePath).filter(isSecretFile);
  const untrackedSet = new Set(untrackedUnignored.map(normalisePath));
  const offenders = [...new Set([...inDiff, ...tracked])].sort();
  for (const path of offenders) {
    // Ba trạng thái, ba lời khuyên — và `inDiff` không phân biệt được chúng.
    // `collectDiff` dựng index tạm có cả file chưa theo dõi, nên một file `.env`
    // chưa commit lần nào vẫn hiện "trong diff" và người dùng nhận lời khuyên
    // "gỡ khỏi commit" cho một commit không tồn tại. `trackedFiles` là nguồn duy
    // nhất nói file đã vào git thật hay chưa.
    const daVaoGit = tracked.includes(path);
    const chuaIgnore = !daVaoGit && untrackedSet.has(path);

    problems.push({
      reason: chuaIgnore ? 2 : 1,
      path,
      message: daVaoGit
        ? `secret file tracked by git: ${path}`
        : chuaIgnore
          ? `secret file not ignored: ${path}`
          : `secret file in the diff: ${path}`,
      hint: daVaoGit
        ? `git rm --cached ${path}, add it to .gitignore, and rotate any key it held.`
        : chuaIgnore
          ? `Add a line to .gitignore:\n    ${path}`
          : `Remove it from the commit, add it to .gitignore, and rotate any key it held.`,
    });
  }

  // Reason 2 — a secret file sits in the working tree that git would happily
  // pick up on the next `git add -A`.
  for (const path of [...new Set(untrackedUnignored.map(normalisePath))].sort()) {
    if (!isSecretFile(path)) continue;
    if (offenders.includes(path)) continue;
    problems.push({
      reason: 2,
      path,
      message: `secret file not ignored: ${path}`,
      hint: `Add a line to .gitignore:\n    ${path}`,
    });
  }

  // Reason 3 — new code names a `.env` file, and no spec line says it may.
  const reads = [];
  for (const { file, line, text } of addedLines(diff)) {
    if (isNonCodePath(file)) continue;
    const what = readsEnv(text);
    if (what) reads.push({ file, line, what });
  }

  if (reads.length && !declared) {
    for (const r of reads) {
      problems.push({
        reason: 3,
        path: r.file,
        line: r.line,
        message: `new code reads ${r.what === 'dotenv' ? 'a .env file through dotenv' : r.what} at ${r.file}:${r.line}`,
        hint: `If this is intended, declare it in the spec header:\n    Dùng .env: <lý do>`,
      });
    }
  } else if (reads.length && declared) {
    for (const r of reads) {
      notes.push(`allowed read at ${r.file}:${r.line} — declared: ${declared}`);
    }
  }

  if (exemptInDiff.length) {
    notes.push(`example file, exempt: ${exemptInDiff.join(', ')}`);
  }
  if (!reads.length && mentionsDotenvDependency(diffPaths)) {
    notes.push('package.json changed — check whether a dotenv dependency was added');
  }

  return { ok: problems.length === 0, problems, notes, reads };
}
