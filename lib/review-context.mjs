import { readFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { SECRET_FILE } from './secrets-scan.mjs';
import { gitFilesFromRepoRoot, gitTopLevel, gitSubdir } from './git-files.mjs';
import { stripComments } from './repo-detect.mjs';
import { conventionStatus, CONVENTIONS, SAMPLE_BYTES } from './convention-draft.mjs';
import { listUnits } from './workspace-git.mjs';

// Ngữ cảnh cho người soi (CP-78). Brief cũ chỉ có spec và diff, nên người soi
// chỉ xét được những gì nằm trong diff: không thấy convention của repo, không
// biết ai gọi code vừa đổi, không biết tài liệu nào mô tả nó.
//
// Mọi thứ ở đây dò bằng regex trên các file git đang theo dõi, như các gate
// khác. Nó sót được và thừa được, và brief nói thẳng như vậy.
//
// Kết quả phải giống hệt nhau giữa hai lần chạy trên cùng một cây: pha hai của
// `compass review` so toàn văn brief, nên chỉ một danh sách không sắp xếp là
// gate không bao giờ đóng được. Vì thế: mọi danh sách đều sort, mọi đường dẫn
// đều dùng `/`, và không có thời gian hay số ngẫu nhiên nào.

export const CONTEXT_LIMIT_BYTES = 200_000;

const MAX_NAMES = 20;
const MAX_CALLS = 8;
const MAX_SIBLING_EXPORTS = 40;
const MAX_DOCS = 15;
const MAX_SAMPLES = 2;
const MAX_SAMPLE_LINES = 200;
const MAX_FILE_BYTES = 1_000_000;

const TRACEABLE = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);

// Dùng đúng mẫu của gate `secrets` để nhận file .env, và không bao giờ mở nó,
// kể cả khi nó lỡ bị git theo dõi. `.env.example` cũng bỏ: nó là tài liệu, nhưng
// một file mẫu chép từ file thật thì vẫn là file thật.
const isEnvFile = (rel) => SECRET_FILE.test(rel);

// `.compass/` là lịch sử của chính các task, không phải code hay tài liệu đang
// dùng — ở gốc hay lồng trong thư mục con, như `review-brief.mjs` loại khỏi diff.
const isCompassRecord = (rel) => rel.split('/').includes('.compass');

const posix = (p) => p.split(path.sep).join('/');

// Mọi file git theo dõi, cộng file mới chưa commit mà không bị ignore — đúng tập
// file mà diff của review nhìn thấy. Đường dẫn tính từ gốc GIT, như diff. Trả
// `null` khi git không chạy được, để brief nói "không lấy được" thay vì im lặng.
function listOne(dir, keep = () => true) {
  const tracked = gitFilesFromRepoRoot(dir, ['ls-files', '-z']);
  if (tracked === null) return null;
  const untracked = gitFilesFromRepoRoot(dir, ['ls-files', '-z', '--others', '--exclude-standard']) ?? [];
  return [...tracked.map(posix), ...untracked.map(posix).filter(keep)];
}

// Repo con có git riêng (CP-84) góp file của nó, mang tiền tố như trong diff. Gốc
// không nằm trong git nào thì chỉ còn file của các repo con.
function listFiles(root, { units = [], rootGit = true, keep = () => true } = {}) {
  // Cùng hàm liệt kê với gate `secrets` (lib/workspace-git.mjs): hai bên không được
  // nói khác nhau về file nào của repo con tồn tại.
  // `keep` bỏ file CHƯA theo dõi của repo bị bỏ qua mà git đi xuyên junction mà thấy;
  // file đã theo dõi là của git đó (CP-88).
  const own = rootGit ? listOne(root, keep) : [];
  const tracked = units.length ? listUnits(units, ['ls-files', '-z']) : [];
  if (own === null || tracked === null) return null;
  const untracked = units.length ? (listUnits(units, ['ls-files', '-z', '--others', '--exclude-standard']) ?? []).filter(keep) : [];
  const lists = [own, tracked, untracked];
  return [...new Set(lists.flat())].sort();
}

