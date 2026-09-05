import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Directories that are not the project's source: dependencies, build output,
// and Compass's own state. `.compass` matters most — every gate writes a record
// there on every run, so counting it would make each gate invalidate its own
// evidence the moment it recorded it.
export const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.compass',
]);

// A file this large is generated or binary, not something a person edits. Its
// size stands in for its content so a big asset does not slow every gate down.
const MAX_READ_BYTES = 5_000_000;

function walk(root, current, out) {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return; // an unreadable directory contributes nothing rather than crashing
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(root, path.join(current, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, path.join(current, entry.name)));
    }
  }
}

// Identifies the source tree a gate ran against, so `done` can tell whether the
// code still matches the evidence. Paths are part of the hash: renaming a file
// changes what the code is, even when every byte survives.
export function hashSource(root) {
  const files = [];
  walk(root, root, files);
  files.sort();

  const digest = createHash('sha256');

  for (const relPath of files) {
    const full = path.join(root, relPath);
    digest.update(relPath.split(path.sep).join('/'));
    digest.update('\0');

    try {
      const stats = statSync(full);
      if (stats.size > MAX_READ_BYTES) {
        digest.update(`size:${stats.size}`);
      } else {
        digest.update(readFileSync(full));
      }
    } catch {
      // A file that cannot be read now is a file that changed, as far as any
      // evidence recorded earlier is concerned.
      digest.update('unreadable');
    }
    digest.update('\0');
  }

  return 'sha256:' + digest.digest('hex');
}
