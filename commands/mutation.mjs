import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { findRoot, specPath, configPath, validateTaskId } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { loadConfig } from '../lib/config.mjs';
import { reposForGate, repoPathError } from '../lib/gates.mjs';
import { writeGate, repoEvidenceDir } from '../lib/gate-store.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { runCommand } from '../lib/test-runner.mjs';
import { lazyTaskDiff } from '../lib/task-diff.mjs';
import { unitsOf, snapshot } from '../lib/review-rounds.mjs';
import { withWorktree } from '../lib/pr-source.mjs';
import { gitOf } from '../lib/preflight.mjs';
import {
  MUTANTS_FILE, declaredMutation, mutationConfigErrors, mutationSettings, candidates, spread,
} from '../lib/mutation.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

const TAIL = 40;
const HET_GIO = 'hết thời gian';

// `compass mutation <id>` (CP-109). Gọi từ `check` thì chạy đúng một repo; gọi thẳng thì đi
// qua mọi repo trong phạm vi, như `preflight`.
export function mutationCommand({ cwd, taskId, repo, gateRoot }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass mutation <id>' };
  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };
  const root = gateRoot ?? findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };
  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };
  const spec = parseSpec(readFileSync(file, 'utf8'));
  const cfg = loadConfig(root);
  if (!cfg.ok) return { exitCode: 2, output: fail('mutation', cfg.errors) };

  const scoped = reposForGate(root, spec.scope, repo ?? null);
  if (!scoped.ok) return { exitCode: 2, output: fail('mutation', scoped.output.split('\n')) };
  const list = scoped.repos ?? [{ name: null, dir: root, config: cfg.config }];

  // Lỗi khai báo của mọi repo trước khi repo nào chạy gì.
  const bad = list.flatMap((r) => mutationConfigErrors(r.config).map((e) => (r.name ? `[${r.name}] ${e}` : e)));
  for (const r of list) {
    const err = r.name ? repoPathError(r.name) : null;
    if (err) bad.push(err);
  }
  if (bad.length) return { exitCode: 2, output: [fail('mutation', bad), '', hint('Sửa config.json rồi chạy lại.')].join('\n') };

  const diffOf = lazyTaskDiff(root, spec, cfg);

  const outputs = [];
  let exitCode = 0;
  for (const r of list) {
    const result = runOne({ root, taskId, r, diffOf });
    outputs.push(r.name === null || repo != null ? result.output : `[${r.name}] ${result.output}`);
    if (result.exitCode !== 0) { exitCode = result.exitCode; break; }
  }
  return { exitCode, output: outputs.join('\n') };
}

const git = (cwd, args, env) => execFileSync('git', args, {
  cwd, encoding: 'utf8', maxBuffer: 50_000_000, stdio: ['ignore', 'pipe', 'pipe'],
  env: env ? { ...process.env, ...env } : process.env,
});

// Commit tạm bọc tree ảnh chụp, để `git worktree add` checkout được. Không ref nào trỏ vào
// nó: nhánh và HEAD của người dùng không đổi, `git gc` dọn sau hạn.
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Compass', GIT_AUTHOR_EMAIL: 'compass@localhost',
  GIT_COMMITTER_NAME: 'Compass', GIT_COMMITTER_EMAIL: 'compass@localhost',
};
const commitOf = (dir, tree) => git(dir, ['commit-tree', tree, '-m', 'compass mutation snapshot'], IDENTITY).trim();

