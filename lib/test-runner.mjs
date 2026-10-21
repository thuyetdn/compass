import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killTreeSync } from './process-tree.mjs';

// Dòng cuối stderr của commands/run-with-timeout.mjs khi nó phải dừng lệnh.
export const TIMEOUT_MARK = '__COMPASS_TIMEOUT__';
const SUPERVISOR = fileURLToPath(new URL('../commands/run-with-timeout.mjs', import.meta.url));

// `timeoutMs`: dừng lệnh khi chạy quá lâu. `compass pr --run-tests` chạy test của
// người khác, và một test treo không được treo luôn cả lệnh (CP-81). Lệnh khi đó
// chạy qua commands/run-with-timeout.mjs, vì `spawnSync` với `timeout` chỉ giết được
// shell: tiến trình test thật bên dưới chạy tiếp code của PR (lần soi thứ bảy).
export function runCommand(command, cwd, { timeoutMs } = {}) {
  const startedAt = Date.now();
  // Dấu hết giờ mang một chuỗi ngẫu nhiên của lần chạy này: chỉ chữ cố định thì một
  // test tự in nó ra stderr là được báo hết giờ và fail (lần soi thứ mười bảy).
  const nonce = timeoutMs ? randomBytes(8).toString('hex') : '';
  const mark = `${TIMEOUT_MARK}-${nonce}`;
  // Tiến trình giám sát ghi pid của lệnh vào đây, để còn dọn được cây khi chính nó bị giết.
  // Thư mục riêng do `mkdtemp` tạo, không phải một tên đoán trước trong tmp: tiến
  // trình khác đặt sẵn file đó thì được chọn pid mà ta sẽ giết (lần soi thứ hai mươi).
  const pidDir = timeoutMs ? mkdtempSync(path.join(tmpdir(), 'compass-run-')) : null;
  const pidFile = pidDir ? path.join(pidDir, 'child.pid') : null;
  const result = timeoutMs
    ? spawnSync(process.execPath, [SUPERVISOR, String(timeoutMs), command, pidFile, nonce], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      // Lưới cuối, nếu chính tiến trình giám sát kẹt.
      timeout: timeoutMs + 30_000,
    })
    : spawnSync(command, {
      cwd,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  const durationMs = Date.now() - startedAt;

  const stdout = result.stdout ?? '';
  let stderr = result.stderr ?? '';
  const timedOut = Boolean(timeoutMs) && (stderr.includes(mark) || result.error?.code === 'ETIMEDOUT');
  if (pidFile) {
    let childPid = null;
    try { childPid = Number(readFileSync(pidFile, 'utf8')); } catch { /* chưa kịp ghi */ }
    if (result.error || result.signal) killTreeSync(childPid);
    try { rmSync(pidDir, { recursive: true, force: true }); } catch { /* thư mục tạm */ }
  }
  if (timeoutMs) stderr = stderr.replace(`\n${mark}\n`, '').replace(mark, '');
  let output = stderr ? `${stdout}\n${stderr}` : stdout;

  let exitCode = result.status;
  let signal = result.signal ?? null;
  let failure = null;

  if (timedOut) {
    exitCode = 1;
    failure = `Hết giờ: lệnh chạy quá ${Math.round(timeoutMs / 1000)} giây nên bị dừng`;
    output = output ? `${output}\n${failure}` : failure;
  }
  // Handle process killed by signal
  else if (signal) {
    exitCode = 1;
    failure = `Quá trình bị dừng bởi tín hiệu: ${signal}`;
    output = output ? `${output}\n${failure}` : failure;
  }
  // Handle maxBuffer overflow
  else if (result.error && result.error.code === 'ENOBUFS') {
    exitCode = 1;
    failure = 'Output vượt quá giới hạn buffer (32MB)';
    output = output ? `${output}\n${failure}` : failure;
  }
  // Handle spawn error (e.g., command not found)
  else if (result.error) {
    exitCode = 1;
    failure = `Lỗi khi chạy lệnh: ${result.error.message}`;
    output = output ? `${output}\n${failure}` : failure;
  }
  // Normal completion (even with non-zero exit code from the command itself)
  else if (exitCode === null || exitCode === undefined) {
    exitCode = 1;
    failure = 'Không có mã thoát';
    output = output ? `${output}\n${failure}` : failure;
  }

  return { exitCode, output, durationMs, signal, failure };
}
