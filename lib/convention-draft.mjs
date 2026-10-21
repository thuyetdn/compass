import { closeSync, lstatSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { gitLines } from './git-files.mjs';
import { stripComments } from './repo-detect.mjs';
import { sha256 } from './hash.mjs';
import { runRules } from './rule-runner.mjs';
import { hint } from './report.mjs';
import { SKIP_DIRS } from './source-hash.mjs';
import { loadConfig } from './config.mjs';
import { resolveRepos } from './repos.mjs';

// CP-82 — đọc convention của một repo từ config và từ chính code, soạn bản nháp
// `conventions.md`, và nhận ra khi bản đã chốt cũ đi.
//
// Bản nháp là đề xuất, không phải quyết định. Nó nằm ở `.compass/`, và chỉ người
// chuyển nó vào `.knowledge/decided/` (luật 5: knowledge base do người quyết).
// Mọi thứ ở đây là đọc và đếm: không chạy file config nào, không gọi mạng, không
// gọi agent. Cùng một cây thì ra cùng một bản nháp, từng byte.

export const CONVENTIONS = '.knowledge/decided/conventions.md';
export const DRAFT = '.compass/conventions-draft.md';

// Một convention đếm từ code chỉ được nói ra khi có đủ mẫu và đủ đồng thuận.
// Dưới ngưỡng thì liệt kê tỉ lệ, để người quyết, thay vì gán cho repo một luật nó
// không thật sự theo.
export const MIN_FILES = 20;
export const AGREE = 0.9;

const MAX_FILE_BYTES = 1_000_000;
// Đọc nội dung tối đa 1.000 file, lấy đều theo thứ tự tên, và tối đa 64 KB đầu
// mỗi file. Thống kê không cần cả repo, và việc kiểm tra convention cũ chạy ở mọi
// `init` lẫn `check`: repo 5.000 file không được làm mỗi lần mở task mất nửa phút.
// Bản nháp nói rõ khi chỉ đọc một phần.
const SAMPLE_FILES = 1000;
export const SAMPLE_BYTES = 64 * 1024;

const CODE = /\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$/;
const TEST_FILE = /\.(?:test|spec)\.[^./]+$/;
// Thư mục test ở gốc repo. Không có dấu cách: giá trị này đi vào dấu nguồn, và
// dòng dấu nguồn tách trường bằng dấu cách (lần soi đầu của CP-82).
const ROOT_DIR = './';

// File config đọc được nội dung, và file chỉ nêu tên. File `.js`/`.mjs` là code:
// đọc nó phải chạy nó, mà chạy config của người khác là chạy code lạ trên máy
// này. YAML thì Compass chưa đọc, và đoán thì tệ hơn nói thẳng là chưa đọc.
const READ_SOURCES = ['.editorconfig', '.prettierrc', '.prettierrc.json', '.eslintrc.json', 'tsconfig.json', 'package.json'];
const NAMED_SOURCES = [
  '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs',
  'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs',
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
];
const KNOWN = new Set([...READ_SOURCES, ...NAMED_SOURCES]);

const EDITOR_KEYS = ['indent_style', 'indent_size', 'tab_width', 'end_of_line', 'charset',
  'insert_final_newline', 'trim_trailing_whitespace', 'max_line_length'];
const PRETTIER_KEYS = ['singleQuote', 'semi', 'tabWidth', 'useTabs', 'printWidth', 'trailingComma',
  'jsxSingleQuote', 'arrowParens'];
const SCRIPT_KEYS = ['lint', 'format', 'test'];

const STAT_KEYS = ['indent', 'quotes', 'semi', 'filename', 'test-suffix', 'test-dir'];
const LABEL = {
  indent: 'Thụt lề', quotes: 'Nháy', semi: 'Dấu chấm phẩy', filename: 'Tên file',
  'test-suffix': 'File test', 'test-dir': 'Thư mục test',
};
const WORDS = {
  tab: 'tab', 'spaces-2': '2 dấu cách', 'spaces-4': '4 dấu cách', spaces: 'dấu cách',
  single: 'nháy đơn', double: 'nháy kép',
  semi: 'có dấu chấm phẩy', none: 'không dấu chấm phẩy',
  kebab: 'kebab-case', snake: 'snake_case', camel: 'camelCase', pascal: 'PascalCase',
};
const isTestStat = (key) => key.startsWith('test-');
const unitOf = (key) => (isTestStat(key) ? 'file test' : 'file');
const valueText = (key, value) => (isTestStat(key) ? code(value) : WORDS[value] ?? code(value));

const MARK_START = '<!-- compass-convention-mark v1';

// Giá trị lấy từ file của repo đi vào bản nháp trong một code span đủ dài, và
// không xuống dòng: một script `echo \`\`\`` hay một chuỗi có `\n## ` không được
// mở fence hay dựng heading giữa bản nháp.
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

const fingerprint = (text) => sha256(text).slice(7, 23);

// Một trường của dòng dấu nguồn. Trường tách nhau bằng dấu cách, nên dấu cách
// trong tên thư mục (`my tests/`, repo `web app`) phải được mã hóa, kẻo dấu nguồn
// do chính Compass viết lại bị chính nó từ chối (lần soi thứ hai của CP-82). Mã
// hóa cả `%` để giải được, và `>` để `-->` không bao giờ đóng comment giữa chừng.
const markField = (value) => String(value).replace(/[%>\s]/g, (c) => encodeURIComponent(c));

function unmarkField(field) {
  try {
    return decodeURIComponent(field);
  } catch {
    return null;
  }
}

// Đọc một file ở gốc repo, không đi theo symlink, như mọi chỗ khác đọc file của
// repo (CP-78). `null` là không có file; `{ skip }` là có mà không đọc.
function readRegular(root, rel) {
  let info;
  try {
    info = lstatSync(path.join(root, rel));
  } catch {
    return null;
  }
  if (info.isSymbolicLink()) return { skip: 'là symlink, không đi theo' };
  if (!info.isFile()) return { skip: 'không phải file thường' };
  if (info.size > MAX_FILE_BYTES) return { skip: 'lớn hơn 1 MB' };
  let text;
  try {
    text = readFileSync(path.join(root, rel), 'utf8');
  } catch (err) {
    return { skip: `không mở được (${err.code ?? 'lỗi đọc'})` };
  }
  if (text.includes('\0')) return { skip: 'nhị phân' };
  // CRLF về LF: autocrlf đưa file ra working tree thành CRLF, và một lần checkout
  // không được làm convention trông như đã đổi.
  return { text: text.replace(/\r\n/g, '\n') };
}

// Phần đầu của một file code, cho việc đếm thụt lề, nháy và dấu chấm phẩy. Chỉ
// đọc `SAMPLE_BYTES` đầu: đọc hết 1 MB rồi mới cắt là tốn bộ nhớ và thời gian cho
// phần không dùng tới (lần soi thứ hai của CP-82). Cùng luật bỏ qua như `readRegular`.
function readHead(root, rel) {
  const full = path.join(root, rel);
  let info;
  try {
    info = lstatSync(full);
  } catch {
    return null;
  }
  if (!info.isFile()) return { skip: info.isSymbolicLink() ? 'là symlink, không đi theo' : 'không phải file thường' };
  if (info.size > MAX_FILE_BYTES) return { skip: 'lớn hơn 1 MB' };
  let fd;
  try {
    fd = openSync(full, 'r');
    const buf = Buffer.alloc(Math.min(info.size, SAMPLE_BYTES));
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n);
    if (head.includes(0)) return { skip: 'nhị phân' };
    return { text: new TextDecoder('utf-8').decode(head).replace(/\r\n/g, '\n') };
  } catch (err) {
    return { skip: `không mở được (${err.code ?? 'lỗi đọc'})` };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Cùng hình dạng kết quả với `readHead`, từ một bộ đọc trả chuỗi hay `null`.
function fromReader(read, rel) {
  const text = read(rel);
  if (text === null) return { skip: 'không đọc được' };
  // Cắt theo byte như `readHead`, không theo ký tự: chữ tiếng Việt nhiều byte thì
  // hai cách cắt ra hai đoạn khác nhau, và hai đường đếm lệch nhau trên cùng một cây.
  const head = new TextDecoder('utf-8').decode(Buffer.from(text, 'utf8').subarray(0, SAMPLE_BYTES));
  return { text: head.replace(/\r\n/g, '\n') };
}

function parseJson(text, { comments = false } = {}) {
  try {
    return { value: JSON.parse(text) };
  } catch {
    if (!comments) return { error: true };
  }
  try {
    return { value: JSON.parse(stripComments(text).replace(/,(\s*[}\]])/g, '$1')) };
  } catch {
    return { error: true };
  }
}

