import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { addedLines } from './review-rounds.mjs';

// Claim check (CP-110, issue #7 mục 8): đường dẫn, commit và tên hàm trong inline code của tài
// liệu vừa thêm và của spec phải có thật. 57% finding về tài liệu ở issue #7 là thứ script bắt được.

const DOC_EXT = new Set(['.md', '.mdx']);
export const isDocFile = (file) => DOC_EXT.has(path.extname(file).toLowerCase());

// Inline code của một dòng: chuỗi backtick mở và đóng dài bằng nhau.
const SPAN = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;
export function spansOf(line) {
  const out = [];
  for (const m of line.matchAll(SPAN)) {
    const body = m[2];
    out.push(body.length > 2 && body.startsWith(' ') && body.endsWith(' ') ? body.slice(1, -1) : body);
  }
  return out;
}

// Chỉ số (từ 0) các dòng nằm trong khối rào ``` hay ~~~, kể cả dòng rào.
export function fencedLines(lines) {
  const inside = new Set();
  let open = null;
  lines.forEach((l, i) => {
    const m = l.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      inside.add(i);
      if (m && m[1][0] === open[0] && m[1].length >= open.length && m[2].trim() === '') open = null;
    } else if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      open = m[1];
      inside.add(i);
    }
  });
  return inside;
}

// Loại tuyên bố của một span: `{ kind: 'path'|'commit'|'function', value }`, hay null khi span không
// phải thứ máy phán được (câu lệnh, glob, chỗ giữ, URL, cờ).
export function classify(span) {
  if (/^[0-9a-f]{7,40}$/i.test(span) && /\d/.test(span) && /[a-f]/i.test(span)) return { kind: 'commit', value: span.toLowerCase() };
  const fn = span.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(.*\)$/);
  if (fn) return { kind: 'function', value: fn[1].split('.').at(-1) };
  if (/\s/.test(span) || /[*?[\]{}<>…]/.test(span) || span.startsWith('-')) return null;
  const bare = span.replace(/:\d+(?:[-:]\d+)?$/, '').replace(/^\.\//, '');
  if (!(bare.includes('/') || /\.[A-Za-z0-9]+$/.test(bare))) return null;
  const value = bare.replace(/\/$/, '');
  // Ra khỏi repo, tuyệt đối, đường dẫn Windows, URL (`//` là đoạn rỗng): không phải đường dẫn trong repo để phán.
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some((s) => s === '..' || s === '')) return null;
  return { kind: 'path', value };
}

const git = (cwd, args, input) => execFileSync('git', args, {
  cwd, encoding: 'utf8', maxBuffer: 200_000_000, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
});

// SHA nào là commit trong một trong các git `dirs`: một `cat-file --batch-check` cho mỗi git.
function commitsIn(dirs, shas) {
  const found = new Set();
  for (const dir of dirs) {
    const left = shas.filter((s) => !found.has(s));
    if (!left.length) break;
    let out = '';
    try { out = git(dir, ['cat-file', '--batch-check'], left.map((s) => `${s}^{commit}`).join('\n') + '\n'); } catch { continue; }
    out.split('\n').forEach((line, i) => { if (i < left.length && line.split(' ')[1] === 'commit') found.add(left[i]); });
  }
  return found;
}

// Tên nào xuất hiện như một từ trọn vẹn trong file không phải Markdown (theo dõi, hay chưa theo dõi
// mà không bị ignore) của một trong các thư mục `dirs`. Một `git grep` cho mỗi 100 tên.
function namesIn(dirs, names) {
  const found = new Set();
  for (const dir of dirs) {
    const left = names.filter((n) => !found.has(n));
    for (let i = 0; i < left.length; i += 100) {
      const patterns = left.slice(i, i + 100).flatMap((n) => ['-e', n]);
      let out = '';
      try {
        out = git(dir, ['grep', '--untracked', '-I', '-w', '-F', '-o', '-h', ...patterns, '--', '.', ':(exclude)*.md', ':(exclude)*.mdx']);
      } catch { /* exit 1: không khớp gì */ }
      for (const l of out.split('\n')) if (l.trim()) found.add(l.trim());
    }
  }
  return found;
}

const REASON = {
  path: 'không có file hay thư mục này',
  commit: 'không phải commit trong git này',
  function: 'không thấy tên này trong code',
};

