import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { findRoot, specPath, taskDir, evidenceDir, validateTaskId, configPath } from '../lib/paths.mjs';
import { collectDiff, buildBrief, briefSubject, parseScopePaths, secretsPublicSection, briefSecretsPublic } from '../lib/review-brief.mjs';
import { parseSecretsPublic, secretsPublicFromText, normalisePath } from '../lib/secrets-scan.mjs';
import { parseFindings, formatFinding, checkCoverage, BLOCKING } from '../lib/findings.mjs';
import { collectContext } from '../lib/review-context.mjs';
import { planUnits, collectUnits, notSkipped } from '../lib/workspace-git.mjs';
import { writeGate, readGate } from '../lib/gate-store.mjs';
import { loadConfig } from '../lib/config.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

const BRIEF_FILE = 'review-brief.md';
const FINDINGS_FILE = 'findings.json';

// The brief carries a short id, and findings must quote it back. That is what
// ties one verdict to one brief: without it, findings written for older code
// stay valid forever, and no timestamp or diff hash closes the gap.
//
// The id covers the spec as well as the diff. A reviewer judges code against
// what it promised, so changing the promise invalidates the verdict just as
// surely as changing the code — and hashing only the diff let a rewritten spec
// reopen the gate once, then pass on the next run.
//
// CP-78 adds the context for the same reason. With an id over spec and diff
// alone, findings written against yesterday's conventions file would answer
// today's brief as soon as it was regenerated — the same one-run reopen, one
// layer up.
export const briefIdFor = (spec, diff, context) =>
  sha256(`${sha256(spec)}\n${sha256(diff)}\n${sha256(context)}`).slice(7, 19);

export function briefId(findingsSource) {
  try {
    return JSON.parse(findingsSource)?.brief ?? null;
  } catch {
    return null;
  }
}

// Brief cũ nói về đúng spec và diff này không. Không đọc được hai phần đó (brief
// sửa tay, hay mẫu brief đã khác) thì coi như không — báo "code hoặc spec đã đổi"
// an toàn hơn đoán là ngữ cảnh.
export function sameSubject(oldBrief, spec, diff) {
  const old = briefSubject(oldBrief);
  return old !== null && old.spec === spec && old.diff === diff;
}

// `secretsPublic` của config hiện tại, hay null khi không khai gì (CP-93). Config hỏng
// JSON cũng là null: gate `secrets` đã nói ra điều đó, brief không nhắc lại.
function khaiPublicNay(root) {
  const file = configPath(root);
  if (!existsSync(file)) return null;
  const doc = secretsPublicFromText(readFileSync(file, 'utf8'));
  if (!doc.ok || doc.value === undefined) return null;
  const parsed = parseSecretsPublic(doc.value);
  return parsed.ok && parsed.paths.length === 0 ? null : parsed;
}

