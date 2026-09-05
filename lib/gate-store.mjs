import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gatePath, evidenceDir } from './paths.mjs';
import { getSalt, signRecord, verifyRecord } from './signature.mjs';

export function readGates(root, taskId) {
  const file = gatePath(root, taskId);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function readGate(root, taskId, gateName) {
  return readGates(root, taskId)[gateName] ?? null;
}

export function writeGate(root, taskId, record) {
  const dir = evidenceDir(root, taskId);
  mkdirSync(dir, { recursive: true });

  const salt = getSalt(root);
  const signed = { ...record, sig: signRecord(record, salt) };

  const gates = readGates(root, taskId);
  gates[record.gate] = signed;
  writeFileSync(gatePath(root, taskId), JSON.stringify(gates, null, 2));

  return signed;
}

export function verifyAllGates(root, taskId) {
  const salt = getSalt(root);
  const gates = readGates(root, taskId);
  const tampered = Object.entries(gates)
    .filter(([, record]) => !verifyRecord(record, salt))
    .map(([name]) => name);
  return { ok: tampered.length === 0, tampered };
}
