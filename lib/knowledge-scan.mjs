import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SKIP_DIRS } from './source-hash.mjs';
import { isLinkedWorktree } from './worktree.mjs';

// Pattern matching, not an AST. Node ships no TypeScript or JSX parser, and
// adding one would break zero-dependency — the same trade the convention gate
// makes. The cost is real: anything but a plain destructured parameter list is
// beyond this scanner. It says so instead of guessing, through `confident`.
//
// Documentation that is wrong while claiming certainty is worse than none, so
// an entry Compass could not read fully is marked rather than filled in.

const SOURCE_EXT = new Set(['.jsx', '.tsx', '.js', '.ts', '.mjs', '.cjs', '.mts', '.cts']);
const COMPONENT_EXT = new Set(['.jsx', '.tsx']);

// A React component is a capitalised function. Two shapes cover almost every
// one written today: a declaration, and a const holding an arrow.
//
// The patterns stop at the `(` that opens the parameter list; `closingParen`
// finds where it ends. Reading the list as `[^)]*` let the first `)` inside a
// default end it: `({ x = fallback(1), y }) =>` then had no `=>` after its
// "end", and the component vanished from the KB without a word.
const DECLARATION = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;
const ARROW = /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*\(/g;
// An arrow header is a component only when `=>` follows its balanced `)`.
// `export const Total = (a + b);` has the same header and is not one.
const ARROW_TAIL = /\s*=>/y;

function walk(root, current, out) {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  // Worktree liên kết là bản sao của chính dự án (CP-60): quét nó thì KB trỏ vào
  // bản của agent và gate báo hàng trăm file "mới thêm".
  if (current !== root && isLinkedWorktree(current, entries)) return;
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name === '.knowledge') continue;
      walk(root, full, out);
    } else if (entry.isFile() && SOURCE_EXT.has(path.extname(entry.name))) {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
}

// `{ variant = 'primary', size, ...rest }` → the names, and any defaults.
// Anything else — a bare `props`, a typed interface reference — reads as not
// understood rather than as an empty component.
// The `=` that assigns a prop's default, or -1. Only a `=` at depth zero does
// that: in `({ a: { b = 1 } })` the `=` belongs to `b`, a name inside the
// pattern that is not a prop at all. Taking the first `=` reported
// `a.default = "1 }"` — a value that is not a value — and still claimed
// confidence, which is the one thing this scanner promises not to do.
//
// Strings are skipped for the reason they are skipped everywhere else here: a
// default like `close = '}'` holds a brace that would otherwise change depth.
function topLevelEquals(piece) {
  let depth = 0;
  let quote = null;

  for (let i = 0; i < piece.length; i++) {
    const ch = piece[i];

    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }

    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    // `=>`, `==`, `>=` and friends are not assignment. A default arrow like
    // `onX = () => {}` opens its body after a `=` already found at depth 0.
    else if (ch === '=' && depth === 0 && piece[i + 1] !== '=' && piece[i - 1] !== '!'
             && piece[i - 1] !== '<' && piece[i - 1] !== '>' && piece[i - 1] !== '=') {
      return i;
    }
  }
  return -1;
}

