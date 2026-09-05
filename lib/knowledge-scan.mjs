import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SKIP_DIRS } from './source-hash.mjs';

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
const DECLARATION = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
const ARROW = /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*\(([^)]*)\)\s*=>/g;

function walk(root, current, out) {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
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
function readProps(params) {
  const text = params.trim();
  if (text === '') return { props: {}, confident: true };

  const open = text.indexOf('{');
  if (open === -1) return { props: {}, confident: false };

  // Match the brace that closes the destructuring, not the last one on the
  // line: `({ x, y }: { x: string; y: number })` has a type object after it,
  // and reaching for lastIndexOf swallowed half the props while still
  // reporting confidence.
  let braces = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') braces += 1;
    else if (text[i] === '}') {
      braces -= 1;
      if (braces === 0) { close = i; break; }
    }
  }
  if (close === -1) return { props: {}, confident: false };

  const body = text.slice(open + 1, close);
  const props = {};
  let depth = 0;
  let current = '';

  const flush = () => {
    const piece = current.trim();
    current = '';
    if (piece === '' || piece.startsWith('...')) return;

    const eq = piece.indexOf('=');
    const name = (eq === -1 ? piece : piece.slice(0, eq)).trim().split(':')[0].trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return;

    props[name] = eq === -1 ? {} : { default: piece.slice(eq + 1).trim() };
  };

  // Split on commas that are not inside a nested value.
  for (const ch of body) {
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { flush(); continue; }
    current += ch;
  }
  flush();

  return { props, confident: true };
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

// Only the import clause counts: `import X`, `import { X }`, `import { Y as X }`,
// and the require forms.
function importsName(rawText, name) {
  const text = stripCommentsAndStrings(rawText);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clause = String.raw`(?:^|[\s,{])${escaped}(?:$|[\s,}])`;

  const statements = [
    // import ... from '...'  — the whole clause before `from`
    new RegExp(String.raw`import\s+([^;'"]*?)\s+from\s`, 'g'),
    // const ... = require('...')
    new RegExp(String.raw`(?:const|let|var)\s+([^=;]*?)\s*=\s*require\s*\(`, 'g'),
  ];

  for (const pattern of statements) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (new RegExp(clause).test(match[1])) return true;
    }
  }
  return false;
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
        const [, name, params] = match;
        if (components[name]) continue; // first definition wins
        const { props, confident } = readProps(params);
        components[name] = { path: relPath, props, confident, usedIn: 0 };
      }
    }
  }

  // usedIn is what makes dead code visible, so it has to count imports rather
  // than mentions. Searching the whole file counted a TODO saying to delete the
  // component, and a string that merely contained its name — a component
  // nobody imports came back as used twice.
  for (const [name, entry] of Object.entries(components)) {
    let count = 0;
    for (const [relPath, text] of sources) {
      if (relPath === entry.path) continue;
      if (importsName(text, name)) count += 1;
    }
    entry.usedIn = count;
  }

  return { components, files: files.sort() };
}
