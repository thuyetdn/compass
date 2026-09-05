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
  const output = stderr ? `${stdout}\n${stderr}` : stdout;

  let exitCode = result.status;
  if (exitCode === null || exitCode === undefined) exitCode = 1;

  return { exitCode, output, durationMs };
}