function parseEditorconfig(text) {
  const sections = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const head = /^\[(.*)\]$/.exec(line);
    if (head) {
      current = { glob: head[1], keys: {} };
      sections.push(current);
      continue;
    }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (kv && current) current.keys[kv[1].toLowerCase()] = kv[2];
  }
  return sections;
}

// Mục nào của `.editorconfig` áp cho file code: `[*]`, hay glob có nhắc js/ts.
// Mục sau đè mục trước, như chính EditorConfig làm.
const appliesToCode = (glob) => glob === '*' || glob === '**' || /\b(?:[cm]?[jt]sx?)\b/.test(glob);

const isOn = (level) => {
  const v = Array.isArray(level) ? level[0] : level;
  return v === 'error' || v === 'warn' || v === 1 || v === 2;
};

// File config nào được đọc: chỉ file git đang theo dõi, như file code. Một
// `.prettierrc` chưa add trên máy một người không được đổi bản nháp, hay làm
// convention trông như đã cũ chỉ trên máy đó (lần soi thứ hai của CP-82). Thư mục
// không thuộc repo git nào (gốc Compass của dự án nhiều repo) thì không có gì để
// hỏi, nên đọc như trên đĩa.
function trackedConfigs(root, prefixes) {
  const names = [...READ_SOURCES, ...NAMED_SOURCES];
  const known = new Set();
  const open = new Set();
  for (const prefix of prefixes) {
    const lines = gitLines(path.join(root, prefix), ['ls-files', '-z', '--cached', '--', ...names]);
    if (lines === null) open.add(prefix);
    else for (const rel of lines) known.add(join(prefix, rel.split(path.sep).join('/')));
  }
  return (file) => {
    const cut = file.lastIndexOf('/');
    return known.has(file) || open.has(cut < 0 ? '' : file.slice(0, cut));
  };
}

