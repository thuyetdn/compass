import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, evidenceDir, validateTaskId } from '../lib/paths.mjs';
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
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'test.log'), run.output);

  const ranIds = extractRanIds(run.output, specIds);
  const comparison = compareWithSpec(specIds, ranIds);

  const suiteOk = run.exitCode === 0;
  const ok = suiteOk && comparison.ok;

  writeGate(root, taskId, {
    gate: 'test',
    command: cfg.config.test,
    exitCode: ok ? 0 : 1,
    suiteExitCode: run.exitCode,
    startedAt: new Date(Date.now() - run.durationMs).toISOString(),
    durationMs: run.durationMs,
    outputHash: sha256(run.output),
    outputFile: 'evidence/test.log',
    specHash: hashFile(file),
    specIdCount: specIds.length,
    ranIdCount: ranIds.length,
    missingIds: comparison.missing,
  });

  if (ok) {
    return {
      exitCode: 0,
      output: pass('test', `${ranIds.length}/${specIds.length} test cases đã chạy`),
    };
  }

  const lines = [];
  if (!suiteOk) {
    lines.push(`Test suite trả về exit code ${run.exitCode}.`);
    lines.push(`Xem output đầy đủ: ${path.join('.compass', taskId, 'evidence', 'test.log')}`);
  }
  if (!comparison.ok) {
    lines.push(`Spec khai báo ${specIds.length} test cases, chỉ tìm thấy ${ranIds.length} đã chạy.`);
    lines.push(`Thiếu: ${comparison.missing.join(', ')}`);
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
