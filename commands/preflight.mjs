import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, configPath } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { loadConfig } from '../lib/config.mjs';
import { reposForGate, repoPathError } from '../lib/gates.mjs';
import { writeGate, repoEvidenceDir } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { runCommand } from '../lib/test-runner.mjs';
import { lazyTaskDiff } from '../lib/task-diff.mjs';
import { declared, configErrors, unsafeName, substitute, gitOf, editedMigrations, upstreamLine } from '../lib/preflight.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

const TAIL = 40;

// `compass preflight <id>` (CP-108). Gọi từ `check` thì chạy đúng một repo (`repo` là tên,
// hay null ở dự án một repo). Gọi thẳng thì đi qua mọi repo trong phạm vi, như `convention`.
export function preflightCommand({ cwd, taskId, repo, gateRoot }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass preflight <id>' };
  const root = gateRoot ?? findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };
  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };
  const spec = parseSpec(readFileSync(file, 'utf8'));
  const cfg = loadConfig(root);
  if (!cfg.ok) return { exitCode: 2, output: fail('preflight', cfg.errors) };

  const scoped = reposForGate(root, spec.scope, repo ?? null);
  if (!scoped.ok) return { exitCode: 2, output: fail('preflight', scoped.output.split('\n')) };
  const list = scoped.repos ?? [{ name: null, dir: root, config: cfg.config }];

  // Lỗi khai báo của mọi repo trước khi repo nào chạy lệnh nào.
  const bad = list.flatMap((r) => configErrors(r.config).map((e) => (r.name ? `[${r.name}] ${e}` : e)));
  for (const r of list) {
    const err = r.name ? repoPathError(r.name) : null;
    if (err) bad.push(err);
  }
  if (bad.length) return { exitCode: 2, output: [fail('preflight', bad), '', hint('Sửa config.json rồi chạy lại.')].join('\n') };

  // Diff của task đọc một lần, chỉ khi có repo cần nó.
  const diffOf = lazyTaskDiff(root, spec, cfg);

  const outputs = [];
  let exitCode = 0;
  for (const r of list) {
    const result = runOne({ root, taskId, spec, r, diffOf });
    outputs.push(r.name === null || repo != null ? result.output : `[${r.name}] ${result.output}`);
    if (result.exitCode !== 0) { exitCode = result.exitCode; break; }
  }
  return { exitCode, output: outputs.join('\n') };
}