// Mọi nguồn config ở gốc repo. Trả cả phần để in, phần để đối chiếu với code,
// và dấu vân tay của từng file để sau này biết file đã đổi.
function readSources(root) {
  const blocks = [];
  const named = [];
  const unreadable = [];
  const marks = [];
  const expect = {};
  const eslintOn = new Set();

  const note = (key, value, source) => {
    expect[key] = { value, source };
  };

  // Gốc trước, rồi từng repo đã khai: dự án nhiều repo để config trong từng repo.
  const prefixes = [...new Set(['', ...units(root).map((u) => u.prefix)])];
  const tracked = trackedConfigs(root, prefixes);
  for (const prefix of prefixes) for (const name of [...READ_SOURCES, ...NAMED_SOURCES]) {
    const file = join(prefix, name);
    if (!tracked(file)) continue;
    const got = readRegular(root, file);
    if (got === null) continue;
    if (got.skip) {
      unreadable.push(`- ${code(file)}: ${got.skip}`);
      continue;
    }
    const { text } = got;

    if (NAMED_SOURCES.includes(name)) {
      named.push(`- ${code(file)}: Compass không chạy hay đoán nội dung file này. Mở file để chép luật cần giữ.`);
      marks.push({ file, fp: fingerprint(text) });
      continue;
    }

    if (name === '.editorconfig') {
      marks.push({ file, fp: fingerprint(text) });
      const items = [];
      for (const s of parseEditorconfig(text)) {
        const keys = EDITOR_KEYS.filter((k) => s.keys[k] !== undefined);
        if (keys.length === 0) continue;
        items.push(`- ${code(`[${s.glob}]`)}: ${keys.map((k) => `${code(k)} = ${code(s.keys[k])}`).join(', ')}`);
        if (!appliesToCode(s.glob)) continue;
        const style = s.keys.indent_style?.toLowerCase();
        const size = s.keys.indent_size;
        if (style === 'tab') note('indent', 'tab', file);
        else if (style === 'space') note('indent', /^[24]$/.test(size ?? '') ? `spaces-${size}` : 'spaces', file);
      }
      blocks.push({ title: code(file), items: items.length ? items : ['- Không khai khóa nào Compass đọc.'] });
      continue;
    }

    if (name === 'package.json') {
      const parsed = parseJson(text);
      if (parsed.error) {
        unreadable.push(`- ${code(file)}: không phải JSON`);
        marks.push({ file, fp: fingerprint(text) });
        continue;
      }
      const pkg = parsed.value ?? {};
      const scripts = {};
      for (const k of SCRIPT_KEYS) if (typeof pkg.scripts?.[k] === 'string') scripts[k] = pkg.scripts[k];
      // Chỉ phần nói về convention vào dấu vân tay: nâng một dependency không làm
      // convention cũ đi.
      marks.push({ file, fp: fingerprint(JSON.stringify({ prettier: pkg.prettier ?? null, scripts })) });
      if (typeof pkg.prettier === 'string') {
        named.push(`- ${code(file)} → ${code('prettier')}: dùng config chung ${code(pkg.prettier)}; Compass không đọc gói đó.`);
      } else if (pkg.prettier && typeof pkg.prettier === 'object') {
        blocks.push(prettierBlock(`Prettier (${code(file)} → ${code('prettier')})`, pkg.prettier, file, note));
      }
      const lines = Object.entries(scripts).map(([k, v]) => `- ${code(k)}: ${code(v)}`);
      if (lines.length) blocks.push({ title: `Script trong ${code(file)}`, items: lines });
      continue;
    }

    marks.push({ file, fp: fingerprint(text) });
    const parsed = parseJson(text, { comments: name !== '.prettierrc' && name !== '.prettierrc.json' });
    if (parsed.error || parsed.value === null || typeof parsed.value !== 'object') {
      const why = name.startsWith('.prettierrc') ? 'không phải JSON (Compass chưa đọc YAML)' : 'không phải JSON';
      unreadable.push(`- ${code(file)}: ${why}`);
      continue;
    }
    const value = parsed.value;
    if (name.startsWith('.prettierrc')) {
      blocks.push(prettierBlock(`Prettier (${code(file)})`, value, file, note));
    } else if (name === '.eslintrc.json') {
      const rules = Object.entries(value.rules ?? {}).filter(([, level]) => isOn(level)).sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [name] of rules) eslintOn.add(name);
      const items = [];
      if (value.extends) items.push(`- Kế thừa: ${[].concat(value.extends).map(code).join(', ')}`);
      items.push(rules.length
        ? `- Luật bật: ${rules.map(([n, l]) => `${code(n)} (${[].concat(l)[0]})`).join(', ')}`
        : '- Không bật luật nào trực tiếp.');
      blocks.push({ title: `ESLint (${code(file)})`, items });
    } else if (name === 'tsconfig.json') {
      const strict = value.compilerOptions?.strict;
      blocks.push({
        title: code(file),
        items: [strict === undefined ? `- Không khai ${code('strict')}.` : `- ${code('strict')}: ${code(JSON.stringify(strict))}`],
      });
    }
  }
  return { blocks, named, unreadable, marks, expect, eslintOn };
}

