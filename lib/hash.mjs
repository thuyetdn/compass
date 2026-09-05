import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export function sha256(text) {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashFile(filePath) {
  if (!existsSync(filePath)) return 'sha256:missing';
  return sha256(readFileSync(filePath, 'utf8'));
}

export function hashFiles(filePaths) {
  const parts = [...filePaths].sort().map((p) => `${p}:${hashFile(p)}`);
  return sha256(parts.join('\n'));
}
