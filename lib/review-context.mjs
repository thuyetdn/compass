import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { SECRET_FILE } from './secrets-scan.mjs';
import { gitFilesFromRepoRoot, gitTopLevel } from './git-files.mjs';

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

const CONVENTIONS = '.knowledge/decided/conventions.md';
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
function listFiles(root) {
  const tracked = gitFilesFromRepoRoot(root, ['ls-files', '-z']);
  if (tracked === null) return null;
  const untracked = gitFilesFromRepoRoot(root, ['ls-files', '-z', '--others', '--exclude-standard']) ?? [];
  return [...new Set([...tracked, ...untracked].map(posix))].sort();
}

// Đọc theo đường dẫn tính từ gốc git. Không đi theo symlink: một link trong repo
// trỏ ra file ngoài, hay tới một .env, sẽ đưa nội dung đó vào brief (lần soi thứ
// hai của CP-78). File lớn hơn 1 MB bị bỏ qua, và `skipped` giữ tên để brief nói ra.
function makeReader(base) {
  const cache = new Map();
  const skipped = new Set();
  const read = (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let text = null;
    if (!isEnvFile(rel)) {
      try {
        const full = path.join(base, rel);
        const info = lstatSync(full);
        if (info.isFile()) {
          if (info.size > MAX_FILE_BYTES) {
            skipped.add(rel);
          } else {
            const raw = readFileSync(full, 'utf8');
            if (!raw.includes('\0')) text = raw;
          }
        }
      } catch {
        // còn trong danh sách nhưng không đọc được: bỏ qua, ngữ cảnh thiếu một file còn hơn ném lỗi
      }
    }
    cache.set(rel, text);
    return text;
  };
  read.skipped = skipped;
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

export function exportedNames(text) {
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
function callSites(name, files, read, exclude) {
  const re = new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`);
  const hits = [];
  for (const rel of files) {
    if (rel === exclude || isCompassRecord(rel)) continue;
    if (!TRACEABLE.has(path.posix.extname(rel).toLowerCase())) continue;
    const text = read(rel);
    if (text === null || !text.includes(name)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i])) hits.push(`${rel}:${i + 1}`);
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

function conventionSection(root, changed, tracked, read) {
  const declared = readConventions(root);
  if (declared !== null) {
    return {
      declared: true,
      lines: [`Repo đã khai convention ở \`${CONVENTIONS}\`. Xét theo đúng các luật dưới đây, và finding thuộc convention ghi \`"basis": "declared"\`.`, '', declared.trimEnd()],
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

export function collectContext(root, { files = [], deleted = [] } = {}) {
  // Diff nói đường dẫn tính từ gốc git, nên danh sách file và chỗ đọc cũng phải
  // tính từ đó. Gốc Compass nằm trong thư mục con (như examples/todo) thì hai gốc
  // khác nhau, và bản cũ ra mục impact rỗng (lần soi thứ hai của CP-78).
  const listed = listFiles(root);
  const tracked = listed ?? [];
  const read = makeReader(gitTopLevel(root) ?? root);
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
  const convention = conventionSection(root, changed, tracked, read);
  out.push('### convention', '', ...convention.lines, '');

  // impact
  const impact = [];
  const untraced = [];
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
    if (text === null) continue;
    const names = exportedNames(text);
    if (names.length === 0) impact.push(`- ${rel}: không thấy export nào`);
    for (const name of names) pairs.push({ rel, name });
  }
  const shownPairs = pairs.slice(0, MAX_NAMES);
  for (const { rel, name } of shownPairs) {
    const hits = callSites(name, tracked, read, rel);
    if (hits.length === 0) {
      impact.push(`- ${rel} → ${name} — không thấy nơi gọi nào ngoài file này`);
      continue;
    }
    const more = hits.length > MAX_CALLS ? ` (và ${hits.length - MAX_CALLS} nơi khác)` : '';
    impact.push(`- ${rel} → ${name}: ${hits.slice(0, MAX_CALLS).join(', ')}${more}`);
  }
  if (pairs.length > MAX_NAMES) impact.push(`- (bỏ bớt ${pairs.length - MAX_NAMES} tên export, chỉ dò ${MAX_NAMES} tên đầu)`);
  for (const rel of untraced) impact.push(`- ${rel}: không dò được nơi gọi cho loại file này (chỉ dò JS và TS)`);
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
