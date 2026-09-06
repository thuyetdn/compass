import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, taskDir } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { readGates, verifyAllGates } from '../lib/gate-store.mjs';
import { IMPLEMENTED_GATES } from '../lib/gates.mjs';
import { loadConfig } from '../lib/config.mjs';
import { resolveRepos, reposForScope } from '../lib/repos.mjs';



// Không có task id thì in cấu hình. Đòi task id ở đây từng khoá người dùng vào
// một vòng tròn: kiểm config thì phải có task, có task thì phải viết spec, mà
// viết spec thì cần biết config đọc ra đúng chưa. Dựng config là lúc rẻ nhất để
// bắt lockfile đoán sai — đắt hơn nhiều nếu phải đợi gate đỏ giữa chừng.
function cauHinh(root) {
  const cfg = loadConfig(root);
  if (!cfg.ok) {
    return { exitCode: 2, output: [`Config có lỗi:`, ...cfg.errors.map((e) => `  ${e}`)].join('\n') };
  }

  const resolved = resolveRepos(root, cfg.config);
  if (!resolved.ok) {
    return {
      exitCode: 2,
      output: [`Cấu hình repo có lỗi:`, ...resolved.errors.map((e) => `  ${e}`)].join('\n'),
    };
  }

  const lines = [`Gốc Compass: ${root}`, ''];

  // Một repo không khai `repos` vẫn phải xem được — `resolveRepos` trả về một
  // repo tên null, và đó là dự án bình thường chứ không phải cấu hình thiếu.
  const nhieu = cfg.config.repos !== undefined;
  lines.push(nhieu ? `Repo (${resolved.repos.length}):` : 'Một repo (không khai "repos"):');

  for (const repo of resolved.repos) {
    const ten = repo.name ?? '(gốc)';
    lines.push(`  ${ten}`);
    lines.push(`      test: ${repo.config.test}`);
    // Chỉ in devUrl của repo có khai. In "(không có)" cho mọi backend là nhiễu,
    // và tệ hơn: nó gợi ý rằng thiếu devUrl là chỗ cần sửa.
    if (repo.config.devUrl) lines.push(`      devUrl: ${repo.config.devUrl}`);
  }

  lines.push('', 'Đọc kỹ lệnh test từng repo — sai ở đây thì gate `test` đỏ mà không rõ vì sao.');
  return { exitCode: 0, output: lines.join('\n') };
}

export function statusCommand({ cwd, taskId }) {
  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  if (!taskId) return cauHinh(root);

  const file = specPath(root, taskId);
  if (!existsSync(file)) {
    // An investigation has no spec and no gates. Saying "no spec found" would
    // read as a broken task rather than a different kind of work.
    const investigation = path.join(taskDir(root, taskId), 'investigation.md');
    if (existsSync(investigation)) {
      return {
        exitCode: 2,
        output: [
          `${taskId} là một điều tra, không phải task BUILD — không có spec và không có gate.`,
          `  hồ sơ: .compass/${taskId}/investigation.md`,
          '',
          `Đóng bằng: compass investigate ${taskId} --close`,
        ].join('\n'),
      };
    }
    return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };
  }

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
  ];

  // With several repos declared, which ones a task touches is not obvious from
  // the spec's scope line alone — show what Compass read out of it.
  const cfg = loadConfig(root);
  if (cfg.ok && cfg.config.repos) {
    const resolved = resolveRepos(root, cfg.config);
    if (resolved.ok) {
      const applies = reposForScope(resolved.repos, spec.scope ?? '');
      lines.push(applies.length
        ? `Repo áp dụng: ${applies.map((r) => r.name).join(', ')}`
        : `Repo áp dụng: không repo nào khớp "Phạm vi: ${spec.scope ?? ''}"`);
    } else {
      lines.push(`Cấu hình repo có lỗi: ${resolved.errors[0]}`);
    }
  }


  // Task đã đóng thì nói ngay dòng đầu. Liệt kê gate mà không nói xong hay chưa
  // thì nhìn vào không phân biệt được task hoàn thành với task đang làm dở.
  if (gates.done && gates.done.exitCode === 0) {
    const luc = gates.done.closedAt ? ` (${gates.done.closedAt})` : "";
    lines.push(`Trạng thái: ĐÃ ĐÓNG${luc}`);
  } else {
    lines.push("Trạng thái: đang mở");
  }
  lines.push('');

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
    if (integrity.tampered.length) {
      lines.push('', `⚠ Chữ ký không khớp: ${integrity.tampered.join(', ')}`);
    }
    if (integrity.misslotted?.length) {
      lines.push('', `⚠ Bản ghi không thuộc slot này (bị chuyển từ gate khác): ${integrity.misslotted.join(', ')}`);
    }
    if (integrity.wrongTask?.length) {
      lines.push('', `⚠ Bản ghi thuộc task khác (bị copy sang đây): ${integrity.wrongTask.join(', ')}`);
    }
    if (integrity.outdated?.length) {
      lines.push('', `⚠ Bản ghi từ bản Compass cũ, chưa có taskId, cần chạy lại: ${integrity.outdated.join(', ')}`);
    }
  }

  return { exitCode: 0, output: lines.join('\n') };
}
