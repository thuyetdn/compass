import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, validateTaskId } from '../lib/paths.mjs';
import { parseRules } from '../lib/rule-parser.mjs';
import { runRules, rulesTouching } from '../lib/rule-runner.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { reposForGate, repoPathError } from '../lib/gates.mjs';
import { buildDraft, conventionStatus, repoUnitDir, DRAFT, CONVENTIONS } from '../lib/convention-draft.mjs';
import { draftFile, ownFile, readDeclaredRepos, readNoLink, readOwn, ownProblems, problemLines, code, cliRepo } from '../lib/repo-conventions.mjs';

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
    const result = quetRepo({ root, file, taskId, r: chon.repos[0] });
    const all = reposForGate(root, parseSpec(readFileSync(file, 'utf8')).scope, null);
    const first = all.ok && all.repos !== null && all.repos[0]?.name === repo;
    return first ? withStatus(root, result) : result;
  }

  // Gọi thẳng mà không nêu repo, ở dự án nhiều repo: quét lần lượt từng repo trong
  // phạm vi như `check` làm, và dừng ở repo đỏ đầu tiên. Quét gốc một lần rồi ghi
  // khe trần là đè lên bằng chứng theo repo bằng một bản ghi không nói đã đo gì.
  const lines = [];
  for (const r of chon.repos) {
    const result = quetRepo({ root, file, taskId, r });
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

  return reportRun(parsed, result, 'conventions.md');
}