function prettierBlock(title, config, source, note) {
  const keys = PRETTIER_KEYS.filter((k) => config[k] !== undefined);
  if (config.useTabs === true) note('indent', 'tab', source);
  else if (config.tabWidth === 2 || config.tabWidth === 4) note('indent', `spaces-${config.tabWidth}`, source);
  if (config.singleQuote === true) note('quotes', 'single', source);
  if (config.singleQuote === false) note('quotes', 'double', source);
  if (config.semi === true) note('semi', 'semi', source);
  if (config.semi === false) note('semi', 'none', source);
  return {
    title,
    items: keys.length ? keys.map((k) => `- ${code(k)}: ${code(JSON.stringify(config[k]))}`) : ['- Không khai khóa nào Compass đọc.'],
  };
}

// Nơi chứa code của dự án: cả gốc khi một repo, từng repo đã khai khi nhiều repo.
// Bố cục nhiều repo trong SKILL.md có gốc không phải repo git, nên phải hỏi git
// trong từng repo (lần soi đầu của CP-82). `prefix` là đường dẫn từ gốc, `''` ở gốc.
function units(root) {
  const loaded = loadConfig(root);
  if (!loaded.ok || loaded.config.repos === undefined) return [{ prefix: '', dir: root }];
  const resolved = resolveRepos(root, loaded.config);
  if (!resolved.ok) return [{ prefix: '', dir: root }];
  return resolved.repos.map((r) => ({ prefix: path.relative(root, r.dir).split(path.sep).join('/'), dir: r.dir }));
}

const join = (prefix, rel) => (prefix ? `${prefix}/${rel}` : rel);

// File đã theo dõi, trừ file đã xóa khỏi cây làm việc: đúng tập của commit đang
// làm, nên file nháp chưa add trên máy một người không đổi được bản nháp hay kết
// luận "đã cũ". Đường dẫn tính từ gốc Compass. `null` khi không nơi nào là repo git.
function listFiles(root) {
  const files = new Set();
  let anyGit = false;
  for (const unit of units(root)) {
    const cached = gitLines(unit.dir, ['ls-files', '-z', '--cached']);
    if (cached === null) continue;
    anyGit = true;
    const gone = new Set(gitLines(unit.dir, ['ls-files', '-z', '--deleted']) ?? []);
    for (const raw of cached) {
      if (gone.has(raw)) continue;
      const rel = join(unit.prefix, raw.split(path.sep).join('/'));
      if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) continue;
      files.add(rel);
    }
  }
  return anyGit ? [...files].sort() : null;
}

function nameCase(rel) {
  const base = path.posix.basename(rel).split('.')[0];
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(base)) return 'kebab';
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(base)) return 'snake';
  if (/^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(base)) return 'camel';
  if (/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(base)) return 'pascal';
  // Một từ thường (`index`, `utils`) hợp mọi kiểu, nên không phải bằng chứng cho kiểu nào.
  return null;
}

function testShape(rel) {
  const base = path.posix.basename(rel);
  const inTestsDir = rel.split('/').includes('__tests__');
  if (!TEST_FILE.test(base) && !inTestsDir) return null;
  const suffix = TEST_FILE.test(base) ? `*${base.slice(base.search(/\.(?:test|spec)\./))}` : `*${path.posix.extname(base)}`;
  const dir = rel.includes('/') ? `${rel.split('/')[0]}/` : ROOT_DIR;
  return { suffix, dir };
}