// `secretsPublic` trong config.json ở gốc soi của git gốc: một lần `git show`. Không
// đọc được vì bất kỳ lý do gì thì "không biết", và brief coi nó như dòng mới.
function khaiPublicOGoc(root, ref, { rootGit, emptyTree }) {
  if (!rootGit) return { ok: false, reason: 'gốc Compass không nằm trong git, nên không có `config.json` ở gốc soi để so' };
  if (emptyTree) return { ok: false, reason: 'gốc soi là cây rỗng của git, chưa có `config.json` nào' };
  if (!ref || String(ref).startsWith('-')) return { ok: false, reason: 'không biết gốc soi của git gốc' };
  let text;
  try {
    // `./` tính đường dẫn từ cwd, nên đúng cả khi gốc Compass là thư mục con của repo.
    text = execFileSync('git', ['show', `${ref}:./.compass/config.json`], {
      cwd: root, encoding: 'utf8', maxBuffer: 10_000_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return { ok: false, reason: '`config.json` không nằm trong git ở gốc soi' };
  }
  const doc = secretsPublicFromText(text);
  if (!doc.ok) return { ok: false, reason: '`config.json` ở gốc soi không phải JSON hợp lệ' };
  if (doc.value === undefined) return { ok: true, paths: [] };
  if (!Array.isArray(doc.value)) return { ok: false, reason: '`secretsPublic` ở gốc soi không phải danh sách' };
  return { ok: true, paths: doc.value.filter((v) => typeof v === 'string').map((v) => normalisePath(v.trim())) };
}

// Dòng ghi chú của lần chạy (repo bị bỏ qua, CP-88) đi cuối output, dù gate xanh hay đỏ.
export function reviewCommand(options) {
  const notes = [];
  const result = reviewOnce(options, notes);
  if (!notes.length) return result;
  return { ...result, output: [result.output, ...notes.map((n) => `ℹ ${n}`)].join('\n') };
}

function reviewOnce({ cwd, taskId }, notes) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass review <id>' };

  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const briefFile = path.join(taskDir(root, taskId), BRIEF_FILE);
  const findingsFile = path.join(evidenceDir(root, taskId), FINDINGS_FILE);

  // Where this task's work starts. Left unset, Compass walks back to the branch
  // point or the first commit — safe, but on a long-lived branch that is the
  // whole project rather than one task. `reviewBase` in config names the real
  // starting point when the default is too wide.
  const cfg = loadConfig(root);

  // Spec đè config. `reviewBase` trong config là một giá trị chung cho cả dự án,
  // nên trên nhánh mang nhiều task nó chỉ đúng cho một task: những task còn lại
  // được soi trên diff không chứa code của chúng, agent nộp findings, và gate
  // xanh trên bằng chứng nói về việc của người khác. Gặp thật ở CP-6, CP-10,
  // CP-11, CP-13 — code của chúng nằm cách gốc soi tới 21 commit.
  const spec = parseSpec(readFileSync(file, 'utf8'));
  const khaiTrongSpec = spec.reviewBase !== null && spec.reviewBase !== undefined;
  const baseRef = khaiTrongSpec
    ? spec.reviewBase
    : (cfg.ok ? cfg.config.reviewBase ?? null : null);
  // Nói ra chỗ khai. Ref không phân giải được mà chỉ báo tên ref thì người đọc
  // đi sửa config trong khi lời khai nằm ở spec, hoặc ngược lại.
  //
  // Ba giá trị, không phải hai: không ai khai gì thì Compass tự lần về điểm rẽ,
  // và nói "khai ở config.json" lúc đó là lời khai sai — nó chỉ người đọc tới
  // một file không có dòng nào như vậy.
  //
  // Điều kiện phải TRÙNG với `resolveBase`, chỗ dùng `if (baseRef)`. Dùng
  // `!== null` ở đây thì `reviewBase: 0` bị resolveBase bỏ qua mà brief vẫn khai
  // "khai ở config.json" — lời khai sai về một giá trị chưa từng được dùng.
  const nguonGoc = khaiTrongSpec ? 'spec' : (baseRef ? 'config.json' : null);

  // Nơi việc kết thúc, và diff thu hẹp theo Phạm vi — chỉ khi có Soi đến. Một
  // task ở đỉnh nhánh vẫn được soi trọn, kể cả file nó quên khai (CP-36).
  const khaiCuoi = spec.reviewEnd !== null && spec.reviewEnd !== undefined;
  const scopeParsed = parseScopePaths(spec.scope);
  // `Soi đến (be):` của repo con cũng thu hẹp theo Phạm vi (CP-84).
  const thuHep = khaiCuoi || Object.keys(spec.repoEnds ?? {}).length > 0;
  if (thuHep && scopeParsed.rejected.length) {
    return {
      exitCode: 2,
      output: [
        fail('review', [
          'Phạm vi trong spec có mục không dùng được làm pathspec:',
          ...scopeParsed.rejected.map((r) => `  "${r.entry}" — ${r.reason}`),
        ]),
        '',
        hint('Phạm vi chỉ nhận đường dẫn tương đối trong repo, phân cách bằng dấu phẩy.'),
      ].join('\n'),
    };
  }
  const diffOptions = {
    baseRef,
    baseFrom: nguonGoc,
    endRef: khaiCuoi ? spec.reviewEnd : null,
    endFrom: 'spec',
    scopePaths: khaiCuoi ? scopeParsed.paths : [],
    // Đường dẫn `.compass/` khai trong Phạm vi được soi, có hay không có Soi đến (CP-48).
    compassPaths: scopeParsed.paths,
  };

  // Repo con có git riêng (CP-84): mỗi git một diff, gộp vào một brief. Không có
  // repo con nào như vậy thì `units` là null và mọi thứ đi đúng đường cũ.
  const plan = planUnits(root, spec);
  if (!plan.ok) {
    return {
      exitCode: 2,
      output: [fail('review', plan.errors), '', hint('Sửa lời khai trong spec hay config.json rồi chạy lại.')].join('\n'),
    };
  }
  notes.push(...(plan.notes ?? []));
  const collect = () => (plan.units
    ? collectUnits(root, plan, diffOptions, { scopePaths: scopeParsed.paths })
    : collectDiff(root, diffOptions));

  // Ngữ cảnh dò một lần cho mỗi lần đọc diff: brief, id và luật `basis` phải
  // nói về cùng một bản ngữ cảnh (CP-78).
  const contexts = new WeakMap();
  const contextOf = (collected) => {
    if (!contexts.has(collected)) {
      contexts.set(collected, collectContext(root, {
        files: collected.files,
        deleted: collected.deleted ?? [],
        units: plan.units ?? [],
        rootGit: plan.units ? plan.found.rootGit : true,
        keep: notSkipped(plan.found),
      }));
    }
    return contexts.get(collected);
  };
  // CP-93: lời khai `secretsPublic` vào brief và vào id brief, nên thêm hay bớt một
  // dòng sau khi soi thì findings cũ không còn trả lời brief này. Không khai thì mục
  // rỗng, id và brief y như trước — các lần soi đang dở không bị mở lại khi nâng cấp.
  const khaiNay = khaiPublicNay(root);
  const publics = new WeakMap();
  const publicOf = (collected) => {
    if (!khaiNay) return '';
    if (!publics.has(collected)) {
      // Một git: gốc soi là của chính diff. Nhiều git: `rootBase` có cả khi diff của git
      // gốc rỗng — bố cục issue #3, git gốc chỉ theo dõi `.compass/`.
      const goc = plan.units
        ? collected.rootBase ?? null
        : { base: collected.base, fromEmptyTree: collected.fromEmptyTree === true };
      const base = khaiNay.ok
        ? khaiPublicOGoc(root, goc?.base ?? null, {
          rootGit: plan.units ? plan.found.rootGit : true,
          emptyTree: goc?.fromEmptyTree === true,
        })
        : null;
      publics.set(collected, secretsPublicSection(khaiNay, base));
    }
    return publics.get(collected);
  };
  const idOf = (collected) => briefIdFor(readFileSync(file, 'utf8'), collected.diff, contextOf(collected).text + publicOf(collected));

  // Ba chỗ dựng brief, một hình dạng. Lệch một trường là brief "hiện tại" ở pha
  // hai không khớp brief pha một đã ghi, và gate mở lại vô cớ.
  const briefFor = (collected) => buildBrief({
    taskId,
    spec: readFileSync(file, 'utf8'),
    diff: collected.diff,
    files: collected.files,
    briefId: idOf(collected),
    context: contextOf(collected).text,
    base: collected.base,
    baseFrom: nguonGoc,
    end: collected.end ?? null,
    endAtHead: collected.endAtHead ?? false,
    narrowedTo: collected.narrowedTo ?? [],
    // Repo một commit soi từ cây rỗng; brief phải nói ra điều đó (CP-52).
    fromEmptyTree: collected.fromEmptyTree ?? false,
    rootRange: collected.rootRange ?? true,
    repoRanges: collected.repoRanges ?? [],
    secretsPublic: publicOf(collected),
  });

  // Phase two: an agent has answered, so read the verdict — but only if the
  // answer is about the code as it stands now. A finding set outlives the diff
  // it was written against: reviewer reports Major, author fixes, reruns, and
  // the stale pass would sail through. That is normal workflow, not cheating.
  if (existsSync(findingsFile)) {
    const current = collect();
    const recorded = readGate(root, taskId, 'review')?.diffHash ?? null;

    // Mọi nhánh thoát của pha hai đều phải ghi sổ. `done` đọc sổ chứ không chạy
    // lại gate, nên một nhánh quên ghi là một đường cho verdict xanh cũ sống sót:
    // xoá brief đi thì `review` đỏ, nhưng `gate.json` vẫn nói xanh và task đóng
    // được. Gate `review` cũng không có sourceHash để `done` bắt bù.
    const ghiDo = (lyDo) => writeGate(root, taskId, {
      gate: 'review',
      exitCode: 1,
      reason: lyDo,
      diffHash: current.ok ? sha256(current.diff) : null,
      specHash: hashFile(file),
      startedAt: new Date().toISOString(),
      durationMs: 0,
    });

    // Findings without a brief describe a review nobody was briefed for. The
    // brief is what an agent was given; with none, there is nothing to trust —
    // and deleting gate.json must not turn a stale verdict back into a pass.
    if (!existsSync(briefFile) || !recorded) {
      ghiDo(!existsSync(briefFile) ? 'brief-missing' : 'record-missing');
      return {
        exitCode: 1,
        output: [
          fail('review', [
            !existsSync(briefFile)
              ? 'Có findings nhưng chưa từng sinh brief — không có bằng chứng ai đã soi cái gì.'
              : 'Không còn bản ghi brief nào khớp với findings này.',
          ]),
          '',
          hint(`Xóa .compass/${taskId}/evidence/${FINDINGS_FILE} rồi chạy lại: compass review ${taskId}`),
        ].join('\n'),
      };
    }

    // Findings answer one specific brief, and say so: the reviewer copies the
    // brief's id into the file. Timestamps cannot stand in for that — they have
    // one-second resolution on Windows — and the recorded diffHash cannot
    // either, because a phase-one run between review and verdict refreshes it,
    // which would make an old verdict read as current.
    const source = readFileSync(findingsFile, 'utf8');

    // Malformed JSON is a format problem, and saying so is more useful than
    // reporting the brief id it could not contain.
    const parsed = parseFindings(source);
    if (!parsed.findings) {
      ghiDo('findings-malformed');
      return {
        exitCode: 2,
        output: [
          fail('review', parsed.errors),
          '',
          hint(`Sửa ${FINDINGS_FILE} cho đúng format rồi chạy lại: compass review ${taskId}`),
        ].join('\n'),
      };
    }

    // No diff means no way to tell whether these findings describe today's
    // code. Every check below rests on that comparison, so skipping them all
    // and passing would be the gate's worst possible answer — renaming .git or
    // reverting the tree to base was enough to walk straight through.
    if (!current.ok) {
      // Returning non-zero is not enough: done reads gate.json instead of
      // rerunning gates, so an earlier pass left in place closes the task. A
      // diff that grew past the size limit reaches here too, which turns
      // "wrote a lot of code" into a way to freeze an old verdict.
      writeGate(root, taskId, {
        gate: 'review',
        exitCode: 1,
        checkedAt: new Date().toISOString(),
        specHash: hashFile(file),
        briefHash: existsSync(briefFile) ? hashFile(briefFile) : null,
        diffHash: null,
        findingCount: null,
        blockingCount: null,
      });
      return {
        exitCode: 2,
        output: [
          fail('review', [
            'Không đối chiếu được findings với code hiện tại.',
            current.reason,
          ]),
          '',
          hint('Không so được thì không phán được. Sửa xong chạy lại: compass review ' + taskId),
        ].join('\n'),
      };
    }

    const wanted = briefFor(current);
    const briefIsCurrent = readFileSync(briefFile, 'utf8') === wanted;
    const answersThisBrief = briefId(source) === idOf(current);

    if (!briefIsCurrent) {
      // Brief cũ ghi nguyên spec và diff nó được viết cho. Cả hai còn y nguyên mà
      // brief vẫn khác thì thứ đổi là ngữ cảnh repo — convention, nơi gọi, tài liệu
      // — chứ không phải việc của task. Nói "code đã đổi" lúc đó là bảo người đọc đi
      // tìm một thay đổi không có (CP-38). Đọc từ brief chứ không từ sổ: nhánh
      // findings-hỏng ghi đè sổ, và lần chạy sau báo nhầm (CP-79).
      const briefCu = readFileSync(briefFile, 'utf8');
      const onlyContext = sameSubject(briefCu, readFileSync(file, 'utf8'), current.diff);
      const khaiPublicDoi = onlyContext && briefSecretsPublic(briefCu) !== publicOf(current);
      writeFileSync(briefFile, wanted);
      writeGate(root, taskId, {
        gate: 'review',
        exitCode: 1,
        checkedAt: new Date().toISOString(),
        specHash: hashFile(file),
        briefHash: hashFile(briefFile),
        diffHash: sha256(current.diff),
        findingCount: null,
        blockingCount: null,
      });
      return {
        exitCode: 1,
        output: [
          fail('review', [
            khaiPublicDoi
              ? 'Danh sách secretsPublic trong config.json đã đổi sau khi soi — findings hiện có xét trên danh sách cũ.'
              : onlyContext
              ? 'Brief đã đổi dù spec và code của task không đổi: ngữ cảnh repo (convention, nơi gọi, tài liệu) hoặc mẫu brief của Compass đã khác — findings hiện có xét trên brief cũ.'
              : 'Code hoặc spec đã đổi sau khi soi — findings hiện có nói về bản cũ.',
            `Đã sinh brief mới: .compass/${taskId}/${BRIEF_FILE}`,
          ]),
          '',
          hint(`Xóa .compass/${taskId}/evidence/${FINDINGS_FILE} rồi đưa brief mới cho một agent khác soi lại.`),
        ].join('\n'),
      };
    }

    if (!answersThisBrief) {
      // The brief is current, so nothing changed underneath the reviewer. The
      // findings simply answer a different brief — copied from another task, or
      // left over from an earlier round. Saying "code đã đổi" here sends the
      // reader hunting for a change that never happened (CP-38).
      const quoted = briefId(source);
      const wantedId = idOf(current);
      writeGate(root, taskId, {
        gate: 'review',
        exitCode: 1,
        checkedAt: new Date().toISOString(),
        specHash: hashFile(file),
        briefHash: hashFile(briefFile),
        diffHash: sha256(current.diff),
        findingCount: null,
        blockingCount: null,
      });
      return {
        exitCode: 1,
        output: [
          fail('review', [
            quoted === null
              ? 'Findings không ghi trường brief — không biết nó soi bản code nào.'
              : `Findings không trả lời brief này — trường brief ghi ${quoted}, brief hiện tại là ${wantedId}.`,
            'Code và spec không đổi. Findings này chép từ task khác, hoặc còn lại từ lần soi trước.',
          ]),
          '',
          hint(`Xóa .compass/${taskId}/evidence/${FINDINGS_FILE} rồi đưa brief hiện có cho một agent khác soi.`),
        ].join('\n'),
      };
    }

    const { findings } = parsed;

    // CP-78: mỗi tiêu chí phải có kết luận, và kết luận phải khớp với finding.
    // Thiếu là lỗi định dạng như JSON hỏng: chưa phán được gì về code.
    const coverage = checkCoverage(parsed.coverage, findings, {
      conventionsDeclared: contextOf(current).conventionsDeclared,
    });
    if (coverage.errors.length) {
      ghiDo('coverage-invalid');
      return {
        exitCode: 2,
        output: [
          fail('review', coverage.errors),
          '',
          hint(`Sửa ${FINDINGS_FILE} theo mục "Tiêu chí soi" trong brief rồi chạy lại: compass review ${taskId}`),
        ].join('\n'),
      };
    }
    const unexamined = coverage.insufficient.length
      ? ['', `Chưa soi được ${coverage.insufficient.length} tiêu chí (insufficient, không chặn):`,
        ...coverage.insufficient.map(({ key, note }) => `  - ${key}: ${note}`)]
      : [];

    const blocking = findings.filter((f) => BLOCKING.includes(f.severity));

    writeGate(root, taskId, {
      gate: 'review',
      exitCode: blocking.length > 0 ? 1 : 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      briefHash: existsSync(briefFile) ? hashFile(briefFile) : null,
      findingsHash: hashFile(findingsFile),
      diffHash: sha256(current.diff),
      findingCount: findings.length,
      blockingCount: blocking.length,
      coverage: coverage.counts,
      outputFile: `evidence/${FINDINGS_FILE}`,
    });

    if (blocking.length > 0) {
      const others = findings.filter((f) => !BLOCKING.includes(f.severity));
      const lines = [
        `${blocking.length} finding chặn gate:`,
        ...blocking.map(formatFinding),
      ];
      if (others.length) {
        lines.push('', `Kèm ${others.length} finding không chặn:`, ...others.map(formatFinding));
      }
      lines.push(...unexamined);
      return {
        exitCode: 1,
        output: [
          fail('review', lines),
          '',
          hint(`Sửa xong thì xóa ${FINDINGS_FILE} và chạy lại review — soi lại từ đầu, không sửa findings cũ.`),
        ].join('\n'),
      };
    }

    const lines = [pass('review', findings.length === 0
      ? 'không có finding nào'
      : `${findings.length} finding, không cái nào chặn`)];
    if (findings.length) lines.push('', ...findings.map(formatFinding));
    lines.push(...unexamined);
    return { exitCode: 0, output: lines.join('\n') };
  }

  // Phase one: hand out the brief and stop. Every exit from here writes a
  // failing record. done reads gate.json, it does not rerun gates — leaving an
  // earlier pass in place would close a task whose review has just reopened.
  const recordPending = (extra = {}) => writeGate(root, taskId, {
    gate: 'review',
    exitCode: 1,
    checkedAt: new Date().toISOString(),
    specHash: hashFile(file),
    findingCount: null,
    blockingCount: null,
    ...extra,
  });

  const collected = collect();
  if (!collected.ok) {
    recordPending();
    return { exitCode: 2, output: fail('review', [collected.reason]) };
  }

  const diffHash = sha256(collected.diff);
  const hadBrief = existsSync(briefFile);

  const fresh = briefFor(collected);

  // Compare the brief itself, not just a diff hash: a rewritten spec changes
  // what a reviewer is asked to judge against, and a brief left over from the
  // old one sends them to read the wrong promise.
  const stale = hadBrief && readFileSync(briefFile, 'utf8') !== fresh;

  // Cùng luật với pha hai, đọc từ brief cũ trước khi nó bị ghi đè: spec và diff
  // trong đó còn y nguyên mà brief khác thì thứ đổi là ngữ cảnh repo (CP-38, CP-79).
  const onlyContext = stale && sameSubject(readFileSync(briefFile, 'utf8'), readFileSync(file, 'utf8'), collected.diff);
  const khaiPublicDoi = onlyContext && briefSecretsPublic(readFileSync(briefFile, 'utf8')) !== publicOf(collected);

  if (!hadBrief || stale) {
    mkdirSync(taskDir(root, taskId), { recursive: true });
    writeFileSync(briefFile, fresh);
  }

  // Every write carries the diffHash. writeGate replaces the whole record, so
  // dropping it on any path erases what an earlier run saved, and phase two is
  // then left with nothing to compare against.
  recordPending({ briefHash: hashFile(briefFile), diffHash });

  const headline = hadBrief && !stale
    ? ['Brief đã sinh nhưng chưa ai nộp findings.', `Brief: .compass/${taskId}/${BRIEF_FILE}`]
    : [
        khaiPublicDoi
          ? 'Danh sách secretsPublic trong config.json đã đổi — brief cũ nói về danh sách cũ.'
          : onlyContext
          ? 'Brief đã đổi dù spec và code của task không đổi: ngữ cảnh repo (convention, nơi gọi, tài liệu) hoặc mẫu brief của Compass đã khác.'
          : stale ? 'Code hoặc spec đã đổi — brief cũ nói về bản cũ.' : 'Chưa ai soi diff này.',
        `Brief: .compass/${taskId}/${BRIEF_FILE}  (${collected.files.length} file, ${diffHash.slice(7, 15)})`,
      ];

  return {
    exitCode: 1,
    output: [
      fail('review', headline),
      '',
      hint(`Đưa brief cho một agent KHÁC — nó không được biết gì về quá trình làm task này.`),
      hint(`Agent ghi kết quả vào .compass/${taskId}/evidence/${FINDINGS_FILE}, rồi chạy lại: compass review ${taskId}`),
    ].join('\n'),
  };
}
