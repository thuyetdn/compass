import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isLinkedWorktree } from './worktree.mjs';

// Directories nobody writes conventions for. Scanning them is slow and every
// hit is noise from code the project does not own.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.compass']);

// A regex with nested quantifiers can take exponential time on a long line, and
// JS offers no way to interrupt it. Compass caps the input instead: a line this
// long is minified or generated, not something a convention applies to.
const MAX_LINE_LENGTH = 2000;

function segmentToRegex(segment) {
  let out = '';
  for (const ch of segment) {
    if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

// Glob support is deliberately small: **, *, ? and literals. Anything fancier
// belongs in a real matcher, and pulling one in would break zero-dependency.
export function matchesScope(relPath, scope) {
  const normalised = relPath.split(path.sep).join('/');
  const parts = scope.split('/');

  let pattern = '^';
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    if (part === '**') {
      // ** spans any number of segments, including none.
      pattern += last ? '.*' : '(?:.*/)?';
      return;
    }
    pattern += segmentToRegex(part);
    if (!last) pattern += '/';
  });
  pattern += '$';

  return new RegExp(pattern).test(normalised);
}

function walk(root, current, out) {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return; // unreadable directory is not a convention problem
  }
  // Code của agent trong worktree liên kết không phải code của task (CP-60).
  if (current !== root && isLinkedWorktree(current, entries)) return;

  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(root, full, out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, full));
    }
  }
}

// `root` là thư mục được quét. Dự án nhiều repo quét từng repo, và `prefix` là
// đường dẫn của repo tính từ gốc Compass (`fe`). Luật vẫn viết một lần ở gốc,
// nên `scope` khớp được cả hai cách viết: theo repo (`src/App.jsx`) và theo gốc
// (`fe/src/App.jsx`) — luật đã viết theo gốc để lách cách quét cũ vẫn chạy. Vi
// phạm in theo gốc, để người đọc biết file nằm ở repo nào.
// `files`: danh sách file (tính từ `root`) để quét thay cho việc tự duyệt thư mục.
// Bản nháp convention dùng nó để chạy thử luật chỉ trên file đã theo dõi trong
// git (CP-82); gate không truyền, nên vẫn quét như cũ.
export function runRules(root, rules, { prefix = '', files: only = null } = {}) {
  const violations = [];
  const skippedRules = [];
  const scannedFiles = new Set();

  const compiled = [];
  for (const rule of rules) {
    try {
      compiled.push({ rule, regex: new RegExp(rule.pattern) });
    } catch {
      skippedRules.push(rule.id);
    }
  }
  if (compiled.length === 0) {
    return { violations, errorCount: 0, warnCount: 0, scanned: 0, skippedRules };
  }

  const files = [];
  if (only) files.push(...only);
  else walk(root, root, files);

  for (const relPath of files) {
    const fromRoot = prefix ? path.join(prefix, relPath) : relPath;
    const applicable = compiled.filter(({ rule }) =>
      matchesScope(relPath, rule.scope) || (prefix !== '' && matchesScope(fromRoot, rule.scope)));
    if (applicable.length === 0) continue;

    let content;
    try {
      // lstat, không đi theo link: `walk` vốn không trả symlink, nhưng danh sách
      // `files` truyền từ ngoài thì có thể có một symlink đã commit — trỏ ra ngoài
      // repo, tới FIFO hay `/dev/zero` (lần soi thứ ba của CP-82).
      const stats = lstatSync(path.join(root, relPath));
      if (!stats.isFile()) continue;
      if (stats.size > 5_000_000) continue; // a 5MB source file is not hand-written
      content = readFileSync(path.join(root, relPath), 'utf8');
    } catch {
      continue;
    }

    scannedFiles.add(relPath);

    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (line.length > MAX_LINE_LENGTH) return;
      for (const { rule, regex } of applicable) {
        if (regex.test(line)) {
          violations.push({
            rule: rule.id,
            severity: rule.severity,
            message: rule.message,
            file: fromRoot,
            line: index + 1,
            text: line.trim().slice(0, 120),
          });
        }
      }
    });
  }

  return {
    violations,
    errorCount: violations.filter((v) => v.severity === 'error').length,
    warnCount: violations.filter((v) => v.severity === 'warn').length,
    scanned: scannedFiles.size,
    skippedRules,
  };
}
