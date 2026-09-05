import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, validateTaskId } from '../lib/paths.mjs';
import { parseRules } from '../lib/rule-parser.mjs';
import { runRules } from '../lib/rule-runner.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

const CONVENTIONS = path.join('.knowledge', 'decided', 'conventions.md');

function formatViolation(v) {
  const where = `${v.file}:${v.line}`;
  const why = v.message ? ` — ${v.message}` : '';
  return `${where}  [${v.rule}]${why}\n      ${v.text}`;
}

export function conventionCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass convention <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const conventionsFile = path.join(root, CONVENTIONS);

  // No conventions file is a legitimate state, not a failure: a project that
  // has not written rules down has none to break.
  if (!existsSync(conventionsFile)) {
    writeGate(root, taskId, {
      gate: 'convention',
      exitCode: 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      rulesHash: null,
      ruleCount: 0,
      errorCount: 0,
      warnCount: 0,
      scanned: 0,
    });
    return {
      exitCode: 0,
      output: [
        pass('convention', 'chưa có luật nào để kiểm'),
        '',
        hint(`Muốn có gate thật thì viết luật vào ${CONVENTIONS} — xem SKILL.md mục Convention.`),
      ].join('\n'),
    };
  }

  let markdown;
  try {
    markdown = readFileSync(conventionsFile, 'utf8');
  } catch (err) {
    return { exitCode: 2, output: `Không đọc được ${CONVENTIONS}: ${err.message}` };
  }

  const parsed = parseRules(markdown);

  // A rule Compass cannot run is worse than no rule: it reads like coverage and
  // enforces nothing. Fail the gate so the author fixes the declaration.
  if (parsed.errors.length > 0) {
    writeGate(root, taskId, {
      gate: 'convention',
      exitCode: 1,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      rulesHash: sha256(markdown),
      ruleCount: parsed.rules.length,
      errorCount: parsed.errors.length,
      warnCount: 0,
      scanned: 0,
    });
    return {
      exitCode: 1,
      output: [
        fail('convention', [`Luật khai báo sai trong ${CONVENTIONS}:`, ...parsed.errors]),
        '',
        hint('Sửa khối rule rồi chạy lại. Luật chạy không được thì không bảo vệ được gì.'),
      ].join('\n'),
    };
  }

  const result = runRules(root, parsed.rules);

  writeGate(root, taskId, {
    gate: 'convention',
    exitCode: result.errorCount > 0 ? 1 : 0,
    checkedAt: new Date().toISOString(),
    specHash: hashFile(file),
    rulesHash: sha256(markdown),
    ruleCount: parsed.rules.length,
    errorCount: result.errorCount,
    warnCount: result.warnCount,
    scanned: result.scanned,
  });

  const warnings = result.violations.filter((v) => v.severity === 'warn');
  const errors = result.violations.filter((v) => v.severity === 'error');

  if (result.errorCount > 0) {
    const lines = [
      `${errors.length} vi phạm mức error trên ${result.scanned} file đã quét:`,
      ...errors.map(formatViolation),
    ];
    if (warnings.length) {
      lines.push('', `Kèm ${warnings.length} cảnh báo:`, ...warnings.map(formatViolation));
    }
    return {
      exitCode: 1,
      output: [
        fail('convention', lines),
        '',
        hint('Sửa code cho đúng quy ước. Quy ước sai thì sửa conventions.md và báo người — không lách.'),
      ].join('\n'),
    };
  }

  const detail = `${parsed.rules.length} luật, ${result.scanned} file, không vi phạm`;
  const lines = [pass('convention', detail)];
  if (warnings.length) {
    lines.push('', `${warnings.length} cảnh báo (không chặn gate):`, ...warnings.map(formatViolation));
  }

  return { exitCode: 0, output: lines.join('\n') };
}
