import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, evidenceDir, configPath, validateTaskId } from '../lib/paths.mjs';
import { loadConfig } from '../lib/config.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { runCommand } from '../lib/test-runner.mjs';
import { extractRanIds, compareWithSpec } from '../lib/test-parser.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

export function testCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass test <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) {
    return { exitCode: 2, output: validation.reason };
  }

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const cfg = loadConfig(root);
  if (!cfg.ok) return { exitCode: 2, output: cfg.errors.join('\n') };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const specIds = spec.testCases.map((c) => c.id);

  const run = runCommand(cfg.config.test, root);

  const dir = evidenceDir(root, taskId);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'test.log'), run.output);
  } catch (err) {
    return { exitCode: 2, output: `Không thể ghi evidence: ${err.message}` };
  }

  const extracted = extractRanIds(run.output, specIds);
  const comparison = compareWithSpec(specIds, extracted.ran);

  const suiteOk = run.exitCode === 0 && run.failure === null;
  const ok = suiteOk && comparison.ok;

  writeGate(root, taskId, {
    gate: 'test',
    command: cfg.config.test,
    exitCode: ok ? 0 : 1,
    suiteExitCode: run.exitCode,
    suiteFailure: run.failure,
    signal: run.signal,
    startedAt: new Date(Date.now() - run.durationMs).toISOString(),
    durationMs: run.durationMs,
    outputHash: sha256(run.output),
    outputFile: 'evidence/test.log',
    specHash: hashFile(file),
    configHash: hashFile(configPath(root)),
    specIdCount: specIds.length,
    ranIdCount: extracted.ran.length,
    missingIds: comparison.missing,
    seenOnNonPassLines: extracted.seenOnNonPassLines,
    seenOnUnknownLines: extracted.seenOnUnknownLines,
    seenOnSharedLines: extracted.seenOnSharedLines,
  });

  if (ok) {
    return {
      exitCode: 0,
      output: pass('test', `${extracted.ran.length}/${specIds.length} test cases đã chạy`),
    };
  }

  const lines = [];
  if (!suiteOk) {
    if (run.failure) {
      lines.push(`Quá trình không hoàn thành: ${run.failure}`);
    } else {
      lines.push(`Test suite trả về exit code ${run.exitCode}.`);
    }
    lines.push(`Xem output đầy đủ: ${path.join('.compass', taskId, 'evidence', 'test.log')}`);
  }
  if (!comparison.ok) {
    lines.push(`Spec khai báo ${specIds.length} test cases, chỉ tìm thấy ${extracted.ran.length} đã chạy.`);

    if (extracted.seenOnNonPassLines.length > 0) {
      lines.push(`Xuất hiện nhưng không pass (skip/fail/error): ${extracted.seenOnNonPassLines.join(', ')}`);
    }
    if (extracted.seenOnUnknownLines.length > 0) {
      lines.push(`Xuất hiện trên dòng không rõ định dạng (có thể dùng reporter khác): ${extracted.seenOnUnknownLines.join(', ')}`);
    }
    if (extracted.seenOnSharedLines.length > 0) {
      lines.push(`Cùng xuất hiện chung một dòng pass, không tách được ai chạy ai (mỗi ca cần một test riêng): ${extracted.seenOnSharedLines.join(', ')}`);
    }
    const neverSeen = comparison.missing.filter(
      (id) => !extracted.seenOnNonPassLines.includes(id) &&
              !extracted.seenOnUnknownLines.includes(id) &&
              !extracted.seenOnSharedLines.includes(id)
    );
    if (neverSeen.length > 0) {
      lines.push(`Không tìm thấy dấu vết: ${neverSeen.join(', ')}`);
    }
  }

  return {
    exitCode: 1,
    output: [
      fail('test', lines),
      '',
      hint('Viết test cho các case còn thiếu, hoặc sửa spec nếu chúng không còn cần thiết (sửa spec cần duyệt lại).'),
    ].join('\n'),
  };
}