function runOne({ root, taskId, r, diffOf }) {
  const startedAt = Date.now();
  // Băm trước khi đọc diff và chụp code: mutant chạy trên code lúc bắt đầu, và gate chạy hàng
  // phút trong khi người dùng vẫn sửa tiếp. Băm lúc kết thúc là đóng dấu cho code chưa ai đổi thử.
  const hashes = {
    specHash: hashFile(specPath(root, taskId)),
    sourceHash: hashSource(root),
    configHash: hashFile(configPath(root)),
  };
  const record = (fields) => writeGate(root, taskId, {
    gate: 'mutation',
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    ...hashes,
    ...fields,
  }, r.name);
  const red = (lines, extra = {}) => {
    record({ exitCode: 1, declared: true, ...extra });
    return { exitCode: 1, output: [fail('mutation', lines), '', hint('Sửa xong chạy lại: compass check')].join('\n') };
  };

  if (!declaredMutation(r.config)) {
    record({ exitCode: 0, declared: false });
    return { exitCode: 0, output: pass('mutation', 'chưa khai "mutation" trong config.json') };
  }
  const s = mutationSettings(r.config);
  const d = diffOf();
  if (!d.ok) return red([`Không tính được diff của task: ${d.reason}`]);

  const rel = r.name === null ? '' : path.relative(root, r.dir).split(path.sep).join('/');
  const all = candidates(d.collected.diff, rel);
  const picked = spread(all, s.max).map((m, i) => ({ id: `M${i + 1}`, ...m }));
  const dir = repoEvidenceDir(root, taskId, r.name);
  const writeMutants = (mutants) => {
    mkdirSync(dir, { recursive: true });
    const text = `${JSON.stringify({ task: taskId, repo: r.name, mutants }, null, 2)}\n`;
    writeFileSync(path.join(dir, MUTANTS_FILE), text);
    return sha256(text);
  };

  if (!picked.length) {
    const mutantsHash = writeMutants([]);
    record({ exitCode: 0, declared: true, counts: { candidates: 0, mutants: 0, killed: 0, survived: 0, notRun: 0 }, mutantsHash });
    return { exitCode: 0, output: pass('mutation', 'không có dòng code nào để đổi (chỉ test, tài liệu, comment, hay dòng không có toán tử)') };
  }

  // Git chứa repo này, và ảnh chụp code của task trong git đó.
  const key = gitOf({ root, plan: d.plan, collected: d.collected, name: r.name }).prefix || '.';
  const units = unitsOf(root, d.plan, d.collected);
  const unit = units.find((u) => u.key === key);
  const snap = snapshot(units, d.collected.files);
  if (!snap.ok) return red([snap.reason]);

  let ran;
  try {
    // Thư mục repo tính từ gốc git, hỏi chính git: `--show-toplevel` trả tên dài trên Windows
    // còn thư mục tạm mang tên 8.3 (`THUYET~1`), nên `path.relative` ra đường dẫn sai.
    const sub = git(r.dir, ['rev-parse', '--show-prefix']).trim();
    ran = withWorktree(unit.dir, commitOf(unit.dir, snap.trees[key]), (wt) => {
      // Cắt worktree khỏi repo của người dùng: lệnh test gọi `git branch` hay `git commit`
      // trong đó không được đổi ref nào. Git cũng không được đi lên khỏi thư mục tạm.
      rmSync(path.join(wt, '.git'), { force: true });
      return runMutants({ wt, cwd: path.join(wt, sub), unit, picked, s, deadline: startedAt + s.timeout * 1000 });
    });
  } catch (err) {
    return red([`Không dựng được worktree tạm: ${err.message}`]);
  }
  if (ran.red) return red(ran.red);

  const counts = {
    candidates: all.length,
    mutants: picked.length,
    killed: ran.mutants.filter((m) => m.result === 'killed').length,
    survived: ran.mutants.filter((m) => m.result === 'survived').length,
    notRun: ran.mutants.filter((m) => m.result === 'not-run').length,
  };
  const mutantsHash = writeMutants(ran.mutants);
  record({ exitCode: 0, declared: true, counts, mutantsHash, outputFile: path.relative(path.join(root, '.compass', taskId), path.join(dir, MUTANTS_FILE)).split(path.sep).join('/') });

  const notes = [];
  if (all.length > picked.length) notes.push(`${all.length} dòng đổi được; chọn ${picked.length} rải đều theo "mutation.max".`);
  const survived = ran.mutants.filter((m) => m.result === 'survived');
  if (survived.length) notes.push(`${survived.length} mutant sống vào brief vòng 1 để người soi xử lý: ${survived.map((m) => m.id).join(', ')}`);
  for (const m of ran.mutants.filter((x) => x.result === 'not-run')) notes.push(`${m.id} ${m.file}:${m.line} chưa chạy: ${m.reason}`);
  const summary = `${counts.mutants} mutant: ${counts.killed} bị giết, ${counts.survived} sống${counts.notRun ? `, ${counts.notRun} chưa chạy` : ''}`;
  return { exitCode: 0, output: [pass('mutation', summary), ...notes.map((n) => `ℹ ${n}`)].join('\n') };
}

const tailOf = (output) => output.replace(/\s+$/, '').split(/\r?\n/).slice(-TAIL).map((l) => `  ${l}`);
const timedOut = (res) => typeof res.failure === 'string' && res.failure.startsWith('Hết giờ');

function runMutants({ wt, cwd, unit, picked, s, deadline }) {
  const left = () => deadline - Date.now();
  const env = { GIT_CEILING_DIRECTORIES: path.dirname(wt) };
  const exec = (command) => runCommand(command, cwd, { timeoutMs: Math.max(1, left()), env });

  if (s.setup) {
    const res = exec(s.setup);
    if (res.exitCode !== 0) {
      return { red: [`Lệnh setup đỏ (exit ${res.exitCode}${res.failure ? `, ${res.failure}` : ''}): ${s.setup}`, 'Không chạy baseline, không chạy mutant nào.', ...tailOf(res.output)] };
    }
  }
  const baseline = exec(s.test);
  if (baseline.exitCode !== 0) {
    return {
      red: [
        `Lệnh test chạy trên code chưa đổi (baseline) đã đỏ trong worktree tạm (exit ${baseline.exitCode}${baseline.failure ? `, ${baseline.failure}` : ''}): ${s.test}`,
        'Không mutant nào chạy: test đỏ sẵn thì không phân biệt được mutant bị giết với mutant sống.',
        `${tailOf(baseline.output).length} dòng cuối:`, ...tailOf(baseline.output),
      ],
    };
  }

  const mutants = [];
  for (const m of picked) {
    const entry = { id: m.id, file: m.file, line: m.line, operator: m.operator, original: m.original, mutated: m.mutated };
    // Hết ngân sách thì lệnh nhận hạn 1 ms và bị dừng ngay: cùng một đường với mutant bị cắt giữa chừng.
    const file = path.join(wt, unit.prefix ? m.file.slice(unit.prefix.length + 1) : m.file);
    const before = readFileSync(file, 'utf8');
    const lines = before.split('\n');
    lines[m.line - 1] = m.mutated;
    writeFileSync(file, lines.join('\n'));
    let res;
    try {
      res = exec(s.test);
    } finally {
      writeFileSync(file, before);
    }
    if (timedOut(res)) mutants.push({ ...entry, result: 'not-run', reason: HET_GIO });
    else mutants.push({ ...entry, result: res.exitCode === 0 ? 'survived' : 'killed' });
  }
  return { mutants };
}
