import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from './hash.mjs';
import { saltPath } from './paths.mjs';

export function getSalt(root) {
  const file = saltPath(root);
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const salt = randomBytes(32).toString('hex');
  writeFileSync(file, salt);
  return salt;
}

function canonical(record) {
  const { sig, ...rest } = record;
  const keys = Object.keys(rest).sort();
  return JSON.stringify(rest, keys);
}

export function signRecord(record, salt) {
  return sha256(canonical(record) + '|' + salt);
}

export function verifyRecord(record, salt) {
  if (!record || typeof record.sig !== 'string') return false;
  return signRecord(record, salt) === record.sig;
}