// Một lượt qua code đã bỏ chú thích: đếm dấu nháy mở chuỗi, và trả bản code mà
// nội dung chuỗi và template literal đã bị làm trắng (giữ xuống dòng). Thụt lề và
// dấu chấm phẩy đếm trên bản đó: CSS trong styled-components (`color: red;`) là
// nội dung chuỗi, không phải câu lệnh, và từng làm repo không dùng dấu chấm phẩy
// thành "không nhất quán" (lần soi thứ ba của CP-82).
//
// Bỏ qua thuộc tính JSX (`className="x"`) khi đếm nháy: JSX viết nháy kép theo lệ
// riêng, kể cả khi code dùng nháy đơn.
function scanStrings(text) {
  let single = 0;
  let double = 0;
  let quote = null;
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        out.push(' ', text[i + 1] === '\n' ? '\n' : ' ');
        i += 1;
        continue;
      }
      if (ch === quote || (ch === '\n' && quote !== '`')) {
        quote = null;
        out.push(ch === '\n' ? '\n' : ch);
        continue;
      }
      out.push(ch === '\n' ? '\n' : ' ');
      continue;
    }
    out.push(ch);
    if (ch === "'") { single += 1; quote = ch; }
    else if (ch === '"') {
      if (!(text[i - 1] === '=' && /[\w-]/.test(text[i - 2] ?? ''))) double += 1;
      quote = ch;
    } else if (ch === '`') quote = ch;
  }
  let quotes = null;
  if (single > double) quotes = 'single';
  else if (double > single) quotes = 'double';
  return { quotes, layout: out.join('') };
}

function analyse(raw) {
  const { quotes, layout: text } = scanStrings(stripComments(raw));
  let tabs = 0;
  let spaced = 0;
  let even = 0;
  let four = 0;
  let two = 0;
  let semiLines = 0;
  let codeLines = 0;
  for (const line of text.split('\n')) {
    const t = line.trimEnd();
    if (t.trim() === '') continue;
    codeLines += 1;
    const lead = /^[ \t]+/.exec(t);
    if (lead) {
      if (lead[0].includes('\t')) tabs += 1;
      else {
        const n = lead[0].length;
        spaced += 1;
        if (n % 2 === 0) even += 1;
        if (n % 4 === 0) four += 1;
        if (n === 2) two += 1;
      }
    }
    if (t.endsWith(';') && !/^\s*for\s*\(/.test(t)) semiLines += 1;
  }
  let indent = null;
  if (tabs > spaced) indent = 'tab';
  else if (spaced > 0 && two > 0 && even >= AGREE * spaced) indent = 'spaces-2';
  else if (spaced > 0 && four >= AGREE * spaced) indent = 'spaces-4';
  let semi = null;
  if (semiLines > 0) semi = 'semi';
  else if (codeLines >= 3) semi = 'none';
  return { indent, quotes, semi };
}

// Một hàm đếm cho cả bản nháp lẫn việc kiểm tra convention cũ, để hai bên không bao
// giờ hiểu khác nhau thế nào là "38 / 40".
// `read(rel)`: đọc nội dung thay cho đĩa, như bộ đọc từ object của git mà
// `compass pr` dùng cho worktree vừa checkout (lần soi thứ hai của CP-81).
function countRepo(root, files, read = null) {
  const codeFiles = files.filter((f) => CODE.test(f));
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, new Map()]));
  const add = (key, value) => {
    if (value !== null) stats[key].set(value, (stats[key].get(value) ?? 0) + 1);
  };
  // Thư mục test tính trong từng repo: ở dự án nhiều repo, `fe/test/x.test.js` có
  // thư mục test là `test/`, không phải tên repo `fe/` (lần soi thứ ba của CP-82).
  const leads = units(root).map((u) => (u.prefix ? `${u.prefix}/` : '')).sort((a, b) => b.length - a.length);
  const inRepo = (rel) => rel.slice((leads.find((l) => rel.startsWith(l)) ?? '').length);
  for (const rel of codeFiles) {
    add('filename', nameCase(rel));
    const shape = testShape(inRepo(rel));
    if (shape) {
      add('test-suffix', shape.suffix);
      add('test-dir', shape.dir);
    }
  }
  const n = codeFiles.length;
  const sample = n <= SAMPLE_FILES ? codeFiles : Array.from({ length: SAMPLE_FILES }, (_, k) => codeFiles[Math.floor((k * n) / SAMPLE_FILES)]);
  let counted = 0;
  for (const rel of sample) {
    const got = read ? fromReader(read, rel) : readHead(root, rel);
    if (!got || got.skip) continue;
    counted += 1;
    const found = analyse(got.text);
    add('indent', found.indent);
    add('quotes', found.quotes);
    add('semi', found.semi);
  }
  return { codeTotal: n, counted, sampled: sample.length < n, stats };
}

// Giá trị dẫn đầu, theo số đếm rồi theo tên để cùng một cây luôn ra cùng một kết quả.
function summarize(map) {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (total === 0) return { total: 0, entries };
  return { value: entries[0][0], agree: entries[0][1], total, entries };
}

const verdict = (s) => {
  if (s.total < MIN_FILES) return 'few';
  return s.agree / s.total >= AGREE ? 'stated' : 'mixed';
};

const sameShape = (expected, actual) => expected === actual || (expected === 'spaces' && actual.startsWith('spaces-'));

