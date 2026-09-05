import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, '..', 'cli.mjs');

test('CLI exits with code 2 on exception, not 0', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-cli-'));
  const cmd = `node "${cliPath}" init "x:y*z" --type=fix`;
  try {
    execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8', shell: true });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.status, 2, `exit code should be 2, got ${err.status}`);
  }
});
