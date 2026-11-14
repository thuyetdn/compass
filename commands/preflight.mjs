import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findRoot, specPath, configPath, validateTaskId } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { loadConfig } from '../lib/config.mjs';
import { reposForGate, repoPathError } from '../lib/gates.mjs';
import { writeGate, repoEvidenceDir } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { runCommand } from '../lib/test-runner.mjs';
import { lazyTaskDiff } from '../lib/task-diff.mjs';
import { declared, configErrors, unsafeName, substitute, gitOf, editedMigrations, upstreamLine } from '../lib/preflight.mjs';
import { checkClaims, docSources, specSource } from '../lib/claims.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

const TAIL = 40;

// `compass preflight <id>` (CP-108). Gọi từ `check` thì chạy đúng một repo (`repo` là tên,
// hay null ở dự án một repo). Gọi thẳng thì đi qua mọi repo trong phạm vi, như `convention`.
export function preflightCommand({ cwd, taskId, repo, gateRoot }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass preflight <id>' };
  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };
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

  // Diff của task đọc một lần.
  const diffOf = lazyTaskDiff(root, spec, cfg);
  // Spec nói về mọi repo trong phạm vi: tuyên bố của nó tìm ở mọi repo đó và ở gốc (CP-110).
  const all = reposForGate(root, spec.scope, null);
  const specAnchors = [...new Set([...(all.ok && all.repos ? all.repos.map((x) => x.dir) : []), root])];

  const outputs = [];
  let exitCode = 0;
  for (const r of list) {
    const result = runOne({ root, taskId, spec, r, diffOf, specAnchors });
    outputs.push(r.name === null || repo != null ? result.output : `[${r.name}] ${result.output}`);
    if (result.exitCode !== 0) { exitCode = result.exitCode; break; }
  }
  return { exitCode, output: outputs.join('\n') };
}

// File diff của task xoá hay đổi tên đi, đường dẫn tuyệt đối (CP-113). `--no-renames`: một `git mv` hiện
// ra là xoá tên cũ. Không biết gốc soi thì tập rỗng, và claim check phán như trước.
function removedFiles(where) {
  if (!where?.base) return new Set();
  try {
    const out = execFileSync('git', ['diff', '--no-renames', '--no-ext-diff', '--relative', '--name-only', '-z', '--diff-filter=D', where.base, ...(where.end ? [where.end] : [])], {
      cwd: where.cwd, encoding: 'utf8', maxBuffer: 50_000_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(out.split('\0').filter(Boolean).map((p) => path.resolve(where.cwd, p)));
  } catch {
    return new Set();
  }
}

// Nội dung một file ở phía mới của diff: commit Soi đến của git chứa nó, hay cây làm việc (CP-110).
function newSide(root, where) {
  return (file) => {
    try {
      if (!where?.end) return readFileSync(path.join(root, file), 'utf8');
      const inGit = where.prefix ? file.slice(where.prefix.length + 1) : file;
      return execFileSync('git', ['show', `${where.end}:${inGit}`], { cwd: where.cwd, encoding: 'utf8', maxBuffer: 50_000_000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };
}

function runOne({ root, taskId, spec, r, diffOf, specAnchors }) {
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
  let claims = null;

  const lag = upstreamLine(r.dir);
  if (lag) infos.push(lag);

  {
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

    // 2. Claim check (CP-110): đường dẫn, commit và tên hàm trong tài liệu vừa thêm và trong spec.
    // Chạy cả khi config không khai gì.
    if (!red) {
      const exempt = new Map((spec.claimExceptions ?? []).filter((x) => x.ok).map((x) => [x.span, x.reason]));
      const docAnchors = [...new Set([r.dir, root])];
      const got = checkClaims([
        ...(d.ok ? docSources(d.collected.diff ?? '', rel, docAnchors, newSide(root, where)) : []),
        specSource(readFileSync(specPath(root, taskId), 'utf8'), `.compass/${taskId}/spec.md`, specAnchors),
      ], exempt, removedFiles(where));
      claims = { checked: got.checked.length, wrong: got.wrong.length, exempted: [...got.exempted.keys()] };
      for (const [span, reason] of got.exempted) infos.push(`Tuyên bố \`${span}\` được miễn theo dòng Tuyên bố ngoài repo của spec: ${reason}`);
      if (got.wrong.length) {
        red = [
          `${got.wrong.length} tuyên bố trong tài liệu hay spec không khớp repo:`,
          ...got.wrong.map((c) => `  ${c.where} \`${c.span}\` — ${c.reason}`),
          'Sửa tài liệu cho đúng. Tuyên bố đúng ở một repo Compass không thấy thì người duyệt thêm vào phần đầu spec, mỗi span một dòng:',
          ...[...new Set(got.wrong.map((c) => c.span))].map((sp) => `  Tuyên bố ngoài repo: ${sp} — <lý do>`),
        ];
      }
    }

    // 3. Lệnh khai trong config, theo thứ tự, dừng ở lệnh đỏ đầu tiên.
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
    claims,
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
