import { existsSync, readFileSync } from 'node:fs';
import { configPath } from './paths.mjs';

export const DEFAULT_CONFIG = {
  test: 'npm test',
  testReporter: 'tap',
};

const REPORTERS = ['tap', 'plain'];

export function loadConfig(root) {
  const file = configPath(root);
  if (!existsSync(file)) {
    return { ok: false, errors: [`Không tìm thấy config: ${file}`] };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`config.json không phải JSON hợp lệ: ${err.message}`] };
  }

  const errors = [];
  if (typeof raw.test !== 'string' || raw.test.trim() === '') {
    errors.push('config.json thiếu trường "test" (lệnh chạy test)');
  }
  const reporter = raw.testReporter ?? 'tap';
  if (!REPORTERS.includes(reporter)) {
    errors.push(`testReporter phải là một trong: ${REPORTERS.join(', ')}`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, config: { ...raw, testReporter: reporter } };
}
