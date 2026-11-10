import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gitLines, gitTopLevel, realPath } from './git-files.mjs';
import { repoDir } from './repos.mjs';
import { repoPathError } from './gates.mjs';
import { configPath } from './paths.mjs';

// CP-98 — issue #4. Convention thuộc về từng repo, không thuộc về workspace. Bản cũ
// coi "có `.knowledge/decided/conventions.md`" là "repo đã khai convention", nên
// một file chỉ nói về `.compass/scripts` được đưa cho người soi như luật của một
// repo PHP, và người soi không còn file mẫu nào để so.
//
// Ở đây: convention riêng của từng repo nằm đâu, đọc nó thế nào, đếm tên hàm trong
// một thư mục, chọn file mẫu theo commit, và dòng nhắc khi repo chưa có convention.
// Không ghi file nào: soạn nháp là việc của `compass convention --draft --repo=`.

export const CONVENTIONS = '.knowledge/decided/conventions.md';
// Convention riêng của repo `be` ở gốc workspace, không trong repo con: nằm trong repo
// con thì file lên PR của đội (quyết định với người dùng ngày 2026-11-05).
export const OWN_DIR = '.knowledge/decided/conventions';
export const DRAFT_DIR = '.compass/conventions-draft';

// Một convention đếm từ code chỉ được nói ra khi có đủ mẫu và đủ đồng thuận. Cùng
// ngưỡng với bản nháp (CP-82), để hai nơi không hiểu khác nhau thế nào là đủ.
export const MIN_FILES = 20;
export const AGREE = 0.9;
// Đếm tối đa chừng này file mỗi thư mục, lấy đều theo thứ tự tên.
export const MAX_COUNT_FILES = 1000;

