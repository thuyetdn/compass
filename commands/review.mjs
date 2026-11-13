import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { findRoot, specPath, taskDir, evidenceDir, validateTaskId, configPath } from '../lib/paths.mjs';
import { buildBrief, buildVerifyBrief, openFindingsText, briefSubject, secretsPublicSection, briefSecretsPublic, linkedNote } from '../lib/review-brief.mjs';
import { parseSecretsPublic, secretsPublicFromText, normalisePath } from '../lib/secrets-scan.mjs';
import { parseFindings, formatFinding, checkCoverage, checkRubric, openFindings, chainOf, RUNGS_NEEDING_TEST } from '../lib/findings.mjs';
import { unitsOf, snapshot, snapshotAlive, fixDiff, parseHunks } from '../lib/review-rounds.mjs';
import { readLedger, writeLedger, specKeyOf } from '../lib/review-ledger.mjs';
import { collectContext } from '../lib/review-context.mjs';
import { taskDiffSetup } from '../lib/task-diff.mjs';
import { preflightProblems, environmentSection, migrationGlobs } from '../lib/preflight.mjs';
import { ENV_SECTION } from '../lib/spec-validator.mjs';
import { notSkipped } from '../lib/workspace-git.mjs';
import { writeGate, readGate, verifyAllGates } from '../lib/gate-store.mjs';
import { hashSource } from '../lib/source-hash.mjs';
import { passingTitles } from '../lib/test-parser.mjs';
import { loadConfig } from '../lib/config.mjs';
import { parseSpec, specForReview } from '../lib/spec-parser.mjs';
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
//
// `normalise` đưa spec của brief cũ về cùng dạng với `spec` (CP-106): brief của bản
// Compass trước chép spec nguyên văn, kể cả dòng trống và dòng quyết định ở phần đầu.
export function sameSubject(oldBrief, spec, diff, normalise = (s) => s) {
  const old = briefSubject(oldBrief);
  return old !== null && normalise(old.spec) === spec && old.diff === diff;
}

