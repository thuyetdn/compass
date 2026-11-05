import { readFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { SECRET_FILE } from './secrets-scan.mjs';
import { gitFilesFromRepoRoot, gitTopLevel, gitSubdir } from './git-files.mjs';
import { stripComments } from './repo-detect.mjs';
import { conventionStatus, CONVENTIONS, SAMPLE_BYTES } from './convention-draft.mjs';
import { listUnits } from './workspace-git.mjs';
import { parseRules } from './rule-parser.mjs';
import { matchesScope } from './rule-runner.mjs';
import {
  AGREE, MIN_FILES, code, countLine, countNames, ownFile, readOwn, recentFiles, repoLayout, repoOf,
} from './repo-conventions.mjs';

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
// Mẫu: tối đa 2 file mỗi thư mục, 4 file cả brief (CP-98). Thư mục được đếm tên hàm:
// tối đa 10.
const MAX_SAMPLES = 4;
const SAMPLES_PER_DIR = 2;
const MAX_COUNT_DIRS = 10;
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

// Mục convention, theo từng đơn vị có file bị sửa (CP-98, issue #4). Bản cũ coi "có
// `conventions.md` ở gốc" là "repo đã khai convention", nên một file chỉ nói về
// `.compass/scripts` được đưa ra như luật của một repo PHP, và người soi mất luôn
// file mẫu. Giờ mỗi file thuộc repo có thư mục dài nhất chứa nó (theo `repos`), file
// ngoài mọi repo thuộc gốc, và mỗi đơn vị nói convention của chính nó:
//
// - có file riêng → đưa nguyên file, `declared`. File có khối `rule` mà không `scope`
//   nào khớp một file bị sửa thì thư mục của file đó vẫn có mẫu. File chỉ có văn xuôi
//   coi như phủ mọi thứ: Compass không đọc được văn xuôi nói về đâu.
// - không có → đếm tên hàm trong thư mục và kèm mẫu, `inferred`.
//
// Chỉ một đơn vị và đó là gốc (dự án một repo) thì không có tiêu đề con: brief của
// repo đã khai convention giữ đúng từng byte như trước.
function conventionSection(root, changed, tracked, read, { statusRead = null, layout, convRoot, gits }) {
  const groups = new Map();
  for (const rel of changed) {
    const repo = repoOf(rel, layout.repos);
    const key = repo ? repo.key : null;
    let inRepo = rel;
    if (repo && repo.at !== '') inRepo = rel.slice(repo.at.length + 1);
    let fromRoot = inRepo;
    if (repo && repo.rel) fromRoot = `${repo.rel}/${inRepo}`;
    else if (!repo && layout.sub && rel.startsWith(`${layout.sub}/`)) fromRoot = rel.slice(layout.sub.length + 1);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ rel, inRepo, fromRoot });
  }
  if (groups.size === 0) groups.set(null, []);
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const single = keys.length === 1 && keys[0] === null;

  // Thư mục → file, dựng một lần: mỗi thư mục cần mẫu hay cần đếm chỉ lọc trong phần
  // của nó, không quét lại cả repo.
  const byDir = new Map();
  for (const t of tracked) {
    const dir = path.posix.dirname(t);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(t);
  }
  const changedSet = new Set(changed);
  // `isEnvFile` là lớp thứ hai: `read` đã trả null cho mọi file `.env`, nên mutation
  // bỏ lớp này sống sót. Giữ để danh sách ứng viên không bao giờ chứa file bí mật.
  const siblings = (dir, ext) => (byDir.get(dir) ?? []).filter((t) =>
    path.posix.extname(t) === ext && !changedSet.has(t) && !isCompassRecord(t) && !isEnvFile(t));
  // Thư mục và đuôi của các file, theo thứ tự gặp (file đã sort).
  const folders = (files) => {
    const seen = new Map();
    for (const f of files) {
      const dir = path.posix.dirname(f.rel);
      const ext = path.posix.extname(f.rel);
      seen.set(`${dir}\0${ext}`, { dir, ext });
    }
    return [...seen.values()];
  };
  // Ngân sách mẫu tính theo từng khối: chung một ngân sách thì khối của gốc, đứng
  // trước, dùng hết và khối của repo nói "không tìm thấy file" dù thư mục đầy file —
  // đúng lỗi của issue #4 (lần soi đầu của CP-98). Thư mục bị cắt vì hết ngân sách
  // thì nói ra, không im lặng.
  const samplesFor = (files) => {
    const budget = { left: MAX_SAMPLES };
    const out = [];
    let cut = 0;
    for (const { dir, ext } of folders(files)) {
      const cands = siblings(dir, ext);
      if (budget.left <= 0) {
        if (cands.length) cut += 1;
        continue;
      }
      if (cands.length === 0) continue;
      // Không quá 2 ứng viên thì lấy hết, thứ tự không đổi được gì: khỏi hỏi git. Thư
      // mục mới chưa có lịch sử mà hỏi thì `git log` duyệt hết lịch sử repo, mỗi thư
      // mục một lần (lần soi thứ hai của CP-98).
      const inDir = new Set(cands);
      const recent = cands.length <= SAMPLES_PER_DIR ? [] : recentIn(gits, dir).filter((p) => inDir.has(p));
      const ordered = [...new Set([...recent, ...cands])];
      let took = 0;
      for (const rel of ordered) {
        if (took >= SAMPLES_PER_DIR || budget.left <= 0) break;
        if (read(rel) === null) continue;
        out.push(rel);
        took += 1;
        budget.left -= 1;
      }
    }
    return { samples: out, cut };
  };
  const sampleLines = ({ samples, cut }) => {
    const lines = [];
    for (const rel of samples) {
      const all = read(rel).split('\n');
      const shown = all.slice(0, MAX_SAMPLE_LINES);
      lines.push('', `#### Mẫu: ${rel}`, ...shown);
      if (all.length > MAX_SAMPLE_LINES) lines.push(`(bỏ bớt ${all.length - MAX_SAMPLE_LINES} dòng cuối)`);
    }
    if (cut) lines.push('', `(Bỏ bớt mẫu của ${cut} thư mục khác: mỗi khối kèm tối đa ${MAX_SAMPLES} file mẫu.)`);
    return lines;
  };

  let declared = false;
  const missing = [];
  const lines = [];
  for (const key of keys) {
    const files = groups.get(key);
    const own = readOwn(convRoot, key);
    if (!single) {
      if (lines.length) lines.push('');
      lines.push(key === null ? '#### Gốc workspace' : `#### Repo ${code(key)}`, '');
    }
    if (own !== null) {
      declared = true;
      if (key === null) {
        // Luật đã khai mà repo đã rời đi thì người soi phải biết, kẻo bắt code theo
        // một quy ước không ai còn theo (CP-82). Chỉ thêm khi thật sự có dấu hiệu cũ,
        // nên brief của repo có convention còn khớp không đổi byte nào.
        const status = conventionStatus(convRoot, { read: convRoot === root ? statusRead : null });
        const stale = status.state === 'stale'
          ? ['', 'Lưu ý: convention đã khai có thể đã cũ — Compass thấy:', ...status.reasons.map((r) => `- ${r}`),
            'Chỗ code lệch một luật mà repo đã rời đi thì nói rõ điều đó trong finding, đừng coi là lỗi chắc chắn.']
          : [];
        lines.push(`Repo đã khai convention ở \`${CONVENTIONS}\`. Xét theo đúng các luật dưới đây, và finding thuộc convention ghi \`"basis": "declared"\`.`, ...stale, '', own.trimEnd());
      } else {
        lines.push(`Repo ${code(key)} đã khai convention ở ${code(ownFile(key))}. Xét theo đúng các luật dưới đây, và finding thuộc convention ở repo này ghi \`"basis": "declared"\`.`, '', own.trimEnd());
      }
      const loose = uncovered(own, files);
      const picked = loose.length ? samplesFor(loose) : { samples: [], cut: 0 };
      if (picked.samples.length) {
        const named = loose.slice(0, 5).map((f) => code(f.rel)).join(', ');
        const more = loose.length > 5 ? ` và ${loose.length - 5} file khác` : '';
        lines.push('', `Không luật nào ở trên có \`scope\` khớp ${named}${more}, nên dưới đây là file cùng thư mục để so cách viết.`, ...sampleLines(picked));
      }
      continue;
    }

    missing.push(key);
    if (key === null) {
      lines.push(
        `Repo chưa khai convention (không có \`${CONVENTIONS}\`). Dưới đây là file có sẵn cùng thư mục với file bị sửa, để so cách viết.`,
        'Finding thuộc convention khi đó là suy ra từ code: ghi `"basis": "inferred"`.',
      );
    } else {
      lines.push(`Repo ${code(key)} chưa có convention đã duyệt (không có ${code(ownFile(key))}). Phần dưới do Compass suy ra từ code: finding thuộc convention ở repo này ghi \`"basis": "inferred"\`.`);
    }
    const dirs = folders(files);
    if (dirs.length) {
      lines.push('', `Tên hàm khai trong các file cùng thư mục và cùng đuôi với file bị sửa (dò bằng regex trên dòng \`function\`, \`def\`, \`func\`; không phân tích cú pháp, nên method khai không kèm từ khóa không được đếm). Chỉ nêu tên có ở ít nhất ${AGREE * 100} % file, khi thư mục có ít nhất ${MIN_FILES} file:`, '');
      for (const { dir, ext } of dirs.slice(0, MAX_COUNT_DIRS)) {
        lines.push(countLine(dir, ext, countNames({ files: siblings(dir, ext), read })));
      }
      if (dirs.length > MAX_COUNT_DIRS) lines.push(`- (bỏ bớt ${dirs.length - MAX_COUNT_DIRS} thư mục, chỉ đếm ${MAX_COUNT_DIRS} thư mục đầu)`);
    }
    const picked = samplesFor(files);
    if (picked.samples.length === 0) lines.push('', 'Không tìm thấy file cùng thư mục và cùng loại để so.');
    else lines.push(...sampleLines(picked));
  }
  return { declared, missing, lines };
}

