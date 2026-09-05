import { existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { findRoot, compassDir } from '../lib/paths.mjs';
import { hint } from '../lib/report.mjs';

const SCRIPTS = 'scripts';

// Enough to reach a header comment without pulling a whole data file into
// memory: listing a library should not cost what reading it does.
const HEADER_BYTES = 2048;

function readHead(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buffer = Buffer.alloc(HEADER_BYTES);
    const bytes = readSync(fd, buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytes).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
  }
}

// A purpose line is whatever the author wrote first in a comment. Anything
// else and the entry says so rather than inventing a description.
function purposeOf(head) {
  for (const raw of head.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#!')) continue;
    // A bare block-comment opener carries no text; the description is on the
    // next line. Returning "*" here would look like a purpose nobody wrote.
    if (line === '/*' || line === '/**' || line === '*' || line === '*/') continue;

    const comment = line.match(/^(?:\/\/|#|--|\*|\/\*\*?)\s*(.+?)\s*(?:\*\/)?$/);
    if (comment && comment[1]) return comment[1];
    // First non-comment line means the file opened with code.
    return null;
  }
  return null;
}

function walk(root, current, out) {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else if (entry.isFile() && entry.name !== 'README.md') {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
}

export function scriptsCommand({ cwd }) {
  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const dir = path.join(compassDir(root), SCRIPTS);

  if (!existsSync(dir)) {
    return {
      exitCode: 0,
      output: [
        'Chưa có script nào trong .compass/scripts/',
        '',
        hint('Script viết trong lúc điều tra thì lưu vào đó, kèm một dòng comment nói nó làm gì.'),
        hint('Thư mục này git-tracked — lần sau tìm thấy mà dùng lại, khỏi viết mới.'),
      ].join('\n'),
    };
  }

  const files = [];
  walk(dir, dir, files);
  files.sort();

  if (files.length === 0) {
    return { exitCode: 0, output: 'Thư mục .compass/scripts/ đang trống.' };
  }

  // Listing describes; it never runs anything. A library of investigation
  // scripts is the last place to execute code as a side effect of looking.
  const lines = [`${files.length} script trong .compass/scripts/:`, ''];
  for (const relPath of files) {
    const purpose = purposeOf(readHead(path.join(dir, relPath)));
    lines.push(`  ${relPath}`);
    lines.push(`      ${purpose ?? '(chưa có dòng comment mô tả)'}`);
  }

  return { exitCode: 0, output: lines.join('\n') };
}