function readProps(params) {
  const text = params.trim();
  if (text === '') return { props: {}, confident: true };

  const open = text.indexOf('{');
  if (open === -1) return { props: {}, confident: false };

  // The brace has to start the parameter. In `props: { alpha: string }` it
  // opens the *type*, and mining it invented `alpha` as a prop of a parameter
  // actually named `props` — while still claiming confidence.
  if (text.slice(0, open).trim() !== '') return { props: {}, confident: false };

  // Match the brace that closes the destructuring, not the last one on the
  // line: `({ x, y }: { x: string; y: number })` has a type object after it,
  // and reaching for lastIndexOf swallowed half the props while still
  // reporting confidence.
  // Skip over string contents: a default value like `close = '}'` holds a
  // brace that would close the block early, dropping every prop after it while
  // the function still reported confidence.
  let braces = 0;
  let close = -1;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') braces += 1;
    else if (ch === '}') {
      braces -= 1;
      if (braces === 0) { close = i; break; }
    }
  }
  if (close === -1) return { props: {}, confident: false };

  const body = text.slice(open + 1, close);
  const props = {};
  let depth = 0;
  let current = '';
  let understood = true;

  const flush = () => {
    const piece = current.trim();
    current = '';
    // A rest element is read, not lost, and a trailing comma leaves nothing.
    if (piece === '' || piece.startsWith('...')) return;

    const eq = topLevelEquals(piece);
    const name = (eq === -1 ? piece : piece.slice(0, eq)).trim().split(':')[0].trim();

    // A piece that yields no name — `'data-id': id`, `[key]: v`, a comment —
    // is a prop this scanner did not read. Dropping it quietly documented `S`
    // as taking two props while claiming confidence. `__proto__` passes the
    // pattern but `props[name] = …` would set the prototype, not add a key.
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || name === '__proto__') {
      understood = false;
      return;
    }

    props[name] = eq === -1 ? {} : { default: piece.slice(eq + 1).trim() };
  };

  // Split on commas that are not inside a nested value — and not inside a
  // string. `close = '}'` drove depth negative, after which no comma split
  // again and every prop behind it was swallowed.
  let inString = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (inString) {
      current += ch;
      if (ch === '\\') { current += body[i + 1] ?? ''; i += 1; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; current += ch; continue; }

    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { flush(); continue; }
    current += ch;
  }
  flush();

  return { props, confident: understood };
}

// The `)` that closes the parameter list opened at `open`, or -1.
//
// Strings are skipped as `readProps` skips them — `close = ')'` holds a paren
// that is not one — and so are comments, which a list may hold too.
//
// The scan gives up at the end of the file or at the next line starting with
// `export`, whichever comes first. A list that never balances would otherwise
// swallow the component after it, and a file of broken headers would be read
// to its end once per header.
function closingParen(text, open) {
  let depth = 0;
  let quote = null;
  let comment = null; // '//' or '/*'

  for (let i = open; i < text.length; i++) {
    const ch = text[i];

    if (ch === '\n' && text.startsWith('export', i + 1)
        && !/[A-Za-z0-9_$]/.test(text[i + 7] ?? '')) {
      return -1;
    }

    if (comment === '//') {
      if (ch === '\n') comment = null;
      continue;
    }
    if (comment === '/*') {
      if (ch === '*' && text[i + 1] === '/') { comment = null; i += 1; }
      continue;
    }
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      comment = ch + text[i + 1];
      i += 1;
      continue;
    }

    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Comments and string literals are removed before anything is matched. A
// commented-out import is the most common way a dead component's name lingers
// in a file — counting it would report the component as still used, which is
// exactly the question usedIn exists to answer.
function stripCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      out += ' ';
      continue;
    }
    const ch = text[i];

    // A regex literal can hold a lone quote — `/['"]/g` does, and Compass's own
    // paths.mjs has one. Skipping it opened a phantom string that swallowed the
    // import line below, so a live component reported usedIn: 0.
    if (ch === '/' && startsRegex(out)) {
      i += 1;
      let inClass = false;
      while (i < text.length) {
        const c = text[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        else if (c === '\n') break; // unterminated: stop rather than run away
        i += 1;
      }
      i += 1;
      out += ' ';
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += "''"; // keep the import path's shape without its contents
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// `/` opens a regex only where a value may begin. After an identifier, a
// number, or a closing bracket it is division.
//
// Looking at one character is not enough: `return /['"]/` ends in the `n` of
// `return`, which reads as an identifier and so as division. These keywords are
// followed by a value, never by a divisor.
const VALUE_KEYWORDS = new Set([
  'return', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void',
  'yield', 'await', 'case', 'do', 'else', 'new',
]);

export function startsRegex(before) {
  const trimmed = before.replace(/\s+$/, '');
  if (trimmed === '') return true;

  const prev = trimmed.slice(-1);
  if (!/[A-Za-z0-9_$)\]]/.test(prev)) return true;

  const word = trimmed.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
  if (word === null || !VALUE_KEYWORDS.has(word[0])) return false;

  // `obj.of` is a property named `of`, not the keyword — what follows is
  // division. A dot before the word settles it.
  return trimmed[trimmed.length - word[0].length - 1] !== '.';
}