// Kết quả một lần chạy luật, chung cho gốc và từng repo con. `which` là file luật nêu
// trong lời khuyên khi quy ước sai.
function reportRun(parsed, result, which) {
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
        hint(`Sửa code cho đúng quy ước. Quy ước sai thì sửa ${which} và báo người — không lách.`),
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

// Quét một repo con ở dự án nhiều repo (CP-103, issue #6). Luật của repo nằm ở
// `.knowledge/decided/conventions/<repo>.md` — cùng file brief soi code đưa người soi, nên
// gate và brief không còn nói về hai bộ luật khác nhau. Thứ tự dừng:
//   1. repo chưa có convention đã duyệt → đỏ, với mọi loại task (không có dòng miễn);
//   2. `conventions.md` của gốc khai sai → đỏ, như trước;
//   3. luật của gốc khớp file của repo → đỏ: luật ở gốc chỉ áp cho file của gốc, và
//      để nó lặng lẽ thôi bảo vệ repo là kiểu sai issue #6 phàn nàn, theo chiều ngược;
//   4. file của repo còn tiêu chí chưa trả lời, thiếu bằng chứng hay chờ người quyết → đỏ;
//   5. luật của repo khai sai → đỏ; còn lại chạy luật của repo như gate vẫn chạy.
function quetRepo({ root, file, taskId, r }) {
  const target = ownFile(r.name);
  const record = (extra) => writeGate(root, taskId, {
    gate: 'convention',
    exitCode: 1,
    checkedAt: new Date().toISOString(),
    specHash: hashFile(file),
    sourceHash: hashSource(root),
    rulesHash: null,
    ruleCount: 0,
    errorCount: 0,
    warnCount: 0,
    scanned: 0,
    ...extra,
  }, r.name);
  const arg = cliRepo(r.name);

  const own = readOwn(root, r.name);
  if (own === null) {
    record({});
    return {
      exitCode: 1,
      output: [
        fail('convention', [
          `Repo ${code(r.name)} chưa có convention đã duyệt (${code(target)}).`,
          'Code chỉ đúng khi có chuẩn để so, nên gate dừng ở đây với mọi loại task.',
        ]),
        '',
        hint([
          `DỪNG và hỏi người dùng: có tạo bản nháp convention cho ${code(r.name)} theo 12 tiêu chí không? Đồng ý thì:`,
          `  1. compass convention --draft --repo=${arg}`,
          '  2. Đọc các file mẫu trong bản nháp, điền mục "Agent đọc và viết", mỗi ý kèm file làm bằng chứng',
          '  3. Đưa người dùng duyệt bản nháp và từng dòng `- [ ]`',
          `  4. Người dùng xác nhận thì: compass convention --approve --repo=${arg}`,
        ].join('\n')),
      ].join('\n'),
    };
  }

  let rootText = '';
  let rootRules = [];
  const rootFile = path.join(root, CONVENTIONS);
  if (existsSync(rootFile)) {
    try {
      rootText = readFileSync(rootFile, 'utf8');
    } catch (err) {
      return { exitCode: 2, output: `Không đọc được ${CONVENTIONS}: ${err.message}` };
    }
    const parsedRoot = parseRules(rootText);
    if (parsedRoot.errors.length > 0) {
      record({ rulesHash: sha256(rootText), ruleCount: parsedRoot.rules.length, errorCount: parsedRoot.errors.length });
      return {
        exitCode: 1,
        output: [
          fail('convention', [`Luật khai báo sai trong ${CONVENTIONS}:`, ...parsedRoot.errors]),
          '',
          hint('Sửa khối rule rồi chạy lại. Luật chạy không được thì không bảo vệ được gì.'),
        ].join('\n'),
      };
    }
    rootRules = parsedRoot.rules;
  }

  const prefix = path.relative(root, r.dir).split(path.sep).join('/');
  const rulesHash = sha256(`${own}\0${rootText}`);
  const touching = rulesTouching(r.dir, rootRules, { prefix });
  if (touching.length > 0) {
    record({ rulesHash, ruleCount: rootRules.length, errorCount: touching.length });
    return {
      exitCode: 1,
      output: [
        fail('convention', [
          `${touching.length} luật ở ${CONVENTIONS} khớp file của repo ${code(r.name)}, nhưng luật ở gốc chỉ áp cho file của gốc:`,
          ...touching.map(({ rule, file: hit }) => `- ${code(rule.id)} (scope ${code(rule.scope)}), ví dụ ${code(hit)}`),
        ]),
        '',
        hint(`Chuyển các luật đó sang ${target}, hoặc sửa scope để không khớp file của ${r.name}. Đây là .knowledge/decided/: hỏi người duyệt, không tự sửa.`),
      ].join('\n'),
    };
  }

  const gaps = problemLines(ownProblems(own, r.dir, { evidence: false }));
  if (gaps.length > 0) {
    record({ rulesHash });
    return {
      exitCode: 1,
      output: [
        fail('convention', [`${target} chưa xong:`, ...gaps]),
        '',
        hint('Điền tiếp cho đủ và đưa người dùng quyết các dòng `- [ ]`. Đây là file đã duyệt: hỏi người duyệt trước khi sửa.'),
      ].join('\n'),
    };
  }

  const parsed = parseRules(own);
  if (parsed.errors.length > 0) {
    record({ rulesHash, ruleCount: parsed.rules.length, errorCount: parsed.errors.length });
    return {
      exitCode: 1,
      output: [
        fail('convention', [`Luật khai báo sai trong ${target}:`, ...parsed.errors]),
        '',
        hint('Sửa khối rule rồi chạy lại. Luật chạy không được thì không bảo vệ được gì.'),
      ].join('\n'),
    };
  }

  const result = runRules(r.dir, parsed.rules, { prefix });
  record({
    exitCode: result.errorCount > 0 ? 1 : 0,
    rulesHash,
    ruleCount: parsed.rules.length,
    errorCount: result.errorCount,
    warnCount: result.warnCount,
    scanned: result.scanned,
  });
  return reportRun(parsed, result, target);
}

// Convention thiếu hay đã cũ nói ở mọi lần gate chạy, kèm sau kết quả gate. Chỉ
// thêm chữ: mã thoát và bản ghi gate không đổi, vì convention cũ không phải code sai.
function withStatus(root, result) {
  const { lines } = conventionStatus(root);
  return lines.length ? { ...result, output: [result.output, '', ...lines].join('\n') } : result;
}

// `compass convention --draft` — soạn bản nháp từ config và code của repo. Không
// cần task id: convention thuộc về cả repo, không thuộc một task.
//
// `repo` (CP-98): soạn cho riêng một repo trong `repos`, ghi vào
// `.compass/conventions-draft/<repo>.md`. Tên repo đi vào đường dẫn, nên phải là một
// khóa có thật trong config và qua cùng luật tên với `ui`/`visual` trước khi ghi gì.
export function conventionDraftCommand({ cwd, force = false, repo = null }) {
  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json. Chạy compass init trước.' };

  if (repo !== null) {
    const refused = checkDraftRepo(root, repo);
    if (refused) return { exitCode: 2, output: refused };
  }
  const relTarget = repo === null ? DRAFT : draftFile(repo);
  const destination = ownFile(repo);
  const again = repo === null ? 'compass convention --draft --force' : `compass convention --draft --repo=${cliRepo(repo)} --force`;

  const target = path.join(root, relTarget);
  if (existsSync(target) && !force) {
    return {
      exitCode: 2,
      output: [
        `Đã có bản nháp ${relTarget}. Đọc nó trước khi soạn lại.`,
        hint(`Muốn soạn lại thì chạy: ${again}`),
      ].join('\n'),
    };
  }

  const built = buildDraft(root, { only: repo });
  if (!built.ok) return { exitCode: 2, output: built.reason };

  // Ghi qua file tạm rồi đổi tên: hỏng giữa chừng thì không để lại nửa bản nháp
  // trông như bản thật.
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(tmp, built.text);
    renameSync(tmp, target);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* không xóa được file tạm thì thôi */ }
    return { exitCode: 1, output: `Không ghi được ${relTarget}: ${err.code ?? err.message}` };
  }

  const { configs, stated, rules } = built.summary;
  return {
    exitCode: 0,
    output: [
      `Đã soạn bản nháp: ${relTarget}`,
      `  ${configs} file config, ${stated} convention đếm từ code, ${rules} luật đề xuất`,
      '',
      repo === null
        ? hint(`Đưa bản nháp cho người duyệt. Người duyệt sửa rồi tự chuyển thành ${destination} — Compass không làm bước đó.`)
        : hint([
          `Đọc các file mẫu trong bản nháp và điền mục "Agent đọc và viết", mỗi ý kèm file làm bằng chứng.`,
          `  Đưa người dùng duyệt bản nháp và từng dòng \`- [ ]\`. Người dùng xác nhận thì chạy: compass convention --approve --repo=${cliRepo(repo)}`,
        ].join('\n')),
    ].join('\n'),
  };
}