function runOne({ root, taskId, spec, r, diffOf }) {
  const startedAt = Date.now();
  const rel = r.name === null ? '' : path.relative(root, r.dir).split(path.sep).join('/');
  const commands = r.config.preflight ?? [];
  const globs = r.config.migrations ?? [];
  const infos = [];
  const lines = [];
  const log = [];
  const ran = [];
  let red = null;
  let migrations = { checked: globs.length > 0, edited: [], exempted: [] };

  const lag = upstreamLine(r.dir);
  if (lag) infos.push(lag);

  if (declared(r.config)) {
    const d = diffOf();
    const where = d.ok ? gitOf({ root, plan: d.plan, collected: d.collected, name: r.name }) : null;

    // 1. Migration đã có ở gốc soi bị sửa.
    if (globs.length) {
      const got = d.ok ? editedMigrations(where, { globs, rel }) : { ok: false, reason: d.reason };
      if (!got.ok) {
        red = [`Không kiểm tra được migration: ${got.reason}.`];
      } else {
        const allowed = new Map((spec.migrationExceptions ?? []).filter((x) => x.ok).map((x) => [x.path, x.reason]));
        const exempted = got.edited.filter((e) => allowed.has(e.path));
        const blocked = got.edited.filter((e) => !allowed.has(e.path));
        migrations = { checked: true, edited: got.edited.map((e) => e.path), exempted: exempted.map((e) => e.path) };
        for (const e of exempted) infos.push(`Migration ${e.path} (${e.label}) được phép theo dòng Ngoại lệ migration của spec: ${allowed.get(e.path)}`);
        if (blocked.length) {
          const base = String(where.base).slice(0, 7);
          red = [
            `Migration đã có ở gốc soi ${base} bị sửa trong diff:`,
            ...blocked.map((e) => `  ${e.path} (${e.label})`),
            'Migration đã áp thì không sửa: viết một migration mới. Người duyệt cho phép thì thêm vào phần đầu spec, mỗi file một dòng:',
            ...blocked.map((e) => `  Ngoại lệ migration: ${e.path} — <lý do>`),
          ];
        }
      }
    }

    // 2. Lệnh khai trong config, theo thứ tự, dừng ở lệnh đỏ đầu tiên.
    for (const command of red ? [] : commands) {
      const needsDiff = command.includes('{changed}') || command.includes('{base}');
      let changed = [];
      if (needsDiff) {
        if (!d.ok) { red = [`Lệnh cần diff của task mà không tính được diff: ${d.reason}`, `  ${command}`]; break; }
        const del = new Set(d.collected.deleted ?? []);
        changed = (d.collected.files ?? []).filter((f) => !del.has(f))
          .filter((f) => !rel || f.startsWith(`${rel}/`)).map((f) => (rel ? f.slice(rel.length + 1) : f));
        const unsafe = changed.filter(unsafeName);
        if (command.includes('{changed}') && unsafe.length) {
          red = [
            'Tên file không đưa vào lệnh shell an toàn được (có ", $, `, %, \\ hay xuống dòng), nên lệnh không chạy:',
            ...unsafe.map((f) => `  ${rel ? `${rel}/` : ''}${f}`),
            `  Lệnh: ${command}`,
          ];
          break;
        }
        if (command.includes('{changed}') && changed.length === 0) {
          infos.push(`Lệnh bỏ qua vì repo không có file nào đổi: ${command}`);
          log.push(`$ ${command}\n(bỏ qua: không có file đổi)\n`);
          ran.push({ command, skipped: true });
          continue;
        }
        if (command.includes('{base}') && !where.base) { red = ['Lệnh cần {base} mà không biết gốc soi của git chứa repo này.', `  ${command}`]; break; }
      }
      const actual = substitute(command, { changed, base: where?.base ?? null });
      const res = runCommand(actual, r.dir);
      const code = res.failure ? `${res.exitCode ?? '?'}, ${res.failure}` : res.exitCode;
      log.push(`$ ${actual}\n${res.output}\n(exit ${code})\n`);
      ran.push({ command, exitCode: res.exitCode, durationMs: res.durationMs });
      if (res.exitCode !== 0 || res.failure) {
        const tail = res.output.replace(/\s+$/, '').split(/\r?\n/).slice(-TAIL);
        red = [`Lệnh preflight đỏ (exit ${code}): ${command}`, `${tail.length} dòng cuối:`, ...tail.map((l) => `  ${l}`)];
        break;
      }
    }
  }

  const dir = repoEvidenceDir(root, taskId, r.name);
  const logFile = path.join(dir, 'preflight.log');
  if (log.length) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(logFile, log.join('\n'));
  }
  writeGate(root, taskId, {
    gate: 'preflight',
    exitCode: red ? 1 : 0,
    commands: ran,
    migrations,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    outputFile: log.length ? path.relative(path.join(root, '.compass', taskId), logFile).split(path.sep).join('/') : null,
    specHash: hashFile(specPath(root, taskId)),
    sourceHash: hashSource(root),
    configHash: hashFile(configPath(root)),
  }, r.name);

  const notes = infos.map((i) => `ℹ ${i}`);
  if (red) {
    const where = path.relative(root, logFile).split(path.sep).join('/');
    return {
      exitCode: 1,
      output: [fail('preflight', red), ...(log.length ? ['', hint(`Output đầy đủ: ${where}`)] : []), ...notes].join('\n'),
    };
  }
  if (!declared(r.config)) {
    lines.push(pass('preflight', 'chưa khai preflight hay migrations trong config.json'));
  } else {
    const n = ran.filter((x) => !x.skipped).length;
    lines.push(pass('preflight', `${n} lệnh xanh${globs.length ? ', không migration đã áp nào bị sửa' : ''}`));
  }
  return { exitCode: 0, output: [...lines, ...notes].join('\n') };
}