// Only the import clause counts: `import X`, `import { X }`, `import { Y as X }`,
// and the require forms.
// Tên mà một file import, trích **một lần** cho cả file.
//
// Bản cũ hỏi từng tên một: mỗi cặp (component, file) tốn một lần bóc chuỗi
// cộng một lần quét toàn file tìm câu lệnh import. 100 component trên 200 file
// thành 19.900 lượt thay vì 200, và gate chạy bậc hai — 120 file 91ms, 960 file
// gần 4 giây. Gate này chạy mỗi lần `check`, nên chậm là người ta tắt nó.
//
// Chỉ mệnh đề import mới tính: `import X`, `import { X }`, `import { Y as X }`,
// và dạng require. Quét cả file thì một chuỗi chứa tên, hay một TODO bảo xoá
// component, cũng bị đếm là dùng.
function importedNames(text) {
  const names = new Set();
  const statements = [
    new RegExp(String.raw`import\s+([^;'"]*?)\s+from\s`, 'g'),
    new RegExp(String.raw`(?:const|let|var)\s+([^=;]*?)\s*=\s*require\s*\(`, 'g'),
  ];

  for (const pattern of statements) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Một mệnh đề mang nhiều tên: `{ A, B as C }`, `X, { Y }`. Tách theo dấu
      // phân cách rồi bỏ từ khoá — `as` và `type` không phải tên.
      for (const raw of match[1].split(/[\s,{}]+/)) {
        const t = raw.trim();
        if (t !== '' && t !== 'as' && t !== 'type' && t !== '*') names.add(t);
      }
    }
  }
  return names;
}

export function scanComponents(root) {
  const files = [];
  walk(root, root, files);

  const components = {};
  const sources = new Map();

  for (const relPath of files) {
    let text;
    try {
      text = readFileSync(path.join(root, relPath), 'utf8');
    } catch {
      continue;
    }
    sources.set(relPath, text);

    if (!COMPONENT_EXT.has(path.extname(relPath))) continue;

    for (const pattern of [DECLARATION, ARROW]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        const open = pattern.lastIndex - 1;
        const close = closingParen(text, open);

        // A list that never balances is still a component, listed as not
        // read. The search resumes right after its header, so the next
        // `export` line — where the scan gave up — is matched as usual.
        if (close === -1) {
          if (!components[name]) {
            components[name] = { path: relPath, props: {}, confident: false, usedIn: 0 };
          }
          continue;
        }

        pattern.lastIndex = close + 1;
        if (pattern === ARROW) {
          ARROW_TAIL.lastIndex = close + 1;
          if (!ARROW_TAIL.test(text)) continue;
        }

        if (components[name]) continue; // first definition wins
        const { props, confident } = readProps(text.slice(open + 1, close));
        components[name] = { path: relPath, props, confident, usedIn: 0 };
      }
    }
  }

  // usedIn is what makes dead code visible, so it has to count imports rather
  // than mentions. Searching the whole file counted a TODO saying to delete the
  // component, and a string that merely contained its name — a component
  // nobody imports came back as used twice.
  // Duyệt mỗi file **một lần**, rồi tra ngược: file này import những tên nào,
  // tên nào là component thì tăng bộ đếm của nó.
  //
  // Bản trước bỏ được thừa số đắt (bóc chuỗi lại cho từng cặp) nhưng vẫn giữ
  // vòng lồng component × file, nên vẫn bậc hai — chỉ là hệ số nhỏ hơn nên phải
  // đo tới 4000 file mới thấy: 1000 file 143ms, 4000 file 2238ms, tỉ số 15.7.
  for (const entry of Object.values(components)) entry.usedIn = 0;

  for (const [relPath, text] of sources) {
    for (const name of importedNames(stripCommentsAndStrings(text))) {
      const entry = components[name];
      // Một file import chính mình không tính — đó là cùng một module.
      if (entry !== undefined && relPath !== entry.path) entry.usedIn += 1;
    }
  }

  return { components, files: files.sort() };
}