// File bị sửa mà không luật nào của `text` có `scope` khớp. File không có khối
// `rule` nào thì coi như phủ mọi file. Khối hỏng vẫn là khối: nó không khớp gì, nên
// file vẫn có mẫu. `scope` khớp theo cả đường dẫn trong repo lẫn từ gốc Compass,
// như gate `convention`.
function uncovered(text, files) {
  const { rules, errors } = parseRules(text);
  if (rules.length === 0 && errors.length === 0) return [];
  return files.filter((f) => !rules.some((r) => matchesScope(f.inRepo, r.scope) || matchesScope(f.fromRoot, r.scope)));
}

// File mới nhất theo commit trong một thư mục (đường dẫn tính như diff). Thư mục của
// repo con có git riêng hỏi git của repo đó; còn lại hỏi git của gốc.
function recentIn(gits, dir) {
  const unit = gits.units.find((u) => dir === u.prefix || dir.startsWith(`${u.prefix}/`));
  if (unit) {
    const inside = dir === unit.prefix ? '' : dir.slice(unit.prefix.length + 1);
    return recentFiles(unit.dir, inside).map((p) => `${unit.prefix}/${p}`);
  }
  if (!gits.space) return [];
  return recentFiles(gits.space, dir === '.' ? '' : dir);
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
// `layout` và `conventionRoot` (CP-98): `compass pr` trong repo con dựng ngữ cảnh từ
// worktree của repo đó, nhưng convention của repo nằm ở gốc workspace. Nó nói mọi file
// của diff thuộc repo nào, và đọc convention ở đâu. Không truyền thì dò từ config của
// `root`, và đọc ở `root`.
export function collectContext(root, {
  files = [], deleted = [], reader = null, units = [], rootGit = true, keep = () => true,
  layout = null, conventionRoot = null,
} = {}) {
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
  const top = rootGit ? gitTopLevel(root) : null;
  const convention = conventionSection(root, changed, tracked, read, {
    statusRead,
    layout: layout ?? repoLayout(root),
    convRoot: conventionRoot ?? root,
    gits: { units, space: top },
  });
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

  return { text, conventionsDeclared: convention.declared, conventionsMissing: convention.missing };
}
