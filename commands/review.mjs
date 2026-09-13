import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, taskDir, evidenceDir, validateTaskId } from '../lib/paths.mjs';
import { collectDiff, buildBrief } from '../lib/review-brief.mjs';
import { parseFindings, formatFinding, BLOCKING } from '../lib/findings.mjs';
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
const briefIdFor = (spec, diff) => sha256(`${sha256(spec)}\n${sha256(diff)}`).slice(7, 19);

function briefId(findingsSource) {
  try {
    return JSON.parse(findingsSource)?.brief ?? null;
  } catch {
    return null;
  }
}

export function reviewCommand({ cwd, taskId }) {
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
  const diffOptions = { baseRef, baseFrom: nguonGoc };

  // Phase two: an agent has answered, so read the verdict — but only if the
  // answer is about the code as it stands now. A finding set outlives the diff
  // it was written against: reviewer reports Major, author fixes, reruns, and
  // the stale pass would sail through. That is normal workflow, not cheating.
  if (existsSync(findingsFile)) {
    const current = collectDiff(root, diffOptions);
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

    const wanted = buildBrief({
      taskId,
      spec: readFileSync(file, 'utf8'),
      diff: current.diff,
      files: current.files,
      briefId: briefIdFor(readFileSync(file, 'utf8'), current.diff),
      base: current.base,
      baseFrom: nguonGoc,
    });
    const briefIsCurrent = readFileSync(briefFile, 'utf8') === wanted;
    const answersThisBrief = briefId(source) === briefIdFor(readFileSync(file, 'utf8'), current.diff);

    if (!briefIsCurrent) {
      writeFileSync(briefFile, buildBrief({
        taskId,
        spec: readFileSync(file, 'utf8'),
        diff: current.diff,
        files: current.files,
        briefId: briefIdFor(readFileSync(file, 'utf8'), current.diff),
        base: current.base,
        baseFrom: nguonGoc,
      }));
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
            'Code hoặc spec đã đổi sau khi soi — findings hiện có nói về bản cũ.',
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
      const wantedId = briefIdFor(readFileSync(file, 'utf8'), current.diff);
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

  const collected = collectDiff(root, diffOptions);
  if (!collected.ok) {
    recordPending();
    return { exitCode: 2, output: fail('review', [collected.reason]) };
  }

  const diffHash = sha256(collected.diff);
  const hadBrief = existsSync(briefFile);

  const fresh = buildBrief({
    taskId,
    spec: readFileSync(file, 'utf8'),
    diff: collected.diff,
    files: collected.files,
    briefId: briefIdFor(readFileSync(file, 'utf8'), collected.diff),
    base: collected.base,
    baseFrom: nguonGoc,
  });

  // Compare the brief itself, not just a diff hash: a rewritten spec changes
  // what a reviewer is asked to judge against, and a brief left over from the
  // old one sends them to read the wrong promise.
  const stale = hadBrief && readFileSync(briefFile, 'utf8') !== fresh;

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
        stale ? 'Code hoặc spec đã đổi — brief cũ nói về bản cũ.' : 'Chưa ai soi diff này.',
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