// `compass convention --approve --repo=<repo>` (CP-103, issue #6): chép bản nháp đã điền
// thành `.knowledge/decided/conventions/<repo>.md`. Chỉ chạy sau khi người dùng xác nhận —
// skill bắt agent hỏi trước; lệnh không biết ai đang gõ nó. Từ chối khi bản nháp còn tiêu
// chí chưa trả lời, thiếu bằng chứng, hay còn dòng `- [ ]`. Không bao giờ ghi đè file đã
// duyệt, và không ghi qua symlink hay junction nào.
export function conventionApproveCommand({ cwd, repo = null }) {
  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json. Chạy compass init trước.' };
  if (repo === null) {
    return { exitCode: 2, output: '--approve cần --repo=<tên repo>: chỉ convention riêng của từng repo con được duyệt bằng lệnh này.' };
  }
  const refused = checkDraftRepo(root, repo);
  if (refused) return { exitCode: 2, output: refused };

  const dir = repoUnitDir(root, repo);
  if (dir === null) return { exitCode: 2, output: `Không tìm thấy thư mục của repo "${repo}" trên máy này.` };

  const rel = draftFile(repo);
  const destination = ownFile(repo);
  const text = readNoLink(root, rel);
  if (text === null) {
    return {
      exitCode: 2,
      output: [
        `Không có bản nháp ${rel} (hay nó là link hoặc thư mục, Compass không đọc qua đó).`,
        hint(`Soạn bản nháp trước: compass convention --draft --repo=${cliRepo(repo)}`),
      ].join('\n'),
    };
  }
  try {
    lstatSync(path.join(root, destination));
    return {
      exitCode: 2,
      output: `Đã có ${destination}. Compass không ghi đè convention đã duyệt: người duyệt sửa file đó bằng tay, hoặc tự xóa nó rồi chạy lại.`,
    };
  } catch { /* chưa có: đúng như cần */ }

  const p = ownProblems(text, dir);
  if (!p.applies) {
    return {
      exitCode: 1,
      output: [
        `Bản nháp ${rel} không có mục "Agent đọc và viết" — nó được soạn trước khi Compass có 12 tiêu chí.`,
        hint(`Soạn lại: compass convention --draft --repo=${cliRepo(repo)} --force`),
      ].join('\n'),
    };
  }
  const gaps = problemLines(p);
  if (gaps.length) {
    return {
      exitCode: 1,
      output: [
        fail('convention', [`Bản nháp ${rel} chưa duyệt được:`, ...gaps]),
        '',
        hint('Điền tiếp cho đủ, đưa người dùng quyết các dòng `- [ ]`, rồi chạy lại lệnh này.'),
      ].join('\n'),
    };
  }

  // `.knowledge/` chưa có thì đây là file đầu tiên trong đó, và gate `knowledge` sẽ đòi tài
  // liệu máy sinh ở lần `check` sau (lần soi đầu của CP-103): nói trước.
  const firstKnowledge = !existsSync(path.join(root, '.knowledge'));
  const wrote = writeNoLink(root, destination, text);
  if (wrote) return { exitCode: 2, output: wrote };
  return {
    exitCode: 0,
    output: [
      `✓ Đã duyệt convention của repo ${repo}: ${destination}`,
      '',
      hint(firstKnowledge
        ? 'Đây là file đầu tiên trong .knowledge/: chạy compass knowledge --sync, rồi compass check <id>.'
        : 'Chạy lại gate: compass check <id>. Từ giờ gate convention chạy luật của file này trên repo đó.'),
    ].join('\n'),
  };
}