// Đọc theo đường dẫn tính từ gốc git. Không đi theo symlink: một link trong repo
// trỏ ra file ngoài, hay tới một .env, sẽ đưa nội dung đó vào brief (lần soi thứ
// hai của CP-78). File lớn hơn 1 MB bị bỏ qua, và `skipped` giữ tên để brief nói ra.
//
// Không giữ file trong bộ nhớ: bản trước giữ mọi file tới hết lượt chạy, và lần
// soi thứ ba của CP-78 đo được 251 MB heap trên một repo 95 MB (CP-79). Nơi gọi
// giờ dò trong một lượt, nên mỗi file code chỉ đọc một lần cho mục impact.
//
// `why` giữ lý do từng file không đọc được, vì một lý do cố định từng nói "lớn
// hơn 1 MB" cho cả file không còn trong cây làm việc (lần soi của CP-79).
function makeReader(base) {
  const skipped = new Set();
  const why = new Map();
  const read = (rel) => {
    let text = null;
    if (isEnvFile(rel)) {
      why.set(rel, 'file bí mật, không đọc');
    } else {
      try {
        const full = path.join(base, rel);
        const info = lstatSync(full);
        if (info.isSymbolicLink()) {
          why.set(rel, 'là symlink');
        } else if (!info.isFile()) {
          why.set(rel, 'không phải file thường');
        } else if (info.size > MAX_FILE_BYTES) {
          skipped.add(rel);
          why.set(rel, 'lớn hơn 1 MB');
        } else {
          const raw = readFileSync(full, 'utf8');
          if (raw.includes('\0')) why.set(rel, 'nhị phân');
          else text = raw;
        }
      } catch (err) {
        // còn trong danh sách nhưng không đọc được: bỏ qua, ngữ cảnh thiếu một file còn hơn ném lỗi
        why.set(rel, err?.code === 'ENOENT' ? 'không có trong cây làm việc' : 'không mở được');
      }
    }
    return text;
  };
  read.skipped = skipped;
  read.why = why;
  return read;
}

const IDENT = '[A-Za-z_$][\\w$]*';
const EXPORT_PATTERNS = [
  new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${IDENT})`, 'gm'),
  // TypeScript cộng vào `interface`, `type`, `enum`, `namespace`, `abstract class`
  // và `declare`: lần soi thứ hai của CP-78 bắt được bản cũ bỏ sót cả năm dạng.
  new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:const\\s+enum|const|let|var|class|interface|type|enum|namespace)\\s+(${IDENT})`, 'gm'),
  new RegExp(`\\b(?:module\\.)?exports\\.(${IDENT})\\s*=`, 'g'),
];
const EXPORT_LIST = /^\s*export\s*(?:type\s*)?\{([^}]*)\}/gm;
const COMMONJS_OBJECT = /\bmodule\.exports\s*=\s*\{([^}]*)\}/g;