// Ứng viên luật máy chạy được. Mỗi cái chỉ được đề xuất khi code hôm nay không
// phá nó chỗ nào: một luật đỏ ngay ngày đầu chỉ dạy người ta tắt gate.
function candidates(eslintOn, summaries) {
  const out = [];
  if (eslintOn.has('no-var')) {
    out.push({ base: 'no-var', title: `Không dùng ${code('var')}`, why: `ESLint bật ${code('no-var')}`, pattern: String.raw`\bvar\s+[A-Za-z_$]`, message: 'Dùng let hoặc const thay cho var' });
  }
  if (eslintOn.has('no-console')) {
    out.push({ base: 'no-console', title: `Không để ${code('console.log')}`, why: `ESLint bật ${code('no-console')}`, pattern: String.raw`\bconsole\.log\(`, message: 'Bỏ console.log trước khi commit' });
  }
  if (eslintOn.has('no-debugger')) {
    out.push({ base: 'no-debugger', title: `Không để ${code('debugger')}`, why: `ESLint bật ${code('no-debugger')}`, pattern: String.raw`\bdebugger\b`, message: 'Bỏ debugger trước khi commit' });
  }
  const indent = summaries.indent;
  if (verdict(indent) === 'stated' && indent.value.startsWith('spaces-')) {
    out.push({ base: 'no-tab-indent', title: 'Thụt lề bằng dấu cách', why: `Code thụt lề bằng ${WORDS[indent.value]} (${indent.agree} / ${indent.total} file)`, pattern: '^\\t', message: 'Thụt lề bằng dấu cách, không dùng tab' });
  }
  return out;
}

function ruleBlock(rule) {
  return [
    '```rule',
    `id: ${rule.id}`,
    'type: forbid-pattern',
    `pattern: "${rule.pattern}"`,
    `scope: "${rule.scope}"`,
    'severity: warn',
    `message: ${rule.message}`,
    '```',
  ];
}

