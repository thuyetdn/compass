import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gatePath, evidenceDir } from './paths.mjs';
import { getSalt, signRecord, verifyRecord } from './signature.mjs';

// Tên khe trong sổ gate. Một repo thì vẫn là `test` như cũ — dự án cũ đọc lại
// được. Nhiều repo thì `test@backend`, vì hai repo chạy cùng một gate mà ghi
// chung một khe thì repo sau đè lên repo trước, và `done` chỉ thấy repo cuối:
// bằng chứng của repo kia biến mất mà không ai biết.
export function slotFor(gate, repo = null) {
  return repo === null || repo === undefined ? gate : `${gate}@${repo}`;
}

// Tách khe ngược lại thành { gate, repo }.
export function parseSlot(slot) {
  const at = slot.indexOf("@");
  return at === -1
    ? { gate: slot, repo: null }
    : { gate: slot.slice(0, at), repo: slot.slice(at + 1) };
}

export function readGates(root, taskId) {
  const file = gatePath(root, taskId);
  if (!existsSync(file)) return {};

  // Separate read from parse: only parse failures mean corruption
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch (err) {
    // Read error (EISDIR, EACCES, etc.) - propagate as-is
    throw err;
  }

  try {
    return JSON.parse(content);
  } catch (err) {
    // Parse failure means corruption
    const error = new Error(`gate.json hỏng tại ${file}`, { cause: err });
    error.code = 'COMPASS_GATE_CORRUPT';
    throw error;
  }
}

export function readGate(root, taskId, gateName, repo = null) {
  return readGates(root, taskId)[slotFor(gateName, repo)] ?? null;
}

export function writeGate(root, taskId, record, repo = null) {
  const dir = evidenceDir(root, taskId);
  mkdirSync(dir, { recursive: true });

  const salt = getSalt(root);
  // Ký kèm tên repo: bản ghi của repo A đem sang khe repo B thì chữ ký lệch.
  const withTaskId = repo === null ? { ...record, taskId } : { ...record, taskId, repo };
  const signed = { ...withTaskId, sig: signRecord(withTaskId, salt) };

  const gates = readGates(root, taskId);
  gates[slotFor(record.gate, repo)] = signed;
  writeFileSync(gatePath(root, taskId), JSON.stringify(gates, null, 2));

  return signed;
}

// A record is only trustworthy for this (key, taskId) slot when:
//  - its signature verifies (contents weren't hand-edited)
//  - its own "gate" field matches the key it's stored under (wasn't moved between slots)
//  - its own "taskId" field matches the task being checked (wasn't copied between tasks)
// A record with no taskId at all predates this check — it can't prove anything either way.
export function verifyAllGates(root, taskId) {
  const salt = getSalt(root);
  try {
    const gates = readGates(root, taskId);
    const tampered = [];
    const misslotted = [];
    const wrongTask = [];
    const outdated = [];

    for (const [name, record] of Object.entries(gates)) {
      if (!verifyRecord(record, salt)) {
        tampered.push(name);
        continue;
      }
      // Khe mang tên repo thì so cả hai phần. Chỉ so `record.gate` với cả chuỗi
      // `test@backend` thì mọi bản ghi đa repo đều bị coi là bị chuyển khe.
      const { gate, repo } = parseSlot(name);
      if (record.gate !== gate || (record.repo ?? null) !== repo) {
        misslotted.push(name);
        continue;
      }
      if (record.taskId === undefined) {
        outdated.push(name);
        continue;
      }
      if (record.taskId !== taskId) {
        wrongTask.push(name);
      }
    }

    return {
      ok: tampered.length === 0 && misslotted.length === 0 && wrongTask.length === 0 && outdated.length === 0,
      tampered,
      misslotted,
      wrongTask,
      outdated,
    };
  } catch (err) {
    return { ok: false, tampered: ['<gate.json hỏng>'], misslotted: [], wrongTask: [], outdated: [] };
  }
}
