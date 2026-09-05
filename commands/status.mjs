import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { readGates, verifyAllGates } from '../lib/gate-store.mjs';

const IMPLEMENTED_GATES = ['spec', 'test'];

export function statusCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass status <id>' };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const rules = rulesFor(spec.type);

  let gates;
  try {
    gates = readGates(root, taskId);
  } catch (err) {
    if (err.code === 'COMPASS_GATE_CORRUPT') {
      return {
        exitCode: 2,
        output: `Không thể đọc ledger gate tại ${file.replace(/spec\.md$/, 'evidence/gate.json')}.\nBản ghi có thể bị hỏng. Không thể tin tưởng kết quả gate.`,
      };
    }
    return {
      exitCode: 2,
      output: `Không thể đọc ledger gate tại ${file.replace(/spec\.md$/, 'evidence/gate.json')}.\nLỗi: ${err.message}`,
    };
  }

  const integrity = verifyAllGates(root, taskId);

  const lines = [
    `Task ${taskId} — ${spec.title}`,
    `Loại: ${spec.type}   Test cases trong spec: ${spec.testCases.length}`,
    '',
  ];

  for (const name of rules?.gates ?? []) {
    const record = gates[name];
    let state;
    if (!IMPLEMENTED_GATES.includes(name)) state = '– chưa cài ở giai đoạn này';
    else if (!record) state = '· chưa chạy';
    else if (record.exitCode === 0) state = '✓ pass';
    else state = '✗ fail';
    lines.push(`  ${name.padEnd(12)} ${state}`);
  }

  if (!integrity.ok) {
    lines.push('', `⚠ Chữ ký không khớp: ${integrity.tampered.join(', ')}`);
  }

  return { exitCode: 0, output: lines.join('\n') };
}
