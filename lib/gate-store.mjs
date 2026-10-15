import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gatePath, evidenceDir, specPath } from './paths.mjs';
import { getSalt, signRecord, verifyRecord } from './signature.mjs';
import { hashFile } from './hash.mjs';
import { hashSource } from './source-hash.mjs';
import { PER_REPO_GATES, LY_DO_KHONG_DEVURL } from './gates.mjs';

// Tên khe trong sổ gate. Một repo thì vẫn là `test` như cũ — dự án cũ đọc lại
// được. Nhiều repo thì `test@backend`, vì hai repo chạy cùng một gate mà ghi
// chung một khe thì repo sau đè lên repo trước, và `done` chỉ thấy repo cuối:
// bằng chứng của repo kia biến mất mà không ai biết.
export function slotFor(gate, repo = null) {
  return repo === null || repo === undefined ? gate : `${gate}@${repo}`;
}

// Evidence của một repo nằm dưới `evidence/repos/<repo>/`. Tầng `repos/` giữ tên
// repo khỏi đụng `gate.json`, `test.log` hay `findings.json`; tên `sorm/frontend`
// lồng thư mục. Tên repo phải qua `repoPathError` trước khi tới đây. Một repo thì
// vẫn là `evidence/` như cũ.
export function repoEvidenceDir(root, taskId, repo = null) {
  return repo === null
    ? evidenceDir(root, taskId)
    : path.join(evidenceDir(root, taskId), 'repos', ...repo.split('/'));
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
  // Bản ghi theo repo của một gate đo từng repo thay hẳn khe trần cùng gate. Khe
  // trần đó không nói được đã đo repo nào, nên `done` không tính nó — để lại thì
  // chạy lại `check` xong vẫn kẹt, và người ta phải sửa tay `gate.json`.
  if (repo !== null && PER_REPO_GATES.includes(record.gate)) delete gates[record.gate];
  writeFileSync(gatePath(root, taskId), JSON.stringify(gates, null, 2));

  return signed;
}

// Bản ghi "gate cần trình duyệt nhưng repo không có trang nào để mở". Một hàm cho
// cả `check` lẫn gate gọi thẳng từ CLI, để hai đường vào ghi cùng một bản ghi —
// `done` chỉ chấp nhận đúng hình dạng này.
export function writeSkip(root, taskId, gate, repo = null) {
  return writeGate(root, taskId, {
    gate,
    // Không phải 0: đọc sổ phải phân biệt được "chưa chạy" với "đã đo và
    // đúng". Một bản ghi `exitCode: 0` không có phép đo nào đằng sau là
    // bằng chứng giả.
    exitCode: null,
    skipped: true,
    skipReason: LY_DO_KHONG_DEVURL,
    checkedAt: new Date().toISOString(),
    specHash: hashFile(specPath(root, taskId)),
    // `ui`/`visual` là gate đọc code, nên `done` soi `sourceHash` cả trên
    // bản ghi skip. Thiếu trường thì nó bị coi là bản ghi phiên bản cũ.
    sourceHash: hashSource(root),
  }, repo);
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
