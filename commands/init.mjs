import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, compassDir, taskDir, specPath, configPath, validateTaskId } from '../lib/paths.mjs';
import { TASK_TYPES, rulesFor } from '../lib/task-types.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';
import { hint } from '../lib/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(here, '..', 'templates', 'spec.md');

export function initCommand({ cwd, taskId, type }) {
  if (!taskId) {
    return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass init <id> --type=<loại>' };
  }

  const validation = validateTaskId(taskId);
  if (!validation.ok) {
    return { exitCode: 2, output: validation.reason };
  }

  if (!type) {
    return {
      exitCode: 2,
      output: `Thiếu --type. Phải là một trong: ${TASK_TYPES.join(', ')}`,
    };
  }
  const rules = rulesFor(type);
  if (!rules) {
    return {
      exitCode: 2,
      output: `Loại task không hợp lệ: "${type}". Phải là một trong: ${TASK_TYPES.join(', ')}`,
    };
  }

  const found = findRoot(cwd);
  const root = found ?? cwd;
  const isNewProject = !found;

  mkdirSync(compassDir(root), { recursive: true });
  if (!existsSync(configPath(root))) {
    writeFileSync(configPath(root), JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

  const spec = specPath(root, taskId);
  if (existsSync(spec)) {
    return { exitCode: 2, output: `Spec đã tồn tại: ${spec}` };
  }

  mkdirSync(taskDir(root, taskId), { recursive: true });
  const filled = readFileSync(TEMPLATE, 'utf8')
    .replaceAll('{{taskId}}', taskId)
    .replaceAll('{{type}}', type)
    .replaceAll('{{minTests}}', String(rules.minTests))
    .replaceAll('{{layers}}', rules.requiredLayers.join(', '));
  writeFileSync(spec, filled);

  const lines = [];
  if (isNewProject) {
    lines.push(`Khởi tạo dự án Compass mới tại: ${root}`);
  }
  lines.push(
    `Đã tạo task ${taskId} (loại ${type})`,
    `  spec: ${spec}`,
    '',
    hint('Điền spec, rồi chạy: compass spec ' + taskId)
  );

  return {
    exitCode: 0,
    output: lines.join('\n'),
  };
}
