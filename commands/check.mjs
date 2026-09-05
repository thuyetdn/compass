import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { specCommand } from './spec.mjs';
import { testCommand } from './test.mjs';
import { info } from '../lib/report.mjs';

const IMPLEMENTED = {
  spec: specCommand,
  test: testCommand,
};

const ORDER = ['spec', 'convention', 'test', 'ui', 'visual', 'review'];

export function checkCommand({ cwd, taskId, only }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass check <id>' };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const rules = rulesFor(spec.type);
  if (!rules) {
    return { exitCode: 2, output: `Loại task không hợp lệ trong spec: "${spec.type}"` };
  }

  let gates = ORDER.filter((g) => rules.gates.includes(g));
  if (only) gates = gates.filter((g) => g === only);

  const lines = [];
  const skipped = [];

  for (const gate of gates) {
    const run = IMPLEMENTED[gate];
    if (!run) { skipped.push(gate); continue; }

    const result = run({ cwd: root, taskId });
    lines.push(result.output);
    if (result.exitCode !== 0) {
      return { exitCode: result.exitCode, output: lines.join('\n') };
    }
  }

  if (skipped.length) {
    lines.push('', info(`Bỏ qua (chưa cài ở giai đoạn này): ${skipped.join(', ')}`));
  }

  return { exitCode: 0, output: lines.join('\n') };
}