// Giá trị lấy từ repo đi vào Markdown trong một code span đủ dài, không xuống dòng:
// một tên file có `` ` `` hay `\n## ` không được mở fence hay dựng heading.
export function code(value) {
  // `\r` một mình cũng là xuống dòng với Markdown, nên một `\r## x` từng dựng được
  // heading thật (lần soi đầu của CP-82).
  // Mọi ký tự điều khiển, không chỉ xuống dòng: ESC xóa được màn hình hay đổi tiêu
  // đề cửa sổ terminal, và U+2028/U+2029 là xuống dòng với nhiều trình xem (lần soi
  // thứ mười sáu của CP-81).
  const text = String(value).replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = longest > 0 || text.startsWith(' ') || text.endsWith(' ') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const posix = (p) => p.split(path.sep).join('/');

// `key` null là gốc workspace.
export const ownFile = (key) => (key === null ? CONVENTIONS : `${OWN_DIR}/${key}.md`);
export const draftFile = (key) => `${DRAFT_DIR}/${key}.md`;

// Không đi theo symlink, như mọi file khác đi vào brief: một link trỏ ra ngoài repo
// sẽ đưa nội dung đó cho người soi. Đường dẫn là thư mục, hay không đọc được, thì coi
// như chưa có: thiếu convention không làm hỏng brief.
//
// Mọi đoạn của đường dẫn đều phải là thư mục thật, không riêng đoạn cuối: một junction
// ở `.knowledge/decided/conventions` từng đưa được file ngoài repo vào brief (lần soi
// đầu của CP-98). Junction trên Windows tạo được mà không cần quyền admin.
//
// Không có giới hạn 1 MB như các file khác: một file luật lớn vẫn là luật đã khai
// (CP-78). Phần cắt bớt để giới hạn 200 KB của cả ngữ cảnh lo.
export function readOwn(root, key) {
  if (key !== null && repoPathError(key)) return null;
  return readNoLink(root, ownFile(key));
}

// Đọc `rel` (posix, tính từ `root`) khi mọi đoạn ở giữa là thư mục thật và đoạn cuối là
// file thường; `null` khi không. Dùng cho file convention đã duyệt và cho bản nháp mà
// `--approve` chép đi (CP-103): một link ở đó đưa được file ngoài repo vào chỗ đã duyệt.
export function readNoLink(root, rel) {
  try {
    const parts = rel.split('/');
    let at = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      at = path.join(at, parts[i]);
      const info = lstatSync(at);
      // `lstat` không đi theo link, nên symlink hay junction không bao giờ là thư mục ở đây.
      if (!info.isDirectory()) return null;
    }
    const full = path.join(at, parts[parts.length - 1]);
    if (!lstatSync(full).isFile()) return null;
    return readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- CP-103, issue #6

// Mục bản nháp một repo mà agent viết sau khi đọc code, không phải máy đếm. Mười hai
// tiêu chí chốt với người dùng ngày 2026-11-10. Dấu `FILL` đánh dấu tiêu chí chưa trả
// lời; `--approve` và gate từ chối khi còn nó.
export const FILL = 'compass-fill';
export const AGENT_SECTION = '## Agent đọc và viết';
export const CRITERIA = [
  { n: 1, title: 'Định dạng', ask: 'Thụt lề, độ dài dòng, nháy, chấm phẩy, dấu phẩy cuối. Đối chiếu file config với code thật.' },
  { n: 2, title: 'Đặt tên', ask: 'Tên file, thư mục, biến, hàm, class hay component, hằng số; tên hàm chung của từng thư mục.' },
  { n: 3, title: 'Cấu trúc thư mục', ask: 'Loại code nào đặt ở đâu (controller, service, component, hook…); có file index gom export không.' },
  { n: 4, title: 'Phụ thuộc giữa các lớp', ask: 'Lớp nào được import lớp nào, và lớp nào không được gọi thẳng lớp nào.' },
  { n: 5, title: 'Import và export', ask: 'Alias đường dẫn, thứ tự nhóm import, export mặc định hay export có tên.' },
  { n: 6, title: 'Kiểu dữ liệu', ask: 'TypeScript strict hay không, có dùng any không, interface hay type, enum, khai kiểu trả về.' },
  { n: 7, title: 'Lỗi và log', ask: 'Ném lỗi kiểu gì, có class lỗi riêng không, logger hay console, định dạng message.' },
  { n: 8, title: 'Dữ liệu và API', ask: 'Kiểm tra input bằng gì, DTO, gọi HTTP qua client nào, truy vấn qua ORM hay repository, mẫu migration.' },
  { n: 9, title: 'Theo framework', ask: 'Quy ước riêng của framework repo dùng (Next.js, NestJS, React, Yii…).' },
  { n: 10, title: 'Test', ask: 'Framework test, chỗ đặt file test, cách đặt tên, cách mock, fixture.' },
  { n: 11, title: 'Cấu hình và bí mật', ask: 'Đọc biến môi trường qua đâu, có file .env mẫu không. Không mở file .env thật.' },
  { n: 12, title: 'Comment và tài liệu', ask: 'Comment viết bằng ngôn ngữ gì, có JSDoc hay docstring không, mẫu TODO.' },
];

// Dòng máy sinh trong một tiêu chí: không bao giờ tính là bằng chứng, vì file ở đó do
// Compass chọn chứ không phải agent đã đọc.
const GENERATED = /^\s*(?:[-*>]\s*)?(?:Câu hỏi|Đọc thêm):/;
// "Không áp dụng" phải kèm lý do sau dấu hai chấm (lần soi đầu của CP-103).
const NO_EVIDENCE_NEEDED = /Không thấy trong repo|Không áp dụng\s*:\s*\S/i;
const UNDECIDED = /^\s*[-*]\s+\[ \]/;

// Mục "Agent đọc và viết" của bản nháp. `samples`: file mẫu (tính từ repo); `hints`:
// file đọc thêm theo số tiêu chí; `approve`: lệnh duyệt in trong lời dặn.
export function agentSection({ samples = [], hints = {}, approve }) {
  const out = [
    AGENT_SECTION, '',
    '> Phần này agent viết sau khi đọc code của repo, không phải máy đếm. Với từng tiêu chí:',
    '> - trả lời bằng quy ước thật của repo, kèm ít nhất một file làm bằng chứng: đường dẫn tính từ repo, trong dấu backtick (ví dụ `src/app.ts:12`);',
    '> - không thấy thì ghi "Không thấy trong repo"; không hợp với repo thì ghi "Không áp dụng: <lý do>";',
    '> - hai kiểu viết lẫn lộn thì ghi cả hai kèm số file, thành một dòng bắt đầu bằng `- [ ]` để người quyết;',
    `> - trả lời xong thì xóa dòng ${FILL} của tiêu chí đó.`,
    `> ${code(approve)} từ chối khi còn dòng ${FILL}, còn dòng \`- [ ]\`, hay một tiêu chí không có bằng chứng.`,
    '',
    '### File mẫu cần đọc', '',
    ...(samples.length ? samples.map((f) => `- ${code(f)}`) : ['- Không có file code nào đã theo dõi trong git.']),
    '',
  ];
  for (const c of CRITERIA) {
    out.push(`### ${c.n}. ${c.title}`, '', `Câu hỏi: ${c.ask}`);
    if (hints[c.n]?.length) out.push(`Đọc thêm: ${hints[c.n].map(code).join(', ')}`);
    out.push('', `> Chờ điền (${FILL}).`, '');
  }
  return out;
}

// `token` (chữ trong backtick) có phải một đường dẫn có thật trong `repoDir` không. Cho
// phép `:dòng` ở cuối. Không nhận đường dẫn tuyệt đối, `..`, `\`, hay link ở bất kỳ đoạn
// nào: bằng chứng phải là file của chính repo.
//
// `prefix`: đường dẫn của repo tính từ gốc workspace (`be`). Bản nháp nêu file config theo gốc
// (`be/.prettierrc`), nên trích đúng như vậy cũng phải được nhận (lần soi thứ ba của CP-103).
export function evidenceExists(repoDir, token, prefix = '') {
  let t = String(token).trim().replace(/:\d+(?::\d+)?$/, '').replace(/^\.\//, '').replace(/\/+$/, '');
  if (prefix && t.startsWith(`${prefix}/`)) t = t.slice(prefix.length + 1);
  if (!t || t.includes('\\') || t.startsWith('/') || /^[A-Za-z]:/.test(t)) return false;
  const parts = t.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false;
  try {
    let at = repoDir;
    for (const p of parts) {
      at = path.join(at, p);
      const info = lstatSync(at);
      if (info.isSymbolicLink()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Chỗ còn thiếu của một file convention (bản nháp hay đã duyệt). Chỉ xét khi file có mục
// "Agent đọc và viết": file viết tay không có mục đó là hợp lệ, như convention riêng mà
// người dùng đã viết trước CP-103.
//   missing     — số tiêu chí bị xóa mất heading
//   unfilled    — số tiêu chí còn dấu FILL
//   unevidenced — số tiêu chí đã trả lời mà không có file nào có thật, cũng không nói "không thấy"
//   undecided   — dòng `- [ ]` còn lại, ở bất kỳ đâu trong file
//
// `evidence: false` cho gate: bằng chứng chỉ xét lúc `--approve`. Xét lại ở mỗi lần gate
// chạy thì một task đổi tên hay xóa file từng được trích sẽ đỏ vì lý do nó không gây ra
// (lần soi đầu của CP-103).
export function ownProblems(text, repoDir, { evidence = true, prefix = '' } = {}) {
  const lines = String(text).normalize('NFC').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === AGENT_SECTION);
  const none = { applies: false, missing: [], unfilled: [], unevidenced: [], undecided: [] };
  if (start < 0) return none;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const bodies = new Map();
  let cur = null;
  for (const l of lines.slice(start + 1, end)) {
    const m = /^###\s+(\d+)\.\s/.exec(l);
    if (m) {
      // Heading lặp lại thì nối thân vào, không thay: một dòng chờ điền ở lần đầu vẫn phải
      // bị thấy (lần soi đầu của CP-103).
      cur = Number(m[1]);
      if (!bodies.has(cur)) bodies.set(cur, []);
    } else if (/^###\s/.test(l)) {
      cur = null;
    } else if (cur !== null) {
      bodies.get(cur).push(l);
    }
  }
  const out = { applies: true, missing: [], unfilled: [], unevidenced: [], undecided: [] };
  for (const c of CRITERIA) {
    const body = bodies.get(c.n);
    if (!body) { out.missing.push(c.n); continue; }
    if (body.some((l) => l.includes(FILL))) { out.unfilled.push(c.n); continue; }
    if (!evidence) continue;
    const said = body.filter((l) => !GENERATED.test(l)).join('\n');
    const cited = [...said.matchAll(/`([^`\n]+)`/g)].some((m) => evidenceExists(repoDir, m[1], prefix));
    if (!cited && !NO_EVIDENCE_NEEDED.test(said)) out.unevidenced.push(c.n);
  }
  out.undecided = lines.filter((l) => UNDECIDED.test(l)).map((l) => l.trim());
  return out;
}

// Các dòng nói chỗ còn thiếu, cho gate và `--approve`. Rỗng khi không thiếu gì.
export function problemLines(p) {
  const name = (ns) => ns.map((n) => `${n}. ${CRITERIA[n - 1].title}`).join(', ');
  const out = [];
  if (p.missing.length) out.push(`Thiếu tiêu chí: ${name(p.missing)}.`);
  if (p.unfilled.length) out.push(`Chưa trả lời (còn dòng ${FILL}): ${name(p.unfilled)}.`);
  if (p.unevidenced.length) out.push(`Không có bằng chứng (không file nào có thật trong repo, cũng không ghi "Không thấy trong repo" hay "Không áp dụng"): ${name(p.unevidenced)}.`);
  if (p.undecided.length) out.push(`Còn ${p.undecided.length} chỗ chờ người quyết:`, ...p.undecided.map((l) => `  ${l}`));
  return out;
}

// `repos` trong config, đọc thẳng từ JSON. Không qua `loadConfig`/`resolveRepos`: một
// mục thiếu `test`, hay một repo khác chưa clone, làm hai hàm đó thất bại, mà soạn nháp
// hay xếp file vào repo không cần những thứ đó (CP-98). Một hàm cho mọi nơi hỏi câu này
// (CP-99): `--draft --repo=`, bản nháp một repo, và ánh xạ file → repo của brief.
//
// `{ ok: false, reason: 'missing' | 'invalid' }` khi không đọc được file hay file không
// phải JSON. Lời của bộ đọc JSON không bao giờ đi ra: nó trích một đoạn config.json
// (luật của CP-96). `repos: null` khi config không khai `repos`, hay khai không phải object.
export function readDeclaredRepos(root) {
  let text;
  try {
    text = readFileSync(configPath(root), 'utf8');
  } catch {
    return { ok: false, reason: 'missing' };
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const declared = config?.repos;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return { ok: true, repos: null };
  return { ok: true, repos: declared };
}

// Repo đã khai trong config, kèm chỗ của nó tính từ `space` (gốc của mọi đường dẫn
// trong diff: gốc git của gốc Compass, hay chính nó khi không có git) và từ gốc
// Compass. Đọc JSON thô như `gitUnits`: một mục thiếu `test` không phải lý do để không
// biết file nào thuộc repo nào. Config không đọc được thì không có repo nào, và mọi
// file thuộc gốc — đúng như trước CP-98.
export function repoLayout(root) {
  const top = gitTopLevel(root);
  const space = realPath(top ?? root);
  const realRoot = realPath(root);
  const sub = posix(path.relative(space, realRoot));
  const repos = [];
  const raw = readDeclaredRepos(root);
  if (!raw.ok || raw.repos === null) return { sub, repos };
  for (const [key, own] of Object.entries(raw.repos)) {
    if (repoPathError(key)) continue;
    const where = repoDir(root, key, own);
    if (where.error) continue;
    let real;
    try {
      real = realPath(where.dir);
    } catch {
      real = path.resolve(where.dir);
    }
    const at = posix(path.relative(space, real));
    if (at.startsWith('..') || path.isAbsolute(at)) continue;
    repos.push({ key, at, rel: posix(path.relative(realRoot, real)) });
  }
  return { sub, repos };
}

// Repo chứa một đường dẫn (tính từ `space`): repo có thư mục dài nhất chứa nó. Không
// repo nào chứa thì nó thuộc gốc. `at` rỗng nghĩa là cả không gian (`compass pr` trong
// repo con: mọi file của diff là của repo đó).
export function repoOf(rel, repos) {
  let best = null;
  for (const r of repos) {
    if (r.at !== '' && rel !== r.at && !rel.startsWith(`${r.at}/`)) continue;
    if (!best || r.at.length > best.at.length) best = r;
  }
  return best;
}

// Tên hàm hay method khai trên một dòng: `function` (JS, PHP — kèm `public static`,
// `export async`…), `def` (Python), `func` (Go, kể cả method có receiver). Dò bằng
// regex trên đầu dòng, không phân tích cú pháp: dòng mở bằng `//`, `#` hay `*` không
// bao giờ khớp, nhưng một dòng `function x()` nằm trong khối `/* */` thì có. Method
// khai không kèm từ khóa (JS `foo() {}`, Java, C#) không được đếm.
//
// Không có hai lượng từ `[ \t]*` liền nhau quanh một phần tùy chọn: dòng có hàng nghìn
// dấu cách sau `function` từng là cách làm một regex chạy bậc ba.
const DECLARATIONS = [
  /^[ \t]*(?:(?:export|default|async|public|protected|private|static|final|abstract)[ \t]+)*function\b[ \t]*(?:&[ \t]*)?(?:\*[ \t]*)?([A-Za-z_$][\w$]*)[ \t]*\(/gm,
  /^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm,
  /^func[ \t]+(?:\([^)\n]*\)[ \t]*)?([A-Za-z_]\w*)[ \t]*[([]/gm,
];

export function declaredNames(text) {
  const names = new Set();
  for (const re of DECLARATIONS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) names.add(m[1]);
  }
  return [...names].sort();
}

// Đếm tên khai trong `files` (đã sort theo tên). Mỗi tên tính một lần mỗi file. Quá
// `limit` file thì lấy đều theo thứ tự tên, và kết quả nói đã lấy mẫu. `total` là số
// file đọc được, nên tỉ lệ không bao giờ tính trên file bị bỏ qua.
export function countNames({ files, read, limit = MAX_COUNT_FILES, minFiles = MIN_FILES }) {
  const n = files.length;
  const pick = n <= limit ? files : Array.from({ length: limit }, (_, k) => files[Math.floor((k * n) / limit)]);
  const counts = new Map();
  let total = 0;
  for (const rel of pick) {
    const text = read(rel);
    if (text === null || text === undefined) continue;
    total += 1;
    for (const name of declaredNames(text)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const enough = total >= minFiles;
  const names = enough
    ? [...counts.entries()].filter(([, c]) => c / total >= AGREE).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    : [];
  return { total, of: n, sampled: pick.length < n, counts, names, enough, minFiles };
}

// Một dòng cho một thư mục và một đuôi file. Nêu số đếm, để người đọc thấy kết luận
// dựa vào đâu.
export function countLine(dir, ext, got) {
  const where = `- ${code(dir)} (${code(`*${ext}`)}): `;
  let body;
  if (got.total === 0) body = 'không có file cùng loại nào đọc được để đếm';
  else if (!got.enough) body = `${got.total} file, chưa đủ mẫu (cần ít nhất ${got.minFiles})`;
  else if (got.names.length === 0) body = `${got.total} file, không tên nào có ở ít nhất ${AGREE * 100} % file`;
  else body = got.names.map(([name, c]) => `${code(name)} ${c}/${got.total} file`).join(', ');
  if (got.sampled) body += ` — đọc ${got.total} file lấy đều theo thứ tự tên trong ${got.of}`;
  return where + body;
}

// File trong `dir` (tính từ gốc của git `gitDir`) mà các commit gần nhất thêm hay
// sửa, mới trước cũ. Đường dẫn đi sau `--` và ở dạng `:(literal)`, nên một file tên
// `-n.php` hay `*.php` không thành cờ hay mẫu của git. Git không chạy được (chưa có
// commit nào, không phải repo) thì trả mảng rỗng, và người gọi lấy theo thứ tự tên.
export function recentFiles(gitDir, dir) {
  if (!gitDir) return [];
  const spec = dir === '' || dir === '.' ? ':(literal).' : `:(literal)${dir}/`;
  return gitLines(gitDir, ['-c', 'core.quotepath=off', 'log', '-n', '200', '--no-renames', '--diff-filter=AM',
    '--format=', '--name-only', '-z', '--', spec]) ?? [];
}

// Tên repo viết vào một lệnh gợi ý: tên thường giữ nguyên, tên có dấu cách hay ký tự lạ
// đặt trong nháy, để lệnh chép ra chạy được. Một hàm cho dòng nhắc, gate và `--approve`.
export function cliRepo(key) {
  return /^[\w./-]+$/.test(key) ? key : JSON.stringify(key);
}

// Dòng nhắc cho từng đơn vị chưa có convention đã duyệt. Tính lại mỗi lần từ chỗ file
// có hay không, nên nó tự hết đúng lúc người duyệt chuyển bản nháp vào. Không bao giờ
// đổi mã thoát của ai: thiếu convention không có nghĩa là code sai.
export function pendingLines(root, keys) {
  return keys.filter((key) => readOwn(root, key) === null).map(pendingLine);
}

// Dòng nhắc cho một đơn vị đã biết là thiếu convention (brief vừa dựng đã đọc file).
//
// Lệnh đi trong code span như tên repo: `compass pr` đứng ở gốc dùng chung git lấy
// `repos` từ config của chính PR, nên một khóa `<img src=x>` không được thành HTML thật
// trong `report.md` (lần soi thứ hai của CP-98).
export function pendingLine(key) {
  if (key === null) {
    return `⚠ Gốc chưa có convention đã duyệt (${code(CONVENTIONS)}) — soạn nháp: ${code('compass convention --draft')}, rồi đưa người duyệt.`;
  }
  const arg = cliRepo(key);
  return `⚠ Repo ${code(key)} chưa có convention đã duyệt (${code(ownFile(key))}) — soạn nháp: ${code(`compass convention --draft --repo=${arg}`)}, rồi đưa người duyệt.`;
}