// Soạn bản nháp. `{ ok: false, reason }` khi không soạn được.
export function buildDraft(root) {
  const files = listFiles(root);
  if (files === null) return { ok: false, reason: 'Không phải repo git — cần git để biết file nào là code của repo.' };

  const sources = readSources(root);
  const counts = countRepo(root, files);
  const summaries = Object.fromEntries(STAT_KEYS.map((k) => [k, summarize(counts.stats[k])]));
  // Chỉ hỏi file có không: bản nháp không đọc file đã quyết.
  let hasDecided = false;
  try {
    lstatSync(path.join(root, CONVENTIONS));
    hasDecided = true;
  } catch { /* không có */ }

  const out = [
    '# Convention của repo (bản nháp)',
    '',
    `> Bản nháp do ${code('compass convention --draft')} soạn từ config và code của repo. Chưa phải quyết định:`,
    `> đọc, sửa chỗ sai, rồi tự chuyển thành ${code(CONVENTIONS)}. Compass không làm bước đó.`,
    '',
  ];
  if (hasDecided) {
    out.push(`Repo đã có ${code(CONVENTIONS)}. Bản nháp này không đọc file đó; so hai file trước khi thay.`, '');
  }

  out.push('## Từ file config', '');
  if (sources.blocks.length === 0 && sources.named.length === 0 && sources.unreadable.length === 0) {
    out.push(`- Không thấy file config nào Compass biết (${code('.editorconfig')}, Prettier, ESLint, ${code('tsconfig.json')}, ${code('package.json')}).`, '');
  }
  for (const block of sources.blocks) out.push(`### ${block.title}`, '', ...block.items, '');
  if (sources.named.length) out.push('### Khai trong file Compass không đọc', '', ...sources.named, '');
  if (sources.unreadable.length) out.push('### Không đọc được', '', ...sources.unreadable, '');

  out.push('## Đếm từ code', '');
  const stated = [];
  const mixed = [];
  const few = [];
  if (counts.codeTotal === 0) {
    out.push('Không có file code nào để đếm (JS hay TS, đã theo dõi trong git).', '');
  } else {
    const spread = counts.sampled ? `, lấy đều theo thứ tự tên trong ${counts.codeTotal} file` : '';
    out.push(`Đếm trên ${counts.codeTotal} file code đã theo dõi trong git. Tên file đếm trên cả ${counts.codeTotal};`,
      `thụt lề, nháy và dấu chấm phẩy đọc từ ${counts.counted} file${spread}, mỗi file tối đa ${SAMPLE_BYTES / 1024} KB đầu.`, '');
    for (const key of STAT_KEYS) {
      const s = summaries[key];
      if (s.total === 0) continue;
      const unit = unitOf(key);
      const v = verdict(s);
      if (v === 'stated') stated.push({ key, ...s, line: `- ${LABEL[key]}: ${valueText(key, s.value)} — ${s.agree} / ${s.total} ${unit}` });
      else if (v === 'mixed') mixed.push(`- ${LABEL[key]}: ${s.entries.map(([val, c]) => `${valueText(key, val)} ${c}`).join(', ')} (trên ${s.total} ${unit})`);
      else few.push(`- ${LABEL[key]}: ${s.total} ${unit}, cần ít nhất ${MIN_FILES}`);
    }
    out.push(...(stated.length ? stated.map((s) => s.line) : ['- Chưa có convention nào đủ mẫu và đủ đồng thuận để nói ra.']), '');
    if (mixed.length) out.push('### Không nhất quán', '', `Dưới ${AGREE * 100} % file đồng ý, nên chưa phải convention. Người quyết chọn bên nào.`, '', ...mixed, '');
    if (few.length) out.push('### Chưa đủ mẫu', '', ...few, '');
  }

  out.push('## Cần người quyết', '');
  const conflicts = [];
  for (const s of stated) {
    const expected = sources.expect[s.key];
    if (expected && !sameShape(expected.value, s.value)) {
      conflicts.push(`- ${LABEL[s.key]}: ${code(expected.source)} khai ${WORDS[expected.value]}, nhưng code dùng ${valueText(s.key, s.value)} (${s.agree} / ${s.total} file)`);
    }
  }
  out.push(...(conflicts.length ? conflicts : ['- Không thấy chỗ nào config và code nói khác nhau.']), '');

  out.push('## Luật đề xuất', '', `Mỗi luật dưới đây đã chạy thử trên code hôm nay và không ra vi phạm nào. Tất cả để ${code('severity: warn')}; người duyệt nâng lên ${code('error')} nếu muốn chặn.`, '');
  const exts = [...new Set(files.filter((f) => CODE.test(f)).map((f) => path.posix.extname(f)))].sort();
  const cands = candidates(sources.eslintOn, summaries);
  const rules = [];
  for (const c of cands) {
    for (const ext of exts) rules.push({ ...c, id: `${c.base}-${ext.slice(1)}`, scope: `**/*${ext}` });
  }
  // Chạy thử như gate sẽ chạy — từng repo, khớp scope theo cả đường dẫn trong repo
  // lẫn đường dẫn từ gốc — nhưng chỉ trên file đã theo dõi: file nháp chưa add có
  // `console.log` không được gạt một luật ra khỏi bản nháp (lần soi thứ hai của CP-82).
  const broken = new Map();
  if (rules.length) {
    const asRules = rules.map((r) => ({ id: r.id, type: 'forbid-pattern', pattern: r.pattern, scope: r.scope, severity: 'warn', message: r.message }));
    for (const unit of units(root)) {
      const lead = unit.prefix ? `${unit.prefix}/` : '';
      const mine = files.filter((f) => f.startsWith(lead)).map((f) => f.slice(lead.length));
      const run = runRules(unit.dir, asRules, { prefix: unit.prefix, files: mine });
      for (const v of run.violations) broken.set(v.rule, (broken.get(v.rule) ?? 0) + 1);
    }
  }
  const kept = rules.filter((r) => !broken.has(r.id));
  const left = rules.filter((r) => broken.has(r.id));
  if (kept.length === 0) out.push('- Không có luật nào máy chạy được để đề xuất.', '');
  for (const c of cands) {
    const mine = kept.filter((r) => r.base === c.base);
    if (mine.length === 0) continue;
    out.push(`### ${c.title}`, '', `${c.why}, và code hôm nay không phá chỗ nào.`, '');
    for (const r of mine) out.push(...ruleBlock(r), '');
  }
  if (left.length) {
    out.push('### Không đề xuất', '', ...left.map((r) => `- ${code(r.id)}: ${broken.get(r.id)} chỗ đang phá luật này, nên chưa đề xuất. Sửa code, hoặc bỏ luật khỏi config, trước.`), '');
  }

  out.push(
    '## Dấu nguồn',
    '',
    'Comment cuối file là dấu nguồn: Compass dùng nó để báo khi config hay code đã đổi so với lúc soạn.',
    'Giữ nguyên nó khi chuyển file vào `.knowledge/decided/`.',
    '',
    MARK_START,
    ...sources.marks.map((m) => `source ${markField(m.file)} ${m.fp}`),
    ...stated.map((s) => `stat ${s.key} ${markField(s.value)} ${s.agree}/${s.total}`),
    '-->',
    '',
  );

  return {
    ok: true,
    text: out.join('\n'),
    summary: { configs: sources.blocks.length + sources.named.length, stated: stated.length, rules: kept.length },
  };
}

