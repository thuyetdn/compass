import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath, validateTaskId, configPath } from '../lib/paths.mjs';
import { collectDiff } from '../lib/review-brief.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { loadConfig } from '../lib/config.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { scanSecrets, parseSecretsPublic } from '../lib/secrets-scan.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { gitFilesFromRepoRoot } from '../lib/git-files.mjs';
import { planUnits, collectUnits, listUnits, notSkipped } from '../lib/workspace-git.mjs';

// Same base resolution as `review`, deliberately sharing `collectDiff` rather
// than re-deriving it. Two gates that describe different diffs disagree about
// what the task changed, and the user cannot tell which one is lying.

// Dòng ghi chú của lần chạy (repo bị bỏ qua, CP-88) đi cuối output, dù gate xanh hay đỏ.
export function secretsCommand(options) {
  const notes = [];
  const result = secretsOnce(options, notes);
  if (!notes.length) return result;
  return { ...result, output: [result.output, ...notes.map((n) => `ℹ ${n}`)].join('\n') };
}

// `loadConfig` từ chối config thiếu `test`, mà vài workspace vẫn để vậy. Lời khai
// `secretsPublic` trong đó vẫn là lời khai: đọc thẳng từ JSON, đừng để nó biến mất
// không một tiếng rồi gate đỏ trên đúng file đã khai.
function docSecretsPublic(root, cfg, notes) {
  if (cfg.ok) return cfg.config.secretsPublic;
  const file = configPath(root);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'))?.secretsPublic;
  } catch {
    notes.push('config.json không phải JSON hợp lệ — không đọc được secretsPublic, gate quét mọi file .env');
    return undefined;
  }
}

function secretsOnce({ cwd, taskId }, notes) {
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

  // Lời khai sai thì từ chối, không đoán: một mẫu `be/.env*` mà lặng lẽ bỏ qua là
  // gate đỏ không rõ vì sao, còn hiểu nó như glob là mở đúng lỗ CP-91 đã đóng.
  // Chỉ gate này đọc `secretsPublic`, nên config hỏng ở đây không chặn `test`.
  const khaiPublic = parseSecretsPublic(docSecretsPublic(root, cfg, notes));
  if (!khaiPublic.ok) {
    return {
      exitCode: 2,
      output: [fail('secrets', khaiPublic.errors), '', hint('Sửa "secretsPublic" trong .compass/config.json rồi chạy lại.')].join('\n'),
    };
  }
  const daKhaiPublic = khaiPublic.paths;

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
  // cùng lý do ở trên. Repo con ngoài Phạm vi mà không ai khai gốc soi chỉ góp thay
  // đổi chưa commit, đứng ở nhánh nào cũng vậy, vì lịch sử của nó không phải việc của
  // task (issue #2, CP-88). Repo trong Phạm vi thì diff như `review` diff nó.
  const plan = planUnits(root, spec, { forSecrets: true });
  if (!plan.ok) {
    return {
      exitCode: 2,
      output: [fail('secrets', plan.errors), '', hint('Sửa lời khai trong spec hay config.json rồi chạy lại.')].join('\n'),
    };
  }
  notes.push(...(plan.notes ?? []));
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
    if (own === null || subs === null) return null;
    // Chỉ file chưa theo dõi mới bỏ theo repo bị bỏ qua; index thì quét trọn (CP-88).
    return args.includes('--others') ? [...own, ...subs].filter(notSkipped(plan.found)) : [...own, ...subs];
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
    publicFiles: daKhaiPublic,
  });

  // Gate xanh nhờ lời khai thì phải nói ra, cả khi đỏ vì chỗ khác: không ai được
  // đọc "PASSED" thành "đã quét file này và sạch" (issue #3).
  for (const p of result.publicTracked) notes.push(`secretsPublic: không quét ${p} — config.json khai là file public`);
  for (const p of result.publicUntracked) notes.push(`secretsPublic khai ${p} nhưng git không theo dõi file đó — lời khai không có tác dụng`);

  const record = {
    gate: 'secrets',
    exitCode: result.ok ? 0 : 1,
    at: new Date().toISOString(),
    specHash: hashFile(file),
    sourceHash: hashSource(root),
    // Băm cả file, cùng cách `test` băm, để `done` so được: gỡ một dòng `secretsPublic`
    // sau khi gate xanh thì bản ghi này phải mất hiệu lực (CP-91). Băm cả khi config
    // thiếu hay bị từ chối, để `done` báo config đổi chứ không đổ cho bản ghi cũ.
    configHash: hashFile(configPath(root)),
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
  // File khai public vẫn nằm trong index, chỉ là không quét: dòng PASSED không được
  // nói index sạch, vì dòng `ℹ` giải thích nằm tận cuối output.
  const khongQuet = result.publicTracked.length;
  const dong = [
    pass('secrets', khongQuet
      ? `${khongQuet} file đang theo dõi được config.json khai public nên không quét; ngoài chúng, diff, index và file chưa ignore không có .env nào.`
      : 'không thấy file .env nào trong diff, trong index, hay chưa được ignore.'),
  ];
  if (result.reads.length) {
    dong.push(`  ${result.reads.length} dòng đọc .env, đã khai: ${declared}`);
  }
  for (const n of result.notes) dong.push(`  ${n}`);
  return { exitCode: 0, output: dong.join('\n') };
}