// Đọc và phán. `sources`: [{ label, lines: [{ line, text }], anchors }] — mỗi nguồn kèm thư mục để
// tìm đường dẫn, commit và tên hàm. `exempt`: Map span → lý do. Trả `{ checked, wrong, exempted }`.
// `removed`: đường dẫn tuyệt đối của file diff của task xoá hay đổi tên đi (CP-113). Tuyên bố về chúng
// đúng ở gốc soi, và việc gỡ chúng là việc của chính task, nên không bị phán.
export function checkClaims(sources, exempt = new Map(), removed = new Set()) {
  const claims = [];
  const exempted = new Map();
  for (const src of sources) {
    for (const { line, text } of src.lines) {
      for (const span of spansOf(text)) {
        if (exempt.has(span)) { exempted.set(span, exempt.get(span)); continue; }
        const c = classify(span);
        if (c) claims.push({ ...c, span, where: `${src.label}:${line}`, anchors: src.anchors });
      }
    }
  }
  const byAnchors = (kind) => {
    const groups = new Map();
    for (const c of claims.filter((x) => x.kind === kind)) {
      const key = c.anchors.join('\0');
      if (!groups.has(key)) groups.set(key, { anchors: c.anchors, values: new Set() });
      groups.get(key).values.add(c.value);
    }
    return [...groups.values()];
  };
  const ok = new Map();
  for (const g of byAnchors('commit')) ok.set(`commit\0${g.anchors.join('\0')}`, commitsIn(g.anchors, [...g.values]));
  for (const g of byAnchors('function')) ok.set(`function\0${g.anchors.join('\0')}`, namesIn(g.anchors, [...g.values]));

  const checked = [];
  const wrong = [];
  for (const c of claims) {
    if (c.kind === 'path') {
      const first = c.value.split('/')[0];
      // Chỉ phán khi đoạn đầu có thật ở gốc của một thư mục neo: `evidence/gate.json` viết tương
      // đối với một thư mục khác thì không phải tuyên bố máy phán được.
      if (!c.anchors.some((a) => existsSync(path.join(a, first)))) continue;
      if (c.anchors.some((a) => removed.has(path.resolve(a, c.value)))) continue;
      checked.push(c);
      if (!c.anchors.some((a) => existsSync(path.join(a, c.value)))) wrong.push(c);
      continue;
    }
    checked.push(c);
    if (!ok.get(`${c.kind}\0${c.anchors.join('\0')}`).has(c.value)) wrong.push(c);
  }
  return { checked, wrong: wrong.map((c) => ({ ...c, reason: REASON[c.kind] })), exempted };
}

// Dòng thêm của tài liệu Markdown trong diff, dưới thư mục `rel` (tính từ gốc Compass), bỏ dòng
// trong khối rào. Chữ của dòng lấy từ diff. Khối rào thì phải đọc cả file, vì dòng mở rào có thể
// không nằm trong diff: `readNew(file)` trả nội dung file ở phía mới của diff (commit Soi đến, hay
// cây làm việc), hay null khi không đọc được — khi đó coi như không có khối rào nào.
export function docSources(diff, rel, anchors, readNew) {
  const byFile = new Map();
  for (const a of addedLines(diff)) {
    if (!isDocFile(a.file) || (rel && !a.file.startsWith(`${rel}/`))) continue;
    if (!byFile.has(a.file)) byFile.set(a.file, []);
    byFile.get(a.file).push(a);
  }
  const sources = [];
  for (const [file, added] of byFile) {
    const text = readNew(file);
    const fenced = text === null ? new Set() : fencedLines(text.split(/\r?\n/));
    sources.push({
      label: file,
      anchors,
      lines: added.filter((a) => !fenced.has(a.line - 1)).map((a) => ({ line: a.line, text: a.text.replace(/\r$/, '') })),
    });
  }
  return sources;
}

// Mọi dòng của spec trừ mục `## Test cases` (fixture của test mang tên bịa), khối rào và dòng
// `Tuyên bố ngoài repo:`.
export function specSource(specText, label, anchors) {
  const lines = specText.split(/\r?\n/);
  const fenced = fencedLines(lines);
  let inCases = false;
  const keep = [];
  lines.forEach((text, i) => {
    if (fenced.has(i)) return;
    const heading = text.match(/^##\s+(.*)$/);
    if (heading) inCases = heading[1].trim().toLowerCase() === 'test cases';
    if (inCases || /^Tuyên bố ngoài repo:/.test(text)) return;
    keep.push({ line: i + 1, text });
  });
  return { label, anchors, lines: keep };
}