export function exportedNames(source) {
  // Bỏ comment trước khi tìm: một comment trích dòng `export const x` từng sinh ra
  // export giả, và trong brief của chính CP-78 nó chiếm một trong 20 chỗ (CP-79).
  // Dùng lại bộ lọc của repo-detect, vốn giữ nguyên chuỗi để `//` trong URL không
  // bị tính là comment.
  const text = stripComments(source);
  const names = new Set();
  const isName = (s) => new RegExp(`^${IDENT}$`).test(s);
  for (const pattern of EXPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) names.add(m[1]);
  }
  EXPORT_LIST.lastIndex = 0;
  for (const m of text.matchAll(EXPORT_LIST)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const name = (bits[1] ?? bits[0]).trim();
      if (isName(name) && name !== 'default') names.add(name);
    }
  }
  // `module.exports = { a, b: c, d() {} }`: tên xuất ra là khóa của object.
  COMMONJS_OBJECT.lastIndex = 0;
  for (const m of text.matchAll(COMMONJS_OBJECT)) {
    for (const part of m[1].split(',')) {
      const key = part.trim().split(/[\s:(]/)[0];
      if (isName(key)) names.add(key);
    }
  }
  return [...names].sort();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Nơi gọi chỉ tìm trong file code. Tài liệu nhắc tên hàm không phải nơi gọi, và
// lần soi đầu của chính CP-78 cho thấy cái giá: `docs/` xếp trước `src/`, nên với
// giới hạn 8 nơi gọi, tài liệu đẩy nơi gọi thật ra khỏi danh sách. Tài liệu có
// mục `docs` riêng.
//
// Một lượt cho mọi tên: mỗi file code đọc một lần, xét mọi tên, rồi bỏ. Trả Map
// từ cặp (file khai, tên) sang danh sách `file:dòng`, cùng thứ tự với cách quét
// từng tên một — file theo thứ tự đã sort, dòng tăng dần (CP-79-EC1).
function callSites(pairs, files, read) {
  const targets = pairs.map(({ rel, name }) => ({
    key: `${rel}\0${name}`,
    rel,
    name,
    re: new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`),
  }));
  // Chỉ giữ MAX_CALLS nơi gọi đầu, phần sau chỉ đếm: brief cũng chỉ in chừng đó,
  // còn giữ hết thì một tên gọi ở mọi dòng của repo lớn thành hàng triệu chuỗi.
  const hits = new Map(targets.map((t) => [t.key, { shown: [], total: 0 }]));
  if (targets.length === 0) return hits;

  for (const rel of files) {
    if (isCompassRecord(rel)) continue;
    if (!TRACEABLE.has(path.posix.extname(rel).toLowerCase())) continue;
    const live = targets.filter((t) => t.rel !== rel);
    if (live.length === 0) continue;
    const text = read(rel);
    if (text === null) continue;
    const present = live.filter((t) => text.includes(t.name));
    if (present.length === 0) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const t of present) {
        if (!t.re.test(lines[i])) continue;
        const h = hits.get(t.key);
        h.total += 1;
        if (h.shown.length < MAX_CALLS) h.shown.push(`${rel}:${i + 1}`);
      }
    }
  }
  return hits;
}

// conventions.md đọc thẳng, không qua giới hạn 1 MB của các file khác: một file
// luật lớn vẫn là luật đã khai. Lần soi đầu của CP-78 bắt được bản cũ coi file
// quá 1 MB như không có, rồi từ chối finding ghi `basis: declared`. Phần cắt bớt
// để giới hạn 200 KB của cả ngữ cảnh lo.
function readConventions(root) {
  try {
    const full = path.join(root, CONVENTIONS);
    // Cùng luật với mọi file khác: không đi theo symlink.
    if (!lstatSync(full).isFile()) return null;
    return readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

function conventionSection(root, changed, tracked, read, statusRead = null) {
  const declared = readConventions(root);
  if (declared !== null) {
    // Luật đã khai mà repo đã rời đi thì người soi phải biết, kẻo bắt code theo
    // một quy ước không ai còn theo (CP-82). Chỉ thêm khi thật sự có dấu hiệu cũ,
    // nên brief của repo có convention còn khớp không đổi byte nào.
    const status = conventionStatus(root, { read: statusRead });
    const stale = status.state === 'stale'
      ? ['', 'Lưu ý: convention đã khai có thể đã cũ — Compass thấy:', ...status.reasons.map((r) => `- ${r}`),
        'Chỗ code lệch một luật mà repo đã rời đi thì nói rõ điều đó trong finding, đừng coi là lỗi chắc chắn.']
      : [];
    return {
      declared: true,
      lines: [`Repo đã khai convention ở \`${CONVENTIONS}\`. Xét theo đúng các luật dưới đây, và finding thuộc convention ghi \`"basis": "declared"\`.`, ...stale, '', declared.trimEnd()],
    };
  }

  const lines = [
    `Repo chưa khai convention (không có \`${CONVENTIONS}\`). Dưới đây là file có sẵn cùng thư mục với file bị sửa, để so cách viết.`,
    'Finding thuộc convention khi đó là suy ra từ code: ghi `"basis": "inferred"`.',
  ];
  const changedSet = new Set(changed);
  const samples = [];
  for (const rel of changed) {
    if (samples.length >= MAX_SAMPLES) break;
    const dir = path.posix.dirname(rel);
    const ext = path.posix.extname(rel);
    const sibling = tracked.find((t) =>
      path.posix.dirname(t) === dir && path.posix.extname(t) === ext && !changedSet.has(t)
      && !samples.includes(t) && !isCompassRecord(t) && read(t) !== null);
    if (sibling) samples.push(sibling);
  }
  if (samples.length === 0) {
    lines.push('', 'Không tìm thấy file cùng thư mục và cùng loại để so.');
    return { declared: false, lines };
  }
  for (const rel of samples) {
    const all = read(rel).split('\n');
    const shown = all.slice(0, MAX_SAMPLE_LINES);
    lines.push('', `#### Mẫu: ${rel}`, ...shown);
    if (all.length > MAX_SAMPLE_LINES) lines.push(`(bỏ bớt ${all.length - MAX_SAMPLE_LINES} dòng cuối)`);
  }
  return { declared: false, lines };
}

// Bộ đọc cùng giao diện với `makeReader`, nhưng lấy nội dung từ object của git ở
// HEAD của `dir` thay vì từ đĩa. Dành cho worktree vừa checkout (`compass pr`,
// CP-81): trên Windows, lần mở đầu mỗi file git vừa ghi tốn cỡ 6 ms cho tiến trình
// node, nên đọc 2.000 file mất 12 giây, trong khi `git cat-file --batch` đọc cả
// lô trong chưa tới 2 giây. Cùng luật bỏ qua: file bí mật, symlink, file lớn hơn
// 1 MB, nhị phân. Đọc theo lô liền nhau theo thứ tự tên, mỗi lô tối đa 8 MB, và
// chỉ giữ lô đang dùng: thứ tự đó là thứ tự các mục ngữ cảnh duyệt file.
export function gitObjectReader(dir, { batchBytes = 8_000_000 } = {}) {
  const run = (args, input) => execFileSync('git', args, {
    cwd: dir, input, maxBuffer: 200_000_000, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
  });
  const entries = new Map();
  for (const rec of run(['ls-tree', '-r', '-l', '-z', '--full-tree', 'HEAD']).toString('utf8').split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, sha, size] = rec.slice(0, tab).trim().split(/\s+/);
    entries.set(rec.slice(tab + 1), { mode, type, sha, size: size === '-' ? 0 : Number(size) });
  }
  const order = [...entries.keys()].sort();
  const position = new Map(order.map((p, i) => [p, i]));
  const readable = (e) => e.type === 'blob' && e.mode !== '120000' && e.size <= MAX_FILE_BYTES;
  // Một lô chỉ gom file cùng đuôi với file đang cần: mục docs đọc vài file `.md`
  // thì không kéo theo 8 MB code nằm giữa chúng theo thứ tự tên (lần soi thứ tư
  // của CP-81). Và mỗi đuôi giữ lô riêng của nó: chỉ giữ một lô chung thì repo trộn
  // `.ts` với `.tsx` đổi đuôi ở gần như mỗi file, mỗi lần đổi là một lô 8 MB mới,
  // và dựng ngữ cảnh mất 300 giây thay vì một giây (lần soi thứ năm của CP-81).
  const batches = new Map();

  const load = (from) => {
    const names = [];
    let bytes = 0;
    const ext = path.posix.extname(order[from]);
    for (let i = from; i < order.length && bytes < batchBytes; i += 1) {
      const e = entries.get(order[i]);
      if (!readable(e) || isEnvFile(order[i]) || path.posix.extname(order[i]) !== ext) continue;
      names.push(order[i]);
      bytes += e.size;
    }
    const out = run(['cat-file', '--batch'], names.map((n) => entries.get(n).sha).join('\n') + '\n');
    const batch = new Map();
    let at = 0;
    for (const name of names) {
      const nl = out.indexOf(10, at);
      const size = Number(out.subarray(at, nl).toString('latin1').split(' ')[2]);
      batch.set(name, out.subarray(nl + 1, nl + 1 + size));
      at = nl + 1 + size + 1;
    }
    batches.set(ext, batch);
  };
  const cached = (rel) => batches.get(path.posix.extname(rel))?.get(rel);

  const skipped = new Set();
  const why = new Map();
  // `head`: chỉ lấy chừng đó byte đầu, và chỉ coi là nhị phân khi NUL nằm trong
  // đoạn đó — đúng như việc kiểm tra convention cũ đọc từ đĩa. Tìm NUL trong cả file thì
  // hai đường cho hai kết luận trên cùng một cây (lần soi thứ mười của CP-81).
  const read = (rel, { head = null } = {}) => {
    const e = entries.get(rel);
    if (isEnvFile(rel)) { why.set(rel, 'file bí mật, không đọc'); return null; }
    if (!e) { why.set(rel, 'không có trong cây làm việc'); return null; }
    if (e.mode === '120000') { why.set(rel, 'là symlink'); return null; }
    if (e.type !== 'blob') { why.set(rel, 'không phải file thường'); return null; }
    if (e.size > MAX_FILE_BYTES) { skipped.add(rel); why.set(rel, 'lớn hơn 1 MB'); return null; }
    if (!cached(rel)) load(position.get(rel));
    const whole = cached(rel);
    const buf = head ? whole.subarray(0, head) : whole;
    if (buf.includes(0)) { why.set(rel, 'nhị phân'); return null; }
    return head ? new TextDecoder('utf-8').decode(buf) : buf.toString('utf8');
  };
  read.skipped = skipped;
  read.why = why;
  return read;
}

