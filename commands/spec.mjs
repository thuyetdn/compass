import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath, validateTaskId } from '../lib/paths.mjs';
import { validateSpec } from '../lib/spec-validator.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

// `reviewHint` mặc định bật: lời nhắc đưa spec đi duyệt thuộc về lúc chạy
// `compass spec` một mình. `check` tắt nó — lúc đó spec đã duyệt, code đã viết.
// Người gọi quyết, không ai lọc câu này khỏi output sau khi nhận về.
export function specCommand({ cwd, taskId, reviewHint = true }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass spec <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) {
    return { exitCode: 2, output: validation.reason };
  }

  const root = findRoot(cwd);
  if (!root) {
    return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.\nChạy: compass init <id> --type=<loại>' };
  }

  const file = specPath(root, taskId);
  if (!existsSync(file)) {
    return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };
  }

  const markdown = readFileSync(file, 'utf8');
  const result = validateSpec(markdown);

  writeGate(root, taskId, {
    gate: 'spec',
    exitCode: result.ok ? 0 : 1,
    checkedAt: new Date().toISOString(),
    specHash: hashFile(file),
    errorCount: result.errors.length,
  });

  if (!result.ok) {
    return {
      exitCode: 1,
      output: [fail('spec', result.errors), '', hint('Sửa spec rồi chạy lại: compass spec ' + taskId)].join('\n'),
    };
  }

  if (!reviewHint) return { exitCode: 0, output: pass('spec') };

  return {
    exitCode: 0,
    output: [
      pass('spec'),
      '',
      hint('Đưa spec cho người duyệt. Duyệt xong mới bắt đầu code.'),
    ].join('\n'),
  };
}