// Brief cũ nói về một danh sách secretsPublic khác mục `nay` không. Một chỗ cho cả hai
// pha (CP-95). Brief cũ không đọc ra được mục đó (sửa tay, mẫu khác) thì không đủ căn
// cứ để bảo danh sách đã đổi: người gọi rơi về câu "ngữ cảnh repo".
function khaiPublicDoiTrong(briefCu, nay) {
  const cu = briefSecretsPublic(briefCu);
  return cu !== null && cu !== nay;
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

// Tên test pass trong log gate `test` của task (CP-107), chỉ qua bản ghi đã ký: bản ghi xanh,
// đúng task và đúng khe, nói về code hiện tại, và log còn khớp `outputHash`.
function testTitlesOf(root, taskId) {
  const log = path.join('.compass', taskId, 'evidence', 'test.log');
  const run = `Chạy: compass check ${taskId} rồi chạy lại review.`;
  const integrity = verifyAllGates(root, taskId);
  const untrusted = [...integrity.tampered, ...(integrity.misslotted ?? []), ...(integrity.wrongTask ?? []), ...(integrity.outdated ?? [])];
  const record = untrusted.includes('test') ? null : readGate(root, taskId, 'test');
  if (!record) return { ok: false, reason: `gate test chưa có bản ghi tin được. ${run}` };
  if (record.exitCode !== 0) return { ok: false, reason: `gate test chưa xanh. ${run}` };
  if (record.sourceHash !== hashSource(root)) return { ok: false, reason: `code đã đổi sau khi gate test chạy. ${run}` };
  if (!record.outputHash) return { ok: false, reason: `gate test không chạy lệnh test nào, nên không có log. ${run}` };
  let text;
  try {
    text = readFileSync(path.join(root, log), 'utf8');
  } catch {
    return { ok: false, reason: `không đọc được ${log}. ${run}` };
  }
  if (sha256(text) !== record.outputHash) return { ok: false, reason: `${log} không còn khớp bản ghi đã ký của gate test. ${run}` };
  return { ok: true, titles: passingTitles(text), log };
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
  const spec = parseSpec(readFileSync(file, 'utf8'));
  // Preflight khai mà chưa xanh trên code và config hiện tại thì không sinh brief (CP-108):
  // agent không đọc code mà lint, typecheck hay kiểm tra migration đã bắt được lỗi. Bản ghi
  // đỏ giữ diffHash và briefHash của bản ghi cũ, để lần chạy sau khi preflight xanh vẫn
  // đối chiếu được findings đang có.
  const preflight = preflightProblems(root, taskId, spec);
  if (preflight.length) {
    const prev = readGate(root, taskId, 'review');
    writeGate(root, taskId, {
      gate: 'review',
      exitCode: 1,
      reason: 'preflight-not-green',
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      briefHash: prev?.briefHash ?? null,
      diffHash: prev?.diffHash ?? null,
      findingCount: null,
      blockingCount: null,
    });
    return {
      exitCode: 1,
      output: [
        fail('review', ['Preflight chưa xanh trên code hiện tại, nên Compass không sinh brief:', ...preflight.map((p) => `  ${p}`)]),
        '',
        hint(`Chạy: compass check ${taskId}`),
      ].join('\n'),
    };
  }

  // Gốc soi, Soi đến, Phạm vi và repo con: một chỗ chung với gate `preflight` (CP-108).
  const setup = taskDiffSetup(root, spec, cfg);
  if (!setup.ok && setup.kind === 'scope') {
    return {
      exitCode: 2,
      output: [
        fail('review', [
          'Phạm vi trong spec có mục không dùng được làm pathspec:',
          ...setup.rejected.map((r) => `  "${r.entry}" — ${r.reason}`),
        ]),
        '',
        hint('Phạm vi chỉ nhận đường dẫn tương đối trong repo, phân cách bằng dấu phẩy.'),
      ].join('\n'),
    };
  }
  if (!setup.ok) {
    return {
      exitCode: 2,
      output: [fail('review', setup.errors), '', hint('Sửa lời khai trong spec hay config.json rồi chạy lại.')].join('\n'),
    };
  }
  const { nguonGoc, plan } = setup;
  notes.push(...(plan.notes ?? []));
  // File chưa theo dõi bỏ vì nằm sau symlink hay junction thì nói ra (issue #5). Mỗi lượt
  // chạy gọi `collect` đúng một lần, ở pha một hay pha hai, nên dòng này không lặp.
  const collect = () => {
    const collected = setup.collect();
    const note = linkedNote(collected.linked);
    if (note) notes.push(note);
    return collected;
  };

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
  // Spec trong brief và trong id brief, không gồm quyết định của người sau vòng soi (CP-106).
  const specForBrief = () => specForReview(readFileSync(file, 'utf8'));
  // Sự thật môi trường của spec và migration trong diff, đặt ngay trên diff (CP-108). Vào
  // id brief như ngữ cảnh; không có gì thì rỗng, id và brief như trước.
  const globs = migrationGlobs(root, spec);
  const envText = spec.sections.get(ENV_SECTION) ?? null;
  const envOf = (collected) => environmentSection({ envText, collected, globs });
  const idOf = (collected) => briefIdFor(specForBrief(),collected.diff, contextOf(collected).text + publicOf(collected) + envOf(collected));

  // Vòng soi (CP-106). Sổ cái nói các vòng đã chấm; spec đổi phần yêu cầu, sổ sai chữ ký
  // hay ảnh chụp đã bị git dọn thì làm lại từ vòng 1.
  if (spec.maxRounds && !spec.maxRounds.ok) {
    return {
      exitCode: 2,
      output: [
        fail('review', [`Dòng \`Vòng soi tối đa:\` ở dòng ${spec.maxRounds.line} của spec ${spec.maxRounds.reason}.`]),
        '',
        hint('Viết dạng: `Vòng soi tối đa: 4 — <lý do>`, ở phần đầu spec.'),
      ].join('\n'),
    };
  }
  const specKey = specKeyOf(readFileSync(file, 'utf8'));
  const ledger = readLedger(root, taskId, specKey);
  if (ledger.note) notes.push(ledger.note);
  let rounds = ledger.rounds;

  // Brief mà vòng hiện tại phải có. Code không đổi so với vòng đã chấm cuối thì vòng đó
  // là vòng hiện tại (chấm lại được, như hôm nay); đổi thì sang vòng mới, chỉ kiểm tra bản sửa.
  const targets = new WeakMap();
  const targetOf = (collected) => {
    if (!targets.has(collected)) targets.set(collected, computeTarget(collected));
    return targets.get(collected);
  };
  const fullTarget = (collected, snap = null) => ({
    ok: true, round: 1, kind: 'full', priors: [], prev: null, newRound: false, snap,
    brief: briefFor(collected), id: idOf(collected), diffShown: collected.diff, hunks: null,
  });
  const verifyTarget = (collected, { round, prev, priors, diff, files, snap, newRound }) => {
    const open = openFindings(priors);
    const all = new Map(priors.flatMap((r) => r.findings).map((f) => [f.id, f]));
    const chains = new Map(open.map((f) => [f.id, chainOf(all, f.id)]));
    // Mắt chuỗi đã đóng mà quay lại danh sách chờ: brief nói nó đóng ở vòng nào, bằng rung gì (CP-107).
    const closedAt = new Map();
    for (const r of priors) for (const c of r.closures ?? []) closedAt.set(c.id, { ...c, round: r.round });
    const relisted = new Map(open.filter((f) => closedAt.get(f.id)?.status === 'closed').map((f) => [f.id, closedAt.get(f.id)]));
    const usedIds = [...all.keys()];
    const ctx = contextOf(collected).text;
    const id = briefIdFor(specForBrief(), diff, `${ctx}${publicOf(collected)}${envOf(collected)}\nverify:${round}\n${openFindingsText(open, chains, relisted)}\n${usedIds.join(',')}`);
    return {
      ok: true, round, kind: 'verify', priors, prev, newRound, snap, id, diffShown: diff, hunks: parseHunks(diff),
      brief: buildVerifyBrief({
        taskId, round, spec: specForBrief(), diff, files, briefId: id, open, chains, relisted, usedIds,
        context: ctx, secretsPublic: publicOf(collected), environment: envOf(collected),
      }),
    };
  };
  const computeTarget = (collected) => {
    if (!rounds.length) return fullTarget(collected);
    const units = unitsOf(root, plan, collected);
    const last = rounds.at(-1);
    const prevOfLast = rounds.at(-2) ?? null;
    if (!snapshotAlive(units, last.snapshot) || (prevOfLast && !snapshotAlive(units, prevOfLast.snapshot))) {
      notes.push(`Ảnh chụp code của vòng ${last.round} không còn trong git (git gc đã dọn) — soi lại từ vòng 1.`);
      rounds = [];
      return fullTarget(collected);
    }
    const union = (a) => [...new Set([...(a ?? []), ...collected.files])];
    const snap = snapshot(units, union(last.files));
    if (!snap.ok) return { ok: false, exitCode: 2, reason: snap.reason };
    // Sổ ghi đúng danh sách ảnh chụp đã băm. Ghi danh sách hẹp hơn thì lần sau một file
    // bản sửa đã gỡ lấy lại bản trong index, và vòng đã xanh tự mở lại.
    snap.files = union(last.files);
    const delta = fixDiff(units, last.snapshot, snap.trees, union(last.files));
    if (!delta.ok) return { ok: false, exitCode: 2, reason: delta.reason };
    if (delta.diff === '') {
      // Code y như lúc vòng cuối được chấm: vòng đó vẫn là vòng hiện tại.
      if (!prevOfLast) return fullTarget(collected, snap);
      const again = fixDiff(units, prevOfLast.snapshot, snap.trees, union(prevOfLast.files));
      if (!again.ok) return { ok: false, exitCode: 2, reason: again.reason };
      return verifyTarget(collected, {
        round: last.round, prev: prevOfLast, priors: rounds.slice(0, -1), diff: again.diff, files: again.files, snap, newRound: false,
      });
    }
    const round = last.round + 1;
    const allowed = round <= 3 || (spec.maxRounds?.ok && spec.maxRounds.value >= round);
    if (!allowed) {
      return {
        ok: false,
        exitCode: 1,
        reason: [
          `Code đã đổi sau vòng ${last.round}. Vòng ${round} cần quyết định của người duyệt, nên Compass không sinh brief.`,
          `Người duyệt đồng ý soi thêm thì thêm vào phần đầu spec: \`Vòng soi tối đa: ${round} — <lý do>\`.`,
        ].join('\n'),
      };
    }
    return verifyTarget(collected, { round, prev: last, priors: rounds, diff: delta.diff, files: delta.files, snap, newRound: true });
  };

  // Ba chỗ dựng brief, một hình dạng. Lệch một trường là brief "hiện tại" ở pha
  // hai không khớp brief pha một đã ghi, và gate mở lại vô cớ.
  const briefFor = (collected) => buildBrief({
    taskId,
    spec: specForBrief(),
    diff: collected.diff,
    files: collected.files,
    briefId: idOf(collected),
    context: contextOf(collected).text,
    environment: envOf(collected),
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
    rubric: true,
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

    const target = targetOf(current);
    if (!target.ok) {
      ghiDo('round-blocked');
      return { exitCode: target.exitCode, output: fail('review', target.reason.split('\n')) };
    }
    const wanted = target.brief;
    const briefIsCurrent = readFileSync(briefFile, 'utf8') === wanted;
    const answersThisBrief = briefId(source) === target.id;

    // Findings của vòng trước, code đã sửa sau đó: vòng mới chỉ kiểm tra bản sửa (CP-106).
    // Không bảo xóa findings.json — người soi vòng mới ghi đè nó, và bản cũ đã nằm trong sổ cái.
    // Cả lần chạy sau đó, khi brief vòng mới đã nằm sẵn mà người soi chưa nộp: vẫn là đang chờ.
    if (target.newRound && target.priors.some((r) => r.brief === briefId(source))) {
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
            `Code đã đổi sau vòng ${target.prev.round} — vòng ${target.round} chỉ kiểm tra bản sửa và đang chờ findings.`,
            `Đã sinh brief vòng ${target.round}: .compass/${taskId}/${BRIEF_FILE}`,
            // Người soi vòng mới quên đổi trường brief thì đọc được ngay ở đây (CP-106).
            `findings.json hiện có trả lời brief ${briefId(source)} của vòng trước; brief vòng ${target.round} là ${target.id}.`,
          ]),
          '',
          hint('Đưa brief cho một agent KHÁC. Nó ghi đè findings.json; findings vòng trước đã nằm trong sổ cái.'),
        ].join('\n'),
      };
    }

    if (!briefIsCurrent) {
      // Brief cũ ghi nguyên spec và diff nó được viết cho. Cả hai còn y nguyên mà
      // brief vẫn khác thì thứ đổi là ngữ cảnh repo — convention, nơi gọi, tài liệu
      // — chứ không phải việc của task. Nói "code đã đổi" lúc đó là bảo người đọc đi
      // tìm một thay đổi không có (CP-38). Đọc từ brief chứ không từ sổ: nhánh
      // findings-hỏng ghi đè sổ, và lần chạy sau báo nhầm (CP-79).
      const briefCu = readFileSync(briefFile, 'utf8');
      const onlyContext = sameSubject(briefCu, specForBrief(), target.diffShown, specForReview);
      const khaiPublicDoi = onlyContext && khaiPublicDoiTrong(briefCu, publicOf(current));
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
      const wantedId = target.id;
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

    // CP-106: quyết định từng finding theo rubric, nguồn gốc finding mới, closure finding cũ.
    const rubric = checkRubric(parsed, {
      kind: target.kind,
      priors: target.priors,
      acceptances: spec.acceptances ?? {},
      hunks: target.hunks,
      testTitles: (() => { let got; return () => (got ??= testTitlesOf(root, taskId)); })(),
    });
    if (rubric.errors.length) {
      ghiDo('rubric-invalid');
      return {
        exitCode: 2,
        output: [
          fail('review', rubric.errors),
          '',
          hint(`Sửa ${FINDINGS_FILE} theo mục "Mức và quyết định" trong brief rồi chạy lại: compass review ${taskId}`),
        ].join('\n'),
      };
    }

    // Ghi vòng này vào sổ cái, thay bản cũ của chính vòng này nếu có: chấm lại cùng findings
    // ra cùng một sổ. Ảnh chụp là trạng thái code mà brief này nói về.
    const units = unitsOf(root, plan, current);
    const snap = target.snap ?? snapshot(units, current.files);
    if (!snap.ok) {
      ghiDo('snapshot-failed');
      return { exitCode: 2, output: fail('review', [snap.reason]) };
    }
    const blockingCount = rubric.blockingCount;
    writeLedger(root, taskId, specKey, [...target.priors, {
      round: target.round,
      kind: target.kind,
      brief: target.id,
      recordedAt: new Date().toISOString(),
      verdict: blockingCount > 0 ? 'fail' : 'pass',
      heads: snap.heads,
      snapshot: snap.trees,
      files: snap.files ?? current.files,
      findings: rubric.record,
      closures: rubric.closures,
    }]);

    writeGate(root, taskId, {
      gate: 'review',
      exitCode: blockingCount > 0 ? 1 : 0,
      checkedAt: new Date().toISOString(),
      specHash: hashFile(file),
      briefHash: existsSync(briefFile) ? hashFile(briefFile) : null,
      findingsHash: hashFile(findingsFile),
      diffHash: sha256(current.diff),
      findingCount: findings.length,
      blockingCount,
      coverage: coverage.counts,
      round: target.round,
      outputFile: `evidence/${FINDINGS_FILE}`,
    });

    const show = (f) => `${f.id ? `${f.id} ` : ''}${formatFinding(f)}`;
    const chainText = (chain) => chain.join(' → ');
    const notesAfter = [];
    if (rubric.missed.length) {
      notesAfter.push('', `Lỗi phương pháp — vòng trước bỏ sót ${rubric.missed.length} finding:`,
        ...rubric.missed.map((f) => `  ${f.id}: lens "${f.lens}" lẽ ra phải bắt — ${f.title}`));
    }
    if (rubric.keptAccepted.length) {
      notesAfter.push('', `Người duyệt đã chấp nhận giữ ${rubric.keptAccepted.length} finding:`,
        ...rubric.keptAccepted.map((f) => `  ${f.id} [${f.severity}] ${f.title} — ${spec.acceptances[rubric.acceptKey(f.id)]}`));
    }
    const keptMinor = rubric.record.filter((f) => f.severity === 'Minor' && f.disposition?.action === 'kept');
    if (keptMinor.length) notesAfter.push('', `${keptMinor.length} Minor giữ lại (kept), lý do ghi trong sổ cái.`);
    const noTest = rubric.closures.filter((c) => c.status === 'closed' && RUNGS_NEEDING_TEST.includes(c.rung) && c.redTest === null);
    if (noTest.length) notesAfter.push('', `${noTest.length} bản sửa không có test đỏ trước (redTest: null), lý do ghi trong sổ cái.`);
    notesAfter.push(...unexamined);

    const roundLabel = target.kind === 'full' ? `Vòng ${target.round} (soi toàn bộ).` : `Vòng ${target.round} (chỉ kiểm tra bản sửa).`;
    if (blockingCount > 0) {
      const lines = [roundLabel, `${blockingCount} finding chặn gate:`];
      if (rubric.toFix.length) lines.push('', `Cần sửa (${rubric.toFix.length}):`, ...rubric.toFix.map(show));
      for (const chain of rubric.longChains) {
        const id = chain.at(-1);
        lines.push('', `Chuỗi ${chainText(chain)} đã sửa tới lần thứ ${chain.length}. Bản sửa của ${id} phải gỡ cơ chế (closure rung "revert" ở vòng sau), hoặc người duyệt ghi vào phần đầu spec: \`Chấp nhận ${rubric.acceptKey(id)}: <lý do>\`.`);
      }
      if (rubric.keptBlocking.length) {
        lines.push('', 'Giữ lại (kept) mà spec chưa có dòng chấp nhận của người duyệt:', ...rubric.keptBlocking.map(show));
        lines.push(...rubric.keptBlocking.map((f) => `  Người duyệt đồng ý giữ thì thêm vào phần đầu spec, trên heading ## đầu tiên: \`Chấp nhận ${rubric.acceptKey(f.id)}: <lý do>\``));
      }
      if (rubric.stillOpen.length) lines.push('', 'Vẫn còn mở sau bản sửa:', ...rubric.stillOpen.map(show));
      for (const { closure, chain } of rubric.badClosures) {
        lines.push('', `${closure.id} là mắt thứ ${chain.length} của chuỗi ${chainText(chain)} mà đóng bằng rung "${closure.rung}". Phải gỡ cơ chế (revert), hoặc người duyệt ghi \`Chấp nhận ${rubric.acceptKey(closure.id)}: <lý do>\` vào phần đầu spec.`);
      }
      lines.push(...notesAfter);
      return {
        exitCode: 1,
        output: [
          fail('review', lines),
          '',
          hint(`Sửa xong chạy lại: compass review ${taskId}. Vòng sau chỉ kiểm tra bản sửa; đừng xóa ${FINDINGS_FILE} và đừng sửa findings cũ.`),
        ].join('\n'),
      };
    }

    const lines = [pass('review', findings.length === 0
      ? 'không có finding nào'
      : `${findings.length} finding, không cái nào chặn`), roundLabel];
    if (findings.length) lines.push('', ...findings.map((f, i) => show({ ...f, id: rubric.record[i].id })));
    lines.push(...notesAfter);
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

  const target = targetOf(collected);
  if (!target.ok) {
    recordPending({ diffHash });
    return { exitCode: target.exitCode, output: fail('review', target.reason.split('\n')) };
  }
  const fresh = target.brief;

  // Compare the brief itself, not just a diff hash: a rewritten spec changes
  // what a reviewer is asked to judge against, and a brief left over from the
  // old one sends them to read the wrong promise.
  const stale = hadBrief && readFileSync(briefFile, 'utf8') !== fresh;

  // Cùng luật với pha hai, đọc từ brief cũ trước khi nó bị ghi đè: spec và diff
  // trong đó còn y nguyên mà brief khác thì thứ đổi là ngữ cảnh repo (CP-38, CP-79).
  const onlyContext = stale && sameSubject(readFileSync(briefFile, 'utf8'), specForBrief(), target.diffShown, specForReview);
  const khaiPublicDoi = onlyContext && khaiPublicDoiTrong(readFileSync(briefFile, 'utf8'), publicOf(collected));

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
          : target.newRound ? `Code đã đổi sau vòng ${target.prev.round} — vòng ${target.round} chỉ kiểm tra bản sửa.`
          : stale ? 'Code hoặc spec đã đổi — brief cũ nói về bản cũ.' : 'Chưa ai soi diff này.',
        target.kind === 'verify'
          ? `Brief vòng ${target.round}: .compass/${taskId}/${BRIEF_FILE}  (bản sửa, ${target.hunks.size} file)`
          : `Brief: .compass/${taskId}/${BRIEF_FILE}  (${collected.files.length} file, ${diffHash.slice(7, 15)})`,
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