// Ghi `rel` dưới `root`, tạo thư mục còn thiếu, không đi qua link nào và không ghi đè.
// Trả lý do từ chối, hay null khi đã ghi.
function writeNoLink(root, rel, text) {
  const parts = rel.split('/');
  let at = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    at = path.join(at, parts[i]);
    let info = null;
    try { info = lstatSync(at); } catch { /* chưa có */ }
    if (info === null) {
      try { mkdirSync(at); } catch (err) { return `Không tạo được ${parts.slice(0, i + 1).join('/')}: ${err.code ?? err.message}`; }
    } else if (!info.isDirectory()) {
      // `lstat`: symlink hay junction không bao giờ là thư mục ở đây.
      return `${parts.slice(0, i + 1).join('/')} là symlink, junction hay không phải thư mục — Compass không ghi convention qua đó.`;
    }
  }
  try {
    // `wx` là lớp thứ hai, cố ý: `--approve` đã từ chối khi file có sẵn, nhưng một file
    // xuất hiện giữa hai bước vẫn không bị ghi đè. Bỏ một lớp thì lớp kia giữ, nên mutation
    // một dòng ở đây sống sót mà test không rỗng (CP-103-E2).
    writeFileSync(path.join(at, parts[parts.length - 1]), text, { flag: 'wx' });
  } catch (err) {
    return `Không ghi được ${rel}: ${err.code ?? err.message}`;
  }
  return null;
}

// Lý do từ chối `--repo`, hay null. Đọc JSON thô: thiếu `test` ở một repo không phải
// lý do để không soạn được convention cho nó.
function checkDraftRepo(root, repo) {
  if (typeof repo !== 'string' || repo === '') return 'Viết --repo=<tên repo>, có dấu "=" và một tên khai trong "repos".';
  const raw = readDeclaredRepos(root);
  if (!raw.ok) {
    return raw.reason === 'missing'
      ? 'Không đọc được .compass/config.json.'
      : '.compass/config.json không phải JSON hợp lệ — sửa nó rồi chạy lại.';
  }
  const declared = raw.repos;
  if (declared === null) {
    return '--repo chỉ dùng khi config.json khai "repos". Dự án một repo thì chạy: compass convention --draft';
  }
  const bad = repoPathError(repo);
  if (bad) return bad;
  const keys = Object.keys(declared).sort();
  if (!Object.hasOwn(declared, repo)) {
    return `Không có repo "${repo}" trong "repos" của config.json. Repo đã khai: ${keys.join(', ') || '(không có)'}.`;
  }
  return null;
}
