import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { runCommand } from '../lib/test-runner.mjs';

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
});
