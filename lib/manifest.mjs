import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from './hash.mjs';

// Derived docs go wrong quietly: the code moves on and the file keeps saying
// what used to be true. The manifest records what each source looked like when
// the docs were written, so the gate can tell the difference between docs that
// still describe the code and docs that only look like they do.

export function buildManifest(root, files) {
  const sources = {};
  for (const relPath of [...files].sort()) {
    try {
      sources[relPath] = sha256(readFileSync(path.join(root, relPath), 'utf8'));
    } catch {
      sources[relPath] = 'sha256:unreadable';
    }
  }
  return { generatedAt: new Date().toISOString(), sources };
}

export function compareManifest(root, manifest, currentFiles) {
  if (!manifest) {
    return { stale: true, reason: 'chưa sinh derived lần nào', changed: [], missing: [], added: [] };
  }
  if (typeof manifest.sources !== 'object' || manifest.sources === null) {
    return { stale: true, reason: 'manifest hỏng — không đọc được danh sách file', changed: [], missing: [], added: [] };
  }

  const recorded = new Set(Object.keys(manifest.sources));
  const present = new Set(currentFiles);

  const changed = [];
  const missing = [];

  for (const relPath of [...recorded].sort()) {
    if (!present.has(relPath)) {
      missing.push(relPath);
      continue;
    }
    let hash;
    try {
      hash = sha256(readFileSync(path.join(root, relPath), 'utf8'));
    } catch {
      // A file that cannot be read now is not the file the docs were built from.
      changed.push(relPath);
      continue;
    }
    if (hash !== manifest.sources[relPath]) changed.push(relPath);
  }

  const added = [...present].filter((f) => !recorded.has(f)).sort();

  return {
    stale: changed.length > 0 || missing.length > 0 || added.length > 0,
    reason: null,
    changed,
    missing,
    added,
  };
}
