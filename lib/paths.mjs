import { existsSync } from 'node:fs';
import path from 'node:path';

const COMPASS = '.compass';

export function findRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, COMPASS, 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const compassDir  = (root) => path.join(root, COMPASS);
export const taskDir     = (root, taskId) => path.join(root, COMPASS, taskId);
export const evidenceDir = (root, taskId) => path.join(root, COMPASS, taskId, 'evidence');
export const specPath    = (root, taskId) => path.join(root, COMPASS, taskId, 'spec.md');
export const gatePath    = (root, taskId) => path.join(root, COMPASS, taskId, 'evidence', 'gate.json');
export const configPath  = (root) => path.join(root, COMPASS, 'config.json');
export const saltPath    = (root) => path.join(root, COMPASS, '.salt');

const RESERVED_NAMES = new Set(
  ['CON', 'PRN', 'AUX', 'NUL',
   'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
   'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9']
    .map(n => n.toLowerCase())
);

const ILLEGAL_CHARS = /[\x00-\x1f<>:"|?*]/;

export function validateTaskId(taskId) {
  if (!taskId || /^\s*$/.test(taskId)) {
    return { ok: false, reason: 'Task id không được để trống.' };
  }

  if (taskId.length > 64) {
    return { ok: false, reason: 'Task id không được dài quá 64 ký tự.' };
  }

  if (taskId.includes('..')) {
    return { ok: false, reason: 'Task id không được chứa .. (nguy hiểm).' };
  }

  if (taskId.includes('/') || taskId.includes('\\')) {
    return { ok: false, reason: 'Task id không được chứa / hoặc \\.' };
  }

  if (ILLEGAL_CHARS.test(taskId)) {
    return { ok: false, reason: 'Task id chứa ký tự không hợp lệ: < > : " | ? * hoặc điều khiển.' };
  }

  if (taskId.startsWith('.') || taskId.endsWith('.')) {
    return { ok: false, reason: 'Task id không được bắt đầu hoặc kết thúc bằng dấu chấm.' };
  }

  if (taskId.startsWith(' ') || taskId.endsWith(' ')) {
    return { ok: false, reason: 'Task id không được bắt đầu hoặc kết thúc bằng khoảng trắng.' };
  }

  // Task tên `pr` đọc như lệnh `compass pr` (CP-81): `compass check pr` hay
  // `compass pr` dễ gõ nhầm sang nhau.
  if (taskId.toLowerCase() === 'pr') {
    return { ok: false, reason: 'Task id "pr" trùng tên lệnh compass pr. Chọn tên khác.' };
  }

  const namePart = taskId.split('.')[0].toLowerCase();
  if (RESERVED_NAMES.has(namePart)) {
    return { ok: false, reason: `Task id không được là tên dự trữ Windows: ${namePart}` };
  }

  return { ok: true };
}