// `known(file)` nói một tên trong dấu nguồn có phải file config Compass biết không.
// Lấy lần xuất hiện CUỐI của dòng mở: dấu nguồn thật luôn ở cuối file, và một giá
// trị config chép nguyên dòng mở vào phần trên không được cướp nó (lần soi đầu
// của CP-82).
function parseMark(text, known) {
  const i = text.lastIndexOf(MARK_START);
  if (i < 0) return null;
  const end = text.indexOf('-->', i);
  if (end < 0) return { error: 'thiếu dòng đóng -->' };
  const sources = [];
  const stats = [];
  const ignored = [];
  for (const raw of text.slice(i + MARK_START.length, end).split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    let m = /^source (\S+) ([0-9a-f]{16})$/.exec(line);
    if (m) {
      const file = unmarkField(m[1]);
      if (file === null) return { error: `dòng không hiểu được: ${code(line.slice(0, 60))}` };
      // Dấu nguồn là dữ liệu, không phải danh sách đường dẫn để đi theo: chỉ tên
      // config Compass biết, ở gốc hay ở một repo đã khai, mới được đọc lại.
      if (known(file)) sources.push({ file, fp: m[2] });
      else ignored.push(file);
      continue;
    }
    m = /^stat (\S+) (\S+) (\d+)\/(\d+)$/.exec(line);
    const value = m ? unmarkField(m[2]) : null;
    if (m && STAT_KEYS.includes(m[1]) && value !== null) {
      stats.push({ key: m[1], value, agree: Number(m[3]), total: Number(m[4]) });
      continue;
    }
    return { error: `dòng không hiểu được: ${code(line.slice(0, 60))}` };
  }
  return { sources, stats, ignored };
}

function currentMarks(root) {
  const marks = new Map();
  for (const m of readSources(root).marks) marks.set(m.file, m.fp);
  return marks;
}

// Convention đã chốt còn khớp repo không. Chạy ở `init`, ở gate `convention` và
// trong brief soi code, không đợi ai bảo. Không bao giờ ghi file, không bao giờ
// đổi mã thoát của ai. `counted` là số file đã đọc để đếm lại: không có dấu nguồn
// thì không đếm gì.
export function conventionStatus(root, { read = null } = {}) {
  const got = readRegular(root, CONVENTIONS);
  if (got === null) {
    return {
      state: 'missing',
      counted: 0,
      reasons: [],
      lines: [`⚠ Chưa có ${CONVENTIONS} — chạy: compass convention --draft, rồi đưa bản nháp cho người duyệt.`],
    };
  }
  if (got.skip) {
    return { state: 'unreadable', counted: 0, reasons: [], lines: [`⚠ Không đọc được ${CONVENTIONS} (${got.skip}) — không xét được nó đã cũ hay chưa.`] };
  }
  const prefixes = new Set(['', ...units(root).map((u) => u.prefix)]);
  const known = (file) => {
    const cut = file.lastIndexOf('/');
    return KNOWN.has(file.slice(cut + 1)) && prefixes.has(cut < 0 ? '' : file.slice(0, cut));
  };
  const mark = parseMark(got.text, known);
  if (mark === null) {
    return { state: 'unmarked', counted: 0, reasons: [], lines: [`ℹ ${CONVENTIONS} không có dấu nguồn của Compass, nên Compass không biết nó đã cũ hay chưa.`] };
  }
  if (mark.error) {
    return { state: 'bad-mark', counted: 0, reasons: [], lines: [`⚠ Dấu nguồn trong ${CONVENTIONS} hỏng (${mark.error}) — không xét được convention đã cũ hay chưa.`] };
  }

  const notes = mark.ignored.map((f) => `⚠ Dấu nguồn nhắc tới ${code(f)}, không phải file config Compass biết — bỏ qua, không đọc.`);
  const reasons = [];
  const now = currentMarks(root);
  const recorded = new Set();
  for (const s of mark.sources) {
    recorded.add(s.file);
    const fp = now.get(s.file);
    if (fp === undefined) reasons.push(`${code(s.file)} đã bị xóa hoặc không còn đọc được`);
    else if (fp !== s.fp) reasons.push(`${code(s.file)} đã đổi từ lúc soạn`);
  }
  for (const file of now.keys()) {
    if (!recorded.has(file)) reasons.push(`${code(file)} mới xuất hiện, chưa có trong bản nháp`);
  }

  let counted = 0;
  if (mark.stats.length) {
    const files = listFiles(root);
    if (files === null) {
      notes.push('⚠ Không đếm lại được code (không phải repo git), nên chỉ so được file config.');
    } else {
      const counts = countRepo(root, files, read);
      counted = counts.counted;
      for (const st of mark.stats) {
        const cur = summarize(counts.stats[st.key]);
        if (cur.total >= MIN_FILES && cur.value === st.value && cur.agree / cur.total >= AGREE) continue;
        const unit = unitOf(st.key);
        const was = `${valueText(st.key, st.value)} ${st.agree} / ${st.total} ${unit}`;
        const is = cur.total ? `${valueText(st.key, cur.value)} ${cur.agree} / ${cur.total} ${unit}` : `không còn ${unit} nào để đếm`;
        reasons.push(`${LABEL[st.key]}: lúc soạn ${was}, giờ ${is}`);
      }
    }
  }

  if (reasons.length === 0) return { state: 'fresh', counted, reasons, lines: notes };
  return {
    state: 'stale',
    counted,
    reasons,
    lines: [
      `⚠ ${CONVENTIONS} có thể đã cũ:`,
      ...reasons.map((r) => `  - ${r}`),
      ...notes,
      hint('Chạy: compass convention --draft, rồi đưa người duyệt chỗ khác với file đang dùng.'),
    ],
  };
}
