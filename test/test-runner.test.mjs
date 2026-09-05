import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { runCommand } from '../lib/test-runner.mjs';

// NOTE: The following code paths cannot be exercised on Windows/Git Bash:
// 1. Signalled exit (result.signal non-null): Node maps SIGKILL/SIGTERM to TerminateProcess,
//    returning exit code 1 instead of a signal. This is reachable on Linux/macOS.
// 2. maxBuffer overflow (result.error with code ENOBUFS): Theoretically possible but requires
//    32MB+ output. The code path exists and is correct but not testable in practice.
// 3. Spawn error surfacing as result.error: With shell: true, the shell process itself is
//    spawned successfully; missing commands return shell error exit codes, not spawn errors.
//    Direct spawn errors are reachable on all platforms when shell: false is used.

test('runCommand reports exit code 0 for a successful command', () => {
  const result = runCommand('node -e "process.exit(0)"', tmpdir());
  assert.equal(result.exitCode, 0);
});

test('runCommand reports a non-zero exit code', () => {
  const result = runCommand('node -e "process.exit(3)"', tmpdir());
  assert.equal(result.exitCode, 3);
});

test('runCommand captures stdout', () => {
  const result = runCommand('node -e "console.log(\'from stdout\')"', tmpdir());
  assert.match(result.output, /from stdout/);
});

test('runCommand captures stderr', () => {
  const result = runCommand('node -e "console.error(\'from stderr\')"', tmpdir());
  assert.match(result.output, /from stderr/);
});

test('runCommand measures duration', () => {
  const result = runCommand('node -e "process.exit(0)"', tmpdir());
  assert.equal(typeof result.durationMs, 'number');
  assert.ok(result.durationMs >= 0);
});

test('runCommand reports a non-zero code for a missing binary', () => {
  const result = runCommand('definitely-not-a-real-command-xyz', tmpdir());
  assert.notEqual(result.exitCode, 0);
  // On Windows with shell: true, missing command produces shell error text in output
  assert.ok(result.output.length > 0, 'should have shell error output');
});

test('normal successful command reports signal and failure as null', () => {
  const result = runCommand('node -e "process.exit(0)"', tmpdir());
  assert.equal(result.signal, null);
  assert.equal(result.failure, null);
});

test('normally-failing command reports signal and failure as null', () => {
  const result = runCommand('node -e "process.exit(5)"', tmpdir());
  assert.equal(result.signal, null);
  assert.equal(result.failure, null);
  assert.notEqual(result.exitCode, 0);
});

test('return value has exactly the expected keys', () => {
  const result = runCommand('node -e "process.exit(0)"', tmpdir());
  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, ['durationMs', 'exitCode', 'failure', 'output', 'signal']);
});