// `reader`: bộ đọc thay cho đọc từ đĩa, như `gitObjectReader` (CP-81).
export function collectContext(root, { files = [], deleted = [], reader = null, units = [], rootGit = true, keep = () => true } = {}) {
  // Diff nói đường dẫn tính từ gốc git, nên danh sách file và chỗ đọc cũng phải
  // tính từ đó. Gốc Compass nằm trong thư mục con (như examples/todo) thì hai gốc
  // khác nhau, và bản cũ ra mục impact rỗng (lần soi thứ hai của CP-78).
  const listed = listFiles(root, { units, rootGit, keep });
  const tracked = listed ?? [];
  const read = reader ?? makeReader(gitTopLevel(root) ?? root);
  const gone = new Set(deleted.map(posix));
  const changed = [...new Set(files.map(posix))].filter((f) => !gone.has(f) && !isEnvFile(f)).sort();

  const out = [];
  if (listed === null) {
    out.push(
      'Không lấy được danh sách file từ git, nên các mục impact, reuse và docs dưới đây không dò được gì.',
      'Mục trống không có nghĩa là không có nơi gọi hay tài liệu nào: tự tìm trong repo.',
      '',
    );
  }

  // convention
  // Bộ đọc truyền vào thì việc kiểm tra convention cũ cũng đọc qua nó, chứ không
  // mở lại từng file trên đĩa (lần soi thứ hai của CP-81). Nó tính đường dẫn từ gốc
  // Compass, còn bộ đọc tính từ gốc git: nối thêm phần thư mục con ở giữa.
  let statusRead = null;
  if (reader) {
    const sub = gitSubdir(root)?.sub ?? '';
    // Một file lớn chỉ việc kiểm tra convention đọc tới không được lọt vào ghi chú
    // "đã bỏ qua file lớn hơn 1 MB" của brief: ghi chú đó nói về các mục ngữ cảnh,
    // và đọc từ đĩa thì nó không có (lần soi thứ năm của CP-81).
    statusRead = (rel) => {
      const full = sub ? `${sub}/${rel}` : rel;
      const had = read.skipped.has(full);
      const text = read(full, { head: SAMPLE_BYTES });
      if (!had) read.skipped.delete(full);
      return text;
    };
  }
  const convention = conventionSection(root, changed, tracked, read, statusRead);
  out.push('### convention', '', ...convention.lines, '');

  // impact
  const impact = [];
  const untraced = [];
  const unreadable = [];
  const docsChanged = [];
  const pairs = [];
  for (const rel of changed) {
    const ext = path.posix.extname(rel).toLowerCase();
    if (ext === '.md') {
      docsChanged.push(rel);
      continue;
    }
    if (!TRACEABLE.has(ext)) {
      untraced.push(rel);
      continue;
    }
    const text = read(rel);
    if (text === null) {
      // Lần soi thứ ba của CP-78: file code đã đổi mà không đọc được từng bị bỏ
      // im lặng, và mục này còn nói "không có file code nào để dò" (CP-79).
      unreadable.push(rel);
      continue;
    }
    const names = exportedNames(text);
    if (names.length === 0) impact.push(`- ${rel}: không thấy export nào`);
    for (const name of names) pairs.push({ rel, name });
  }
  const shownPairs = pairs.slice(0, MAX_NAMES);
  const sites = callSites(shownPairs, tracked, read);
  for (const { rel, name } of shownPairs) {
    const { shown, total } = sites.get(`${rel}\0${name}`);
    if (total === 0) {
      impact.push(`- ${rel} → ${name} — không thấy nơi gọi nào ngoài file này`);
      continue;
    }
    const more = total > MAX_CALLS ? ` (và ${total - MAX_CALLS} nơi khác)` : '';
    impact.push(`- ${rel} → ${name}: ${shown.join(', ')}${more}`);
  }
  if (pairs.length > MAX_NAMES) impact.push(`- (bỏ bớt ${pairs.length - MAX_NAMES} tên export, chỉ dò ${MAX_NAMES} tên đầu)`);
  for (const rel of untraced) impact.push(`- ${rel}: không dò được nơi gọi cho loại file này (chỉ dò JS và TS)`);
  for (const rel of unreadable) impact.push(`- ${rel}: không đọc được (${read.why.get(rel)}), nên không dò được export và nơi gọi`);
  // Lần soi đầu của CP-78: file Markdown và file bị xóa từng bị bỏ qua im lặng, nên
  // người soi không biết máy chưa dò chúng.
  for (const rel of docsChanged) impact.push(`- ${rel}: tài liệu, không dò nơi gọi (xem mục docs)`);
  const deletedFiles = [...gone].filter((f) => !isEnvFile(f)).sort();
  for (const rel of deletedFiles) impact.push(`- ${rel}: đã xóa, không dò được nơi gọi; tìm trong diff những chỗ còn dùng tên của nó`);
  if (impact.length === 0) impact.push('- Không có file code nào để dò.');
  out.push('### impact', '', ...impact, '');

  // reuse
  const changedSet = new Set(changed);
  const dirs = [...new Set(changed.filter((f) => TRACEABLE.has(path.posix.extname(f).toLowerCase())).map((f) => path.posix.dirname(f)))].sort();
  const reuse = [];
  let budget = MAX_SIBLING_EXPORTS;
  let cut = 0;
  for (const rel of tracked) {
    if (!dirs.includes(path.posix.dirname(rel)) || changedSet.has(rel)) continue;
    if (!TRACEABLE.has(path.posix.extname(rel).toLowerCase()) || isCompassRecord(rel)) continue;
    const text = read(rel);
    if (text === null) continue;
    const names = exportedNames(text);
    if (names.length === 0) continue;
    const take = names.slice(0, Math.max(budget, 0));
    cut += names.length - take.length;
    budget -= take.length;
    if (take.length) reuse.push(`- ${rel}: ${take.join(', ')}`);
  }
  if (cut > 0) reuse.push(`- (bỏ bớt ${cut} tên export của module cùng thư mục)`);
  if (reuse.length === 0) reuse.push('- Không thấy module nào cùng thư mục có export.');
  out.push('### reuse', '', ...reuse, '');

  // docs
  const needles = new Set();
  for (const rel of changed) {
    needles.add(rel);
    const stem = path.posix.basename(rel, path.posix.extname(rel));
    if (stem.length >= 4) needles.add(stem);
  }
  for (const { name } of shownPairs) if (name.length >= 4) needles.add(name);
  const sortedNeedles = [...needles].sort();
  const docs = [];
  let docsCut = 0;
  for (const rel of tracked) {
    if (path.posix.extname(rel).toLowerCase() !== '.md' || changedSet.has(rel) || isCompassRecord(rel)) continue;
    const text = read(rel);
    if (text === null) continue;
    const hit = sortedNeedles.filter((n) => text.includes(n));
    if (hit.length === 0) continue;
    if (docs.length >= MAX_DOCS) {
      docsCut += 1;
      continue;
    }
    docs.push(`- ${rel} — nhắc: ${hit.join(', ')}`);
  }
  if (docsCut > 0) docs.push(`- (bỏ bớt ${docsCut} tài liệu nữa)`);
  if (docs.length === 0) docs.push('- Không thấy tài liệu Markdown nào nhắc tới file hay tên vừa đổi.');
  out.push('### docs', '', ...docs);

  // Ở cuối, sau mọi mục, vì cả ba mục đều đọc file và đều có thể gặp file lớn.
  if (read.skipped.size > 0) {
    const names = [...read.skipped].sort();
    const shown = names.slice(0, 5).join(', ');
    const more = names.length > 5 ? ` và ${names.length - 5} file khác` : '';
    out.push('', `(Đã bỏ qua ${names.length} file lớn hơn 1 MB khi dò: ${shown}${more}.)`);
  }

  let text = out.join('\n') + '\n';
  if (Buffer.byteLength(text, 'utf8') > CONTEXT_LIMIT_BYTES) {
    const note = '\n(Ngữ cảnh bị cắt ở giới hạn %d KB; phần sau đó không có trong brief.)\n';
    const room = CONTEXT_LIMIT_BYTES - Buffer.byteLength(note, 'utf8') - 16;
    const total = Buffer.byteLength(text, 'utf8');
    let cutText = Buffer.from(text, 'utf8').subarray(0, room).toString('utf8');
    cutText = cutText.slice(0, cutText.lastIndexOf('\n') + 1);
    // Tính bằng byte ở cả hai vế. Bản cũ lấy byte trừ số ký tự, nên với tiếng Việt
    // nó báo bỏ 160 KB trong khi chỉ bỏ khoảng 100 KB (lần soi đầu của CP-78).
    const droppedKb = Math.round((total - Buffer.byteLength(cutText, 'utf8')) / 1000);
    text = cutText + note.replace('%d', String(Math.round(CONTEXT_LIMIT_BYTES / 1000))).replace('KB;', `KB, bỏ ${droppedKb} KB;`);
  }

  return { text, conventionsDeclared: convention.declared };
}
