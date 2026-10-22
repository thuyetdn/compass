import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath, validateTaskId } from '../lib/paths.mjs';
import { collectDiff } from '../lib/review-brief.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { loadConfig } from '../lib/config.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { scanSecrets } from '../lib/secrets-scan.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { gitFilesFromRepoRoot } from '../lib/git-files.mjs';
import { planUnits, collectUnits, listUnits } from '../lib/workspace-git.mjs';

// Same base resolution as `review`, deliberately sharing `collectDiff` rather
// than re-deriving it. Two gates that describe different diffs disagree about
// what the task changed, and the user cannot tell which one is lying.

export function secretsCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass secrets <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const specSource = readFileSync(file, 'utf8');
  const spec = parseSpec(specSource);

  // Consent with no reason is not consent — it is a line someone added to make a
  // gate go quiet. The spec parser keeps the value only when it is non-empty, so
  // an empty declaration arrives here as "declared but blank".
  if (spec.envDeclared === '') {
    return {
      exitCode: 2,
      output: [
        fail('secrets', ['Dòng `Dùng .env:` có nhưng không nêu lý do.']),
        '',
        hint('Khai lý do cụ thể:\n    Dùng .env: <lý do>'),
      ].join('\n'),
    };
  }
  const declared = spec.envDeclared ?? null;

  const cfg = loadConfig(root);
  const khaiTrongSpec = spec.reviewBase !== null && spec.reviewBase !== undefined;
  const baseRef = khaiTrongSpec
    ? spec.reviewBase
    : (cfg.ok ? cfg.config.reviewBase ?? null : null);
  const nguonGoc = khaiTrongSpec ? 'spec' : (baseRef ? 'config.json' : null);

  // Không thu hẹp, cả bề ngang lẫn bề dọc. `Phạm vi` cắt theo đường dẫn và
  // `Soi đến` cắt theo thời điểm, nhưng cả hai đều cho task tự chọn thứ gate
  // được nhìn — mà task commit khoá ra ngoài chỗ nó khai chính là trường hợp gate này
  // sinh ra để bắt.
  //
  // `Soi đến` nguy hiểm hơn vì rẻ hơn: một dòng hợp lệ trong spec là đủ. Dựng
  // lại được — base A, commit B vô hại, commit C thêm `readFileSync('.env')`;
  // khai `Soi đến: B` thì `secrets` và `check` đều in PASSED trong khi dòng đọc
  // vẫn nằm ở HEAD. Lý do 1 và 2 sống sót vì chúng đọc `git ls-files`, nhưng lý
  // do 3 — chỗ duy nhất có chốt xin phép của người duyệt — thì bị đi vòng.
  //
  // Repo con có git riêng (CP-84) thì quét MỌI repo, không chỉ repo trong Phạm vi:
  // cùng lý do ở trên. Repo con đứng trên nhánh chính mà không ai khai gốc soi chỉ
  // góp thay đổi chưa commit, vì lịch sử của nó không phải việc của task.
  const plan = planUnits(root, spec, { forSecrets: true });
  if (!plan.ok) {
    return {
      exitCode: 2,
      output: [fail('secrets', plan.errors), '', hint('Sửa lời khai trong spec hay config.json rồi chạy lại.')].join('\n'),
    };
  }
  const diffOptions = {
    baseRef,
    baseFrom: nguonGoc,
    endRef: null,
    endFrom: 'spec',
    scopePaths: [],
  };
  const collected = plan.units
    ? collectUnits(root, plan, diffOptions, { forSecrets: true })
    : collectDiff(root, diffOptions);

  // An empty diff means two different things to the two gates that read one.
  // For `review` it is a broken base: nobody can review nothing, so it is red.
  // For `secrets` it is the answer — no change means no secret was added by this
  // task. The tracked and untracked scans below still run, so an empty diff is
  // never a scan that did not happen; it is a scan with one of its three inputs
  // legitimately empty.
  // Đọc mã lý do, không đọc lời văn. Bốn nhánh trong `collectDiff` cùng nghĩa
  // "diff rỗng" nhưng bốn câu chữ khác nhau; khớp chuỗi thì ai sửa lời văn là
  // gate này lặng lẽ đổi hành vi — đúng thứ SKILL.md gọi là suy ra ý người viết
  // từ văn bản.
  const khongCoThayDoi = !collected.ok && collected.ly_do === 'empty';

  if (!collected.ok && !khongCoThayDoi) {
    return {
      exitCode: 1,
      output: [
        fail('secrets', ['Không đọc được diff để quét:', ...String(collected.reason).split('\n')]),
        '',
        hint('Gate secrets cần đọc được lịch sử git. Sửa mốc soi rồi chạy lại — đừng bỏ qua.'),
      ].join('\n'),
    };
  }

  const diffText = collected.ok ? collected.diff : '';
  const diffFiles = collected.ok ? collected.files : [];
  const deletedFiles = collected.ok ? collected.deleted : [];

  // `?? []` ở đây từng biến một lệnh git hỏng thành "index không có `.env` nào".
  // Dựng lại được: tràn `maxBuffer` làm 195 file theo dõi thành 0, và gate xanh.
  // Không đọc được danh sách thì chưa quét được, mà báo xanh lúc chưa quét đúng
  // là kiểu sai Compass sinh ra để chặn.
  // Repo con góp index và file chưa ignore của nó, mang tiền tố như trong diff.
  const listAll = (args) => {
    if (!plan.units) return gitFilesFromRepoRoot(root, args);
    const own = plan.found.rootGit ? gitFilesFromRepoRoot(root, args) : [];
    const subs = listUnits(plan.units, args);
    return own === null || subs === null ? null : [...own, ...subs];
  };
  const tracked = listAll(['ls-files', '-z']);
  const untracked = listAll(['ls-files', '-z', '--others', '--exclude-standard']);

  if (tracked === null || untracked === null) {
    return {
      exitCode: 1,
      output: [
        fail('secrets', [
          'Không liệt kê được file trong repo, nên chưa quét được index lẫn file chưa ignore.',
          tracked === null ? '  git ls-files thất bại' : '  git ls-files --others thất bại',
        ]),
        '',
        hint('Kiểm tra lại repo git rồi chạy lại — đừng bỏ qua.'),
      ].join('\n'),
    };
  }

  const result = scanSecrets({
    diff: diffText,
    diffFiles,
    trackedFiles: tracked,
    untrackedUnignored: untracked,
    declared,
    deletedFiles,
  });

  const configFile = cfg.ok ? cfg.config : null;
  const record = {
    gate: 'secrets',
    exitCode: result.ok ? 0 : 1,
    at: new Date().toISOString(),
    specHash: hashFile(file),
    sourceHash: hashSource(root),
    configHash: configFile ? sha256(JSON.stringify(configFile)) : null,
    diffHash: sha256(diffText),
    base: collected.ok ? String(collected.base) : null,
    repoBases: collected.ok && collected.repoRanges?.length
      ? Object.fromEntries(collected.repoRanges.map((r) => [r.label, String(r.base)]))
      : undefined,
    declared,
    problemCount: result.problems.length,
  };

  if (!result.ok) {
    writeGate(root, taskId, record);
    const byReason = [1, 2, 3].map((n) => result.problems.filter((p) => p.reason === n));
    const lines = [];
    for (const group of byReason) {
      for (const p of group) {
        lines.push(`  ${p.message}`);
        for (const h of String(p.hint).split('\n')) lines.push(`      ${h}`);
      }
    }
    // Lý do 2 cũng in: nó chỉ cách lý do 1 một lần `git add -A`, và người đã khai
    // `Dùng .env:` rồi thấy "not ignored" đúng là người tưởng lời khai che cả file.
    // Lý do 3 thì cố ý không: lời khai đang tắt nó, và nếu có ngày hai thứ đứng
    // cạnh nhau thì câu "cho phép ĐỌC" bên một lỗi đọc là câu sai.
    const daKhai = declared && (byReason[0].length || byReason[1].length)
      ? ['', `Lời khai "Dùng .env: ${declared}" cho phép ĐỌC, không cho phép commit.`]
      : [];
    return {
      exitCode: 1,
      output: [
        fail('secrets', [`${result.problems.length} vấn đề:`, ...lines, ...daKhai]),
      ].join('\n'),
    };
  }

  writeGate(root, taskId, record);
  const dong = [
    pass('secrets', 'không thấy file .env nào trong diff, trong index, hay chưa được ignore.'),
  ];
  if (result.reads.length) {
    dong.push(`  ${result.reads.length} dòng đọc .env, đã khai: ${declared}`);
  }
  for (const n of result.notes) dong.push(`  ${n}`);
  return { exitCode: 0, output: dong.join('\n') };
}
