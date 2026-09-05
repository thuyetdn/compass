import { spawnSync } from 'node:child_process';

export function runCommand(command, cwd) {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  let output = stderr ? `${stdout}\n${stderr}` : stdout;

  let exitCode = result.status;
  let signal = result.signal ?? null;
  let failure = null;

  // Handle process killed by signal
  if (signal) {
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
