// Sổ cái vòng soi (CP-106): `.compass/<id>/evidence/review-ledger.json`. Mỗi vòng đã
// chấm một mục — ảnh chụp code, mọi finding với quyết định của nó, các closure — để vòng
// sau chỉ soi bản sửa, và để đếm được một chuỗi lỗi đã bị sửa bao nhiêu lần.
//
// Ký bằng salt của máy như `gate.json`, kèm task id. Sổ sai chữ ký (sửa tay, chép từ task
// khác, hay commit từ máy khác) thì bị bỏ và soi lại từ vòng 1: không tin được lịch sử thì
// không có bản sửa nào để soi riêng. Bỏ sổ không bao giờ làm việc soi rẻ đi, vì vòng 1 là
// vòng soi toàn bộ.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evidenceDir } from './paths.mjs';
import { getSalt, signRecord, verifyRecord } from './signature.mjs';
import { sha256 } from './hash.mjs';
import { specRequirementText } from './spec-parser.mjs';

export const LEDGER_FILE = 'review-ledger.json';

export const ledgerPath = (root, taskId) => path.join(evidenceDir(root, taskId), LEDGER_FILE);

// Băm phần yêu cầu của spec. Đổi nó là đổi việc task phải làm: sổ làm lại từ vòng 1.
export const specKeyOf = (specText) => sha256(specRequirementText(specText));

// `{ rounds, note }`. `rounds` rỗng khi chưa có sổ hay sổ bị bỏ; `note` nói vì sao bỏ.
export function readLedger(root, taskId, specKey) {
  const file = ledgerPath(root, taskId);
  if (!existsSync(file)) return { rounds: [], note: null };
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { rounds: [], note: 'Sổ cái vòng soi không phải JSON hợp lệ — bỏ, soi lại từ vòng 1.' };
  }
  if (!verifyRecord(ledger, getSalt(root)) || !Array.isArray(ledger.rounds)) {
    return {
      rounds: [],
      note: 'Sổ cái vòng soi không khớp chữ ký (sửa tay, hay ghi trên máy khác) — bỏ, soi lại từ vòng 1.',
    };
  }
  if (ledger.taskId !== taskId) {
    return { rounds: [], note: `Sổ cái vòng soi là của task ${ledger.taskId}, không phải ${taskId} — bỏ, soi lại từ vòng 1.` };
  }
  if (ledger.specKey !== specKey) {
    const last = ledger.rounds.at(-1)?.round ?? 0;
    return {
      rounds: [],
      note: `Spec đã đổi phần yêu cầu sau vòng ${last} — sổ cái làm lại từ vòng 1. Yêu cầu mới nên là task riêng, có vòng 1 riêng.`,
    };
  }
  return { rounds: ledger.rounds, note: null };
}

export function writeLedger(root, taskId, specKey, rounds) {
  mkdirSync(evidenceDir(root, taskId), { recursive: true });
  const body = { version: 1, taskId, specKey, rounds };
  const signed = { ...body, sig: signRecord(body, getSalt(root)) };
  writeFileSync(ledgerPath(root, taskId), JSON.stringify(signed, null, 2));
  return signed;
}
