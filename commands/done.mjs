import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath, configPath } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { readGates, verifyAllGates } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { IMPLEMENTED_GATES } from '../lib/gates.mjs';



export function doneCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass done <id>' };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const rules = rulesFor(spec.type);
  if (!rules) return { exitCode: 2, output: `Loại task không hợp lệ trong spec: "${spec.type}"` };

  const problems = [];

  const integrity = verifyAllGates(root, taskId);
  if (!integrity.ok) {
    if (integrity.tampered.length) {
      problems.push(`chữ ký không khớp ở gate: ${integrity.tampered.join(', ')} — bản ghi đã bị sửa tay.`);
    }
    if (integrity.misslotted?.length) {
      problems.push(`bản ghi ở gate "${integrity.misslotted.join(', ')}" không thuộc slot này — bị chuyển từ gate khác. Coi như gian lận.`);
    }
    if (integrity.wrongTask?.length) {
      problems.push(`bản ghi ở gate "${integrity.wrongTask.join(', ')}" thuộc task khác — bị copy sang task này. Coi như gian lận.`);
    }
    if (integrity.outdated?.length) {
      problems.push(`bản ghi ở gate "${integrity.outdated.join(', ')}" được ghi từ bản Compass cũ, chưa có taskId — không chứng minh được gì ở bản này. Chạy lại: compass check ${taskId}`);
    }
  }

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

  const required = rules.gates.filter((g) => IMPLEMENTED_GATES.includes(g));
  const unimplemented = rules.gates.filter((g) => !IMPLEMENTED_GATES.includes(g));

  for (const name of required) {
    const record = gates[name];
    if (!record) {
      problems.push(`Gate "${name}" chưa chạy.`);
      continue;
    }
    if (record.exitCode !== 0) {
      problems.push(`Gate "${name}" chưa pass (exit code ${record.exitCode}).`);
    }
  }

  const currentSpecHash = hashFile(file);
  for (const name of required) {
    const record = gates[name];
    if (record && record.specHash && record.specHash !== currentSpecHash) {
      problems.push(`Spec đã thay đổi sau khi gate "${name}" chạy — phải chạy lại và duyệt lại.`);
    }
  }

  // Gate nào chạy lệnh từ config thì BẮT BUỘC phải ghi configHash. Thiếu là bản
  // ghi cũ, không phải được miễn — dùng `record.configHash &&` sẽ âm thầm miễn
  // trừ mọi gate tương lai nào quên ghi.
  const CONFIG_DEPENDENT_GATES = ['test'];
  const currentConfigHash = hashFile(configPath(root));
  for (const name of required) {
    const record = gates[name];
    if (!record || !CONFIG_DEPENDENT_GATES.includes(name)) continue;
    if (!record.configHash) {
      problems.push(`Gate "${name}" không ghi lại lệnh test đã dùng — bản ghi từ phiên bản cũ. Chạy lại: compass check ${taskId}`);
    } else if (record.configHash !== currentConfigHash) {
      problems.push(`Lệnh test đã đổi kể từ khi gate "${name}" chạy — bằng chứng không còn mô tả đúng lệnh sẽ chạy bây giờ. Chạy lại: compass check ${taskId}`);
    }
  }

  if (problems.length) {
    const lines = [fail('done', problems), '', hint('Chạy: compass check ' + taskId)];
    if (unimplemented.length) {
      lines.push('');
      lines.push(`Ghi chú: Gate ${unimplemented.join(', ')} chưa xây dựng ở giai đoạn này.`);
    }
    return {
      exitCode: 1,
      output: lines.join('\n'),
    };
  }

  const lines = [pass('done', `${required.length} gate đã pass`)];
  if (unimplemented.length) {
    lines.push(`Gate ${unimplemented.join(', ')} chưa xây dựng ở giai đoạn này và không được kiểm tra.`);
  }
  lines.push('', `Task ${taskId} hoàn thành. Bằng chứng: .compass/${taskId}/evidence/`);

  return {
    exitCode: 0,
    output: lines.join('\n'),
  };
}
