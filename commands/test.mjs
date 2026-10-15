import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, compassDir, evidenceDir, configPath, validateTaskId } from '../lib/paths.mjs';
import { loadConfig } from '../lib/config.mjs';
import { resolveRepos, reposForScope } from '../lib/repos.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { runCommand } from '../lib/test-runner.mjs';
import { extractRanIds, compareWithSpec } from '../lib/test-parser.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { hashSource } from '../lib/source-hash.mjs';

// `repo` là tên repo đang chạy (null nếu dự án một repo). `gateRoot` là thư mục
// gốc — nơi có spec và sổ gate. Lệnh test chạy trong `cwd` của repo, nhưng spec
// và bản ghi vẫn thuộc về task, không thuộc về repo.
export function testCommand({ cwd, taskId, repo = null, gateRoot = null, repos = null }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass test <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) {
    return { exitCode: 2, output: validation.reason };
  }

  const root = gateRoot ?? findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const cfg = loadConfig(root);
  if (!cfg.ok) return { exitCode: 2, output: cfg.errors.join('\n') };

  // Repo khai lệnh riêng thì dùng lệnh đó, chạy trong thư mục repo.
  const repoCfg = repo === null ? null : (cfg.config.repos?.[repo] ?? null);

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const specIds = spec.testCases.map((c) => c.id);

  // Nơi gọi không đưa danh sách repo thì tự nạp. `compass test <id>` gọi thẳng
  // từ CLI cũng phải chạy đúng những repo mà `check` chạy — nếu không, nó ghi
  // đè bằng chứng đỏ của một repo bằng kết quả xanh của lệnh chung ở gốc.
  let danhSachRepo = repos;
  if (danhSachRepo === null) {
    const resolved = resolveRepos(root, cfg.config);
    if (!resolved.ok) return { exitCode: 2, output: resolved.errors.join("\n") };
    const khop = reposForScope(resolved.repos, spec.scope);
    if (khop.length === 0) {
      return {
        exitCode: 2,
        output: `Phạm vi "${spec.scope}" không khớp repo nào đã khai.`,
      };
    }
    danhSachRepo = khop;
  }

  // Spec khai lệnh riêng thì dùng lệnh đó. `configHash` vẫn băm config.json,
  // nhưng `specHash` băm cả dòng khai này — đổi lệnh là đổi spec, và `done`
  // bắt được.
  // Việc kiểm tra bằng mắt thì gate nói thẳng nó không đo được gì. Im lặng xanh ở
  // đây là cửa sau: mọi task sẽ khai như vậy.
  const KIEM_HOP_LE = ['mắt', 'người', 'eye', 'manual'];
  if (spec.verifyBy !== null) {
    if (!KIEM_HOP_LE.includes(spec.verifyBy)) {
      return {
        exitCode: 2,
        output: `"${spec.verifyByKeyword}: ${spec.verifyBy}" không hợp lệ. Giá trị nhận: ${KIEM_HOP_LE.join(", ")}.`,
      };
    }
    if (specIds.length === 0) {
      return {
        exitCode: 2,
        output: "Khai kiểm tra bằng mắt vẫn phải liệt kê từng case và cách kiểm tra — bảng test case đang trống.",
      };
    }

    // Có test mang ID của task này là mâu thuẫn với lời khai. Đừng đoán bên nào đúng.
    const thu = runCommand(spec.testCommand ?? cfg.config.test, root);
    // Chỉ test **khai chủ là task này** mới là mâu thuẫn. Một dòng `H1` trần
    // thuộc về ai không rõ — nó chính là lý do task này khai kiểm tra bằng mắt.
    const cuaMinh = specIds.filter((id) => {
      // Escape task id: `.` và `+` là ký tự regex, và `validateTaskId` không chặn
      // chúng. Task id `v1.0+x` sẽ khớp nhầm nếu ghép thẳng vào mẫu.
      const esc = (t) => t.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
      const p = new RegExp(`(^|[^A-Za-z0-9])${esc(taskId)}[^A-Za-z0-9]{0,4}${esc(id)}([^A-Za-z0-9]|$)`, "m");
      return p.test(thu.output);
    });
    if (cuaMinh.length > 0) {
      return {
        exitCode: 2,
        output: [
          `Spec khai kiểm tra bằng ${spec.verifyBy}, nhưng suite có test mang ID của task này: ${cuaMinh.join(", ")}.`,
          `Bỏ dòng "${spec.verifyByKeyword}:" nếu task có test thật, hoặc đổi tên test nếu chúng thuộc task khác.`,
        ].join("\n"),
      };
    }

    writeGate(root, taskId, {
      gate: 'test',
      command: null,
      exitCode: 0,
      verifyBy: spec.verifyBy,
      specIdCount: specIds.length,
      ranIdCount: 0,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      specHash: hashFile(file),
      sourceHash: hashSource(root),
      configHash: hashFile(configPath(root)),
    }, repo);

    return {
      exitCode: 0,
      output: [
        pass("test", `${specIds.length} case kiểm tra bằng ${spec.verifyBy} — máy không đo gì ở đây`),
        "",
        hint("Gate này chỉ ghi nhận lời khai. Người duyệt phải tự đi qua từng case trong spec."),
      ].join("\n"),
    };
  }

  // Nhiều repo: chạy lệnh từng repo theo thứ tự, nối output lại. Đối chiếu ID
  // diễn ra một lần trên phần nối — repo nào chạy case nào là chuyện của người
  // viết test, Compass chỉ cần biết cuối cùng mọi case đã chạy chưa.
  const danhSach = danhSachRepo.length > 0 && danhSachRepo[0].name !== null
    ? danhSachRepo
    : [{ name: repo, dir: cwd, config: null }];

  const phan = [];
  let run = null;
  for (const r of danhSach) {
    const cfgRepo = r.name === null ? null : (cfg.config.repos?.[r.name] ?? null);
    const lenhR = cfgRepo?.test ?? spec.testCommand ?? cfg.config.test;
    const ket = runCommand(lenhR, r.dir);
    phan.push(r.name === null ? ket.output : `# repo ${r.name}\n${ket.output}`);
    // Repo đầu tiên đỏ thì dừng — chạy tiếp chỉ tốn thời gian cho kết quả đã đỏ.
    run = run === null ? ket : {
      ...ket,
      exitCode: run.exitCode !== 0 ? run.exitCode : ket.exitCode,
      failure: run.failure ?? ket.failure,
      durationMs: run.durationMs + ket.durationMs,
    };
    if (ket.exitCode !== 0 || ket.failure !== null) break;
  }
  run = { ...run, output: phan.join("\n") };
  const lenh = danhSach.length === 1
    ? (danhSach[0].name === null ? (spec.testCommand ?? cfg.config.test) : `repo ${danhSach[0].name}`)
    : danhSach.map((r) => r.name).join(", ");

  const dir = evidenceDir(root, taskId);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'test.log'), run.output);
  } catch (err) {
    return { exitCode: 2, output: `Không thể ghi evidence: ${err.message}` };
  }

  // Danh sách task và repo thật, để parser đối chiếu thay vì đoán từ hình dạng
  // chuỗi. Không có thì nó tự biết là không biết.
  let knownTasks = null;
  try {
    knownTasks = readdirSync(compassDir(root), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch { /* không đọc được thì thôi, parser tự xử */ }
  const repoNames = danhSach.map((r) => r.name).filter(Boolean);

  const extracted = extractRanIds(run.output, specIds, { taskId, knownTasks, repoNames });
  const comparison = compareWithSpec(specIds, extracted.ran);

  const suiteOk = run.exitCode === 0 && run.failure === null;
  const ok = suiteOk && comparison.ok;

  writeGate(root, taskId, {
    gate: 'test',
    command: lenh,
    exitCode: ok ? 0 : 1,
    suiteExitCode: run.exitCode,
    suiteFailure: run.failure,
    signal: run.signal,
    startedAt: new Date(Date.now() - run.durationMs).toISOString(),
    durationMs: run.durationMs,
    outputHash: sha256(run.output),
    outputFile: 'evidence/test.log',
    specHash: hashFile(file),
    sourceHash: hashSource(root),
    configHash: hashFile(configPath(root)),
    specIdCount: specIds.length,
    ranIdCount: extracted.ran.length,
    missingIds: comparison.missing,
    seenOnNonPassLines: extracted.seenOnNonPassLines,
    seenOnUnknownLines: extracted.seenOnUnknownLines,
    seenOnSharedLines: extracted.seenOnSharedLines,
    collidedIds: extracted.collided,
    seenOnOtherTasks: extracted.seenOnOtherTasks,
    seenOnBareLines: extracted.seenOnBareLines,
  }, repo);

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
      lines.push(`Cùng xuất hiện chung một dòng pass, không tách được ai chạy ai (mỗi case cần một test riêng): ${extracted.seenOnSharedLines.join(', ')}`);
    }
    if (extracted.seenOnOtherTasks.length > 0) {
      lines.push(`Có test mang ID này nhưng đều khai là của task khác: ${extracted.seenOnOtherTasks.join(", ")}`);
      lines.push(`      Task này chưa viết test cho những case đó.`);
    }
    if (extracted.seenOnBareLines.length > 0) {
      lines.push(`Task này đặt tên test kèm "${taskId}-", nên test tên trần không được tính: ${extracted.seenOnBareLines.join(', ')}`);
      for (const id of extracted.seenOnBareLines) {
        for (const name of extracted.bareMatches[id].slice(0, 3)) {
          lines.push(`      ${name}`);
        }
      }
    }
    if (extracted.collided.length > 0) {
      lines.push(`Khớp nhiều test khác nhau, không rõ cái nào là của task này: ${extracted.collided.join(', ')}`);
      for (const id of extracted.collided) {
        for (const name of extracted.collisions[id].slice(0, 3)) {
          lines.push(`      ${name}`);
        }
      }
    }
    const neverSeen = comparison.missing.filter(
      (id) => !extracted.seenOnNonPassLines.includes(id) &&
              !extracted.seenOnUnknownLines.includes(id) &&
              !extracted.seenOnSharedLines.includes(id) &&
              !extracted.collided.includes(id) &&
              !extracted.seenOnOtherTasks.includes(id) &&
              !extracted.seenOnBareLines.includes(id)
    );
    if (neverSeen.length > 0) {
      lines.push(`Không tìm thấy dấu vết: ${neverSeen.join(', ')}`);
    }
  }

  // Suite xanh mà hầu như không ID nào lộ diện: reporter nhiều khả năng không
  // in tên từng test. Không đòi con số 0 tuyệt đối — Vitest chỉ nêu tên những
  // test chậm, nên một spec 13 case vẫn có thể khớp đúng 1. Khớp được kha khá thì
  // loại trừ: reporter đó rõ ràng in được tên. Chỉ nêu khả năng, vì người dùng
  // vẫn có thể quên viết thật.
  const REPORTER_SUSPECT_RATIO = 0.2;
  const seenAnywhere = new Set([
    ...extracted.ran,
    ...extracted.seenOnNonPassLines,
    ...extracted.seenOnUnknownLines,
    ...extracted.seenOnSharedLines,
    // ID bị đụng độ cũng là ID đã lộ diện. Bỏ chúng ra khỏi đây thì gate vừa in
    // tên test lấy từ output, vừa bảo reporter không in tên test — hai câu chọi
    // nhau trên cùng màn hình, và đẩy người dùng đi sửa reporter đang chạy đúng.
    ...extracted.collided,
    ...extracted.seenOnOtherTasks,
    // Cùng lý do: test tên trần bị bỏ qua vẫn là test đã in tên ra output.
    ...extracted.seenOnBareLines,
  ]).size;
  const reporterLikely = suiteOk && !comparison.ok && specIds.length > 0 &&
    seenAnywhere / specIds.length < REPORTER_SUSPECT_RATIO;

  const hints = [];
  if (reporterLikely) {
    hints.push(hint('Suite xanh nhưng gần như không ID nào lộ diện — thường là reporter không in tên từng test. Kiểm tra trước: chạy lệnh test rồi xem output có tên test không. Vitest cần --reporter=tap, Jest cần --verbose.'));
    hints.push(hint('Nếu output đã có tên test mà vẫn không khớp, thì đúng là còn thiếu test — xem hướng dẫn dưới.'));
  }
  if (extracted.collided.length > 0) {
    // Đụng độ không phải "thiếu test" — test viết rồi, chỉ là không biết của
    // ai. Lời khuyên viết thêm test sẽ làm mọi thứ tệ hơn: thêm một dòng nữa
    // mang cùng ID là thêm một dòng đụng.
    hints.push(hint(`Những ID này đã có test chạy, nhưng nhiều test khác nhau cùng mang một ID nên gate không biết cái nào của task này. Đặt tên test kèm task id để chỉ rõ: \`${taskId}-${extracted.collided[0]} …\`. Chỉ cần đổi tên test của task này, không phải đổi test của người khác.`));
  }
  if (extracted.seenOnBareLines.length > 0) {
    const ten = `${taskId}-${extracted.seenOnBareLines[0]}`;
    hints.push(hint(`Test tên trần không cho biết nó của task nào. Nếu đó là test của task này, đổi tên thành \`${ten} …\`. Nếu không, viết test \`${ten} …\` cho case đó. Không cần đổi test của task khác.`));
  }
  hints.push(hint('Viết test cho các case còn thiếu, hoặc sửa spec nếu chúng không còn cần thiết (sửa spec cần duyệt lại).'));

  return {
    exitCode: 1,
    output: [fail('test', lines), '', ...hints].join('\n'),
  };
}
