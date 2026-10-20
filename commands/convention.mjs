import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, validateTaskId } from '../lib/paths.mjs';
import { parseRules } from '../lib/rule-parser.mjs';
import { runRules } from '../lib/rule-runner.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { reposForGate } from '../lib/gates.mjs';
import { buildDraft, conventionStatus, DRAFT, CONVENTIONS } from '../lib/convention-draft.mjs';

function formatViolation(v) {
  const where = `${v.file}:${v.line}`;
  const why = v.message ? ` — ${v.message}` : '';
  return `${where}  [${v.rule}]${why}\n      ${v.text}`;
}

// `repo` là tên repo cần quét (null nếu dự án một repo, hoặc gọi thẳng từ CLI).
// `gateRoot` là gốc Compass — nơi có spec, luật và sổ gate. Luật thuộc về cả dự
// án, nhưng file được quét và bản ghi thuộc về từng repo.
export function conventionCommand({ cwd, taskId, repo = null, gateRoot = null }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass convention <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };

  const root = gateRoot ?? findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const chon = reposForGate(root, parseSpec(readFileSync(file, 'utf8')).scope, repo);
  if (!chon.ok) return { exitCode: 2, output: chon.output };
  // Dòng convention thiếu hay đã cũ nói về cả dự án, nên in một lần mỗi lần gate
  // chạy: `check` gọi gate này cho từng repo, và bản đầu lặp dòng đó theo số repo.
  if (chon.repos === null) return withStatus(root, quet({ root, file, taskId, dir: root, repo: null }));
  if (repo !== null) {
    const result = quet({ root, file, taskId, dir: chon.repos[0].dir, repo });
    const all = reposForGate(root, parseSpec(readFileSync(file, 'utf8')).scope, null);
    const first = all.ok && all.repos !== null && all.repos[0]?.name === repo;
    return first ? withStatus(root, result) : result;
  }

  // Gọi thẳng mà không nêu repo, ở dự án nhiều repo: quét lần lượt từng repo trong
  // phạm vi như `check` làm, và dừng ở repo đỏ đầu tiên. Quét gốc một lần rồi ghi
  // khe trần là đè lên bằng chứng theo repo bằng một bản ghi không nói đã đo gì.
  const lines = [];
  for (const r of chon.repos) {
    const result = quet({ root, file, taskId, dir: r.dir, repo: r.name });
    lines.push(`[${r.name}] ${result.output}`);
    if (result.exitCode !== 0) return withStatus(root, { exitCode: result.exitCode, output: lines.join('\n') });
  }
  return withStatus(root, { exitCode: 0, output: lines.join('\n') });
}

// Quét một thư mục — gốc khi dự án một repo, thư mục repo khi nhiều repo — và ghi
// vào khe của repo đó. `sourceHash` vẫn băm cả gốc: `done` băm gốc, băm riêng repo
// thì bản ghi nào cũng báo "Code đã thay đổi" ngay sau một lần chạy xanh.
function quet({ root, file, taskId, dir, repo }) {
  const conventionsFile = path.join(root, CONVENTIONS);

  // No conventions file is a legitimate state, not a failure: a project that
  // has not written rules down has none to break.
  if (!existsSync(conventionsFile)) {
    writeGate(root, taskId, {
      gate: 'convention',
      exitCode: 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      sourceHash: hashSource(root),
      rulesHash: null,
      ruleCount: 0,
      errorCount: 0,
      warnCount: 0,
      scanned: 0,
    }, repo);
    return {
      exitCode: 0,
      output: pass('convention', 'chưa có luật nào để kiểm tra'),
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
      sourceHash: hashSource(root),
      rulesHash: sha256(markdown),
      ruleCount: parsed.rules.length,
      errorCount: parsed.errors.length,
      warnCount: 0,
      scanned: 0,
    }, repo);
    return {
      exitCode: 1,
      output: [
        fail('convention', [`Luật khai báo sai trong ${CONVENTIONS}:`, ...parsed.errors]),
        '',
        hint('Sửa khối rule rồi chạy lại. Luật chạy không được thì không bảo vệ được gì.'),
      ].join('\n'),
    };
  }

  const result = runRules(dir, parsed.rules, { prefix: path.relative(root, dir) });

  writeGate(root, taskId, {
    gate: 'convention',
    exitCode: result.errorCount > 0 ? 1 : 0,
    checkedAt: new Date().toISOString(),
    specHash: hashFile(file),
    sourceHash: hashSource(root),
    rulesHash: sha256(markdown),
    ruleCount: parsed.rules.length,
    errorCount: result.errorCount,
    warnCount: result.warnCount,
    scanned: result.scanned,
  }, repo);

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

// Convention thiếu hay đã cũ nói ở mọi lần gate chạy, kèm sau kết quả gate. Chỉ
// thêm chữ: mã thoát và bản ghi gate không đổi, vì convention cũ không phải code sai.
function withStatus(root, result) {
  const { lines } = conventionStatus(root);
  return lines.length ? { ...result, output: [result.output, '', ...lines].join('\n') } : result;
}

// `compass convention --draft` — soạn bản nháp từ config và code của repo. Không
// cần task id: convention thuộc về cả repo, không thuộc một task.
export function conventionDraftCommand({ cwd, force = false }) {
  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json. Chạy compass init trước.' };

  const target = path.join(root, DRAFT);
  if (existsSync(target) && !force) {
    return {
      exitCode: 2,
      output: [
        `Đã có bản nháp ${DRAFT}. Đọc nó trước khi soạn lại.`,
        hint('Muốn soạn lại thì chạy: compass convention --draft --force'),
      ].join('\n'),
    };
  }

  const built = buildDraft(root);
  if (!built.ok) return { exitCode: 2, output: built.reason };

  // Ghi qua file tạm rồi đổi tên: hỏng giữa chừng thì không để lại nửa bản nháp
  // trông như bản thật.
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, built.text);
    renameSync(tmp, target);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* không xóa được file tạm thì thôi */ }
    return { exitCode: 1, output: `Không ghi được ${DRAFT}: ${err.code ?? err.message}` };
  }

  const { configs, stated, rules } = built.summary;
  return {
    exitCode: 0,
    output: [
      `Đã soạn bản nháp: ${DRAFT}`,
      `  ${configs} file config, ${stated} convention đếm từ code, ${rules} luật đề xuất`,
      '',
      hint(`Đưa bản nháp cho người duyệt. Người duyệt sửa rồi tự chuyển thành ${CONVENTIONS} — Compass không làm bước đó.`),
    ].join('\n'),
  };
}
