import { inHunk } from './review-rounds.mjs';
import { sha256 } from './hash.mjs';

// Findings come back from an agent that never saw the work being done. The
// format is rigid on purpose: a free-text review is one an author can argue
// with, and Compass has to be able to count what blocks the gate.

export const SEVERITIES = ['Critical', 'Major', 'Minor', 'Info'];
export const BLOCKING = ['Critical', 'Major'];

// Mười việc người soi phải xét (CP-78). Brief in ra danh sách này, và
// `findings.json` phải có kết luận cho từng khóa: một bản soi bỏ qua bảo mật thì
// không còn trông giống một bản soi sạch.
export const CRITERIA = [
  { key: 'spec', question: 'Code có làm đúng từng case trong spec, và không làm gì ngoài phạm vi?' },
  { key: 'convention', question: 'Code có theo convention của repo?' },
  { key: 'impact', question: 'Code vừa đổi đang được những chỗ nào dùng, và những chỗ đó còn chạy đúng không?' },
  { key: 'tests', question: 'Test của từng case có kiểm tra kết quả thật, hay chỉ kiểm tra code chạy được?' },
  { key: 'regression', question: 'Mỗi rủi ro trong mục "Rủi ro hồi quy" của spec đã có test chặn chưa?' },
  { key: 'performance', question: 'Có gọi IO hay truy vấn trong vòng lặp, có đọc cả file lớn vào bộ nhớ không?' },
  { key: 'security', question: 'Input từ ngoài có được escape, có đường dẫn thoát khỏi repo, có lộ secret không?' },
  { key: 'errors', question: 'Input rỗng, file hỏng, đường dẫn Windows, lỗi giữa chừng đã được xử lý chưa?' },
  { key: 'reuse', question: 'Repo đã có helper làm đúng việc này chưa?' },
  { key: 'docs', question: 'README, hướng dẫn và skill còn mô tả đúng hành vi vừa đổi không?' },
];

export const VERDICTS = ['clean', 'findings', 'insufficient'];

// Brief luôn mang đủ spec và diff, nên hai tiêu chí này không có lý do để thiếu dữ liệu.
export const NEVER_INSUFFICIENT = ['spec', 'tests'];

export const BASES = ['declared', 'inferred'];

const REQUIRED = ['severity', 'title', 'detail'];

export function parseFindings(source) {
  let raw;
  try {
    raw = JSON.parse(source);
  } catch (err) {
    return { findings: null, errors: [`findings.json không phải JSON hợp lệ: ${err.message}`] };
  }

  // A bare array cannot carry the brief id, and findings that name no brief
  // answer no particular review. Say that here rather than letting the caller
  // report a missing id as "the code changed".
  if (Array.isArray(raw)) {
    return {
      findings: null,
      errors: ['findings.json phải là object có "brief" và "findings" — mảng trần không mang được id của brief'],
    };
  }

  const list = raw?.findings;
  if (!Array.isArray(list)) {
    return {
      findings: null,
      errors: ['findings.json phải có trường "findings" là mảng'],
    };
  }

  const errors = [];
  const findings = [];

  list.forEach((item, index) => {
    const label = `finding thứ ${index + 1}`;

    if (typeof item !== 'object' || item === null) {
      errors.push(`${label} không phải object`);
      return;
    }
    for (const field of REQUIRED) {
      if (typeof item[field] !== 'string' || item[field].trim() === '') {
        errors.push(`${label} thiếu trường "${field}"`);
      }
    }
    if (item.severity !== undefined && !SEVERITIES.includes(item.severity)) {
      errors.push(`${label} có severity "${item.severity}" không hợp lệ. Phải là: ${SEVERITIES.join(', ')}`);
    }
    if (errors.length) return;

    findings.push({
      severity: item.severity,
      title: item.title,
      detail: item.detail,
      file: typeof item.file === 'string' ? item.file : null,
      line: Number.isInteger(item.line) ? item.line : null,
      criterion: typeof item.criterion === 'string' ? item.criterion : null,
      basis: typeof item.basis === 'string' ? item.basis : null,
    });
  });

  if (errors.length) return { findings: null, errors };

  return {
    findings,
    errors: [],
    blocking: findings.filter((f) => BLOCKING.includes(f.severity)),
    coverage: raw.coverage === undefined ? undefined : raw.coverage,
    // Bản gốc cho luật vòng soi (CP-106): `id`, `disposition`, `closures`… `compass pr`
    // không dùng tới, nên `findings` giữ đúng hình dạng cũ.
    raw,
  };
}

// CP-106: quyết định cho từng finding, nguồn gốc của finding mới, và closure của finding cũ.
export const ACTIONS = ['fix', 'kept'];
export const VERIFY_ORIGINS = ['fix-induced', 'missed', 'env-fact', 'requirement-change'];
export const RUNGS = ['revert', 'narrow', 'reuse', 'mechanism'];
export const CHAIN_LIMIT = 3;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const NEEDS_DISPOSITION = ['Critical', 'Major', 'Minor'];

const text = (v) => typeof v === 'string' && v.trim() !== '';

// Sáu ký tự hex băm mức, tiêu chí, tiêu đề và file của một finding. Gate in nó trong dòng
// `Chấp nhận <id>#<vân tay>:` để người duyệt chấp nhận đúng finding họ đã đọc.
export function findingFingerprint(f) {
  return sha256(`${f.severity}\n${f.criterion ?? ''}\n${f.title}\n${f.file ?? ''}`).slice(7, 13);
}

// Closure mới nhất của mỗi id: một finding đóng lại lần nữa (gỡ cơ chế sau một lần đóng
// bằng `narrow`) thì lần sau thắng.
export function latestClosures(closures) {
  const latest = new Map();
  for (const c of closures) latest.set(c.id, c);
  return latest;
}

// Finding của các vòng trước mà vòng này phải ghi closure:
//   - finding `fix` chưa đóng;
//   - mắt thứ `CHAIN_LIMIT` trở đi của một chuỗi, đóng không bằng `revert` (còn cách gỡ cơ chế).
// Critical/Major `kept` không vào đây: lối ra duy nhất của nó là dòng `Chấp nhận` của người.
// Cho đóng nó bằng closure từng mở đường để mắt thứ ba ghi `kept` thoát luật gỡ cơ chế.
// Không xét dòng `Chấp nhận`: danh sách nằm trong brief và trong id brief, nên thêm một dòng
// chấp nhận không được làm brief đổi. Mục đã được chấp nhận vẫn hiện; gate không chặn nó.
export function openFindings(priors) {
  const all = priors.flatMap((r) => r.findings);
  const byId = new Map(all.map((f) => [f.id, f]));
  const latest = latestClosures(priors.flatMap((r) => r.closures ?? []));
  return all.filter((f) => {
    if (f.disposition?.action !== 'fix') return false;
    const c = latest.get(f.id);
    return c?.status !== 'closed' || (c.rung !== 'revert' && chainOf(byId, f.id).length >= CHAIN_LIMIT);
  });
}

// Chuỗi `causedBy` dẫn tới `id`, gốc trước. Vòng lặp (người soi ghi nhầm) dừng ở chỗ lặp.
export function chainOf(byId, id) {
  const chain = [];
  const seen = new Set();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur.id);
    cur = cur.causedBy ? byId.get(cur.causedBy) : null;
  }
  return chain;
}

// Luật vòng soi trên findings đã qua `parseFindings`.
//   kind: 'full' (vòng 1) hay 'verify' (từ vòng 2)
//   priors: các vòng đã chấm trước vòng này, theo sổ cái
//   acceptances: dòng `Chấp nhận <id>:` trong spec
//   hunks: hunk của bản sửa (`parseHunks`), chỉ cho vòng verify
// Trả `errors` (định dạng sai, exit 2) và các danh sách làm gate đỏ (exit 1).
// `testTitles()` (CP-107): tên test trên dòng pass của log gate `test`, đọc khi một closure
// nêu `redTest`. Trả { ok, titles, log } hay { ok: false, reason }.
export function checkRubric(parsed, { kind, priors = [], acceptances = {}, hunks = null, testTitles = null }) {
  const errors = [];
  const raw = parsed.raw ?? {};
  const items = Array.isArray(raw.findings) ? raw.findings : [];
  const priorFindings = priors.flatMap((r) => r.findings);
  const priorIds = new Set(priorFindings.map((f) => f.id));
  const fixedBefore = new Set(priorFindings.filter((f) => f.disposition?.action === 'fix').map((f) => f.id));
  const open = openFindings(priors);
  const seen = new Set();
  const record = [];

  items.forEach((item, index) => {
    const f = parsed.findings[index];
    const id = item.id;
    const label = typeof id === 'string' && id ? `finding ${id}` : `finding thứ ${index + 1}`;
    if (!text(id)) {
      errors.push(`${label} thiếu "id" — mỗi finding cần một id để vòng sau đóng được nó`);
    } else if (!ID_RE.test(id)) {
      errors.push(`${label}: id "${id}" không hợp lệ — chỉ chữ, số, ".", "_", "-", tối đa 32 ký tự, mở đầu bằng chữ hay số`);
    } else if (seen.has(id)) {
      errors.push(`${label}: id "${id}" trùng với một finding khác trong file`);
    } else if (priorIds.has(id)) {
      errors.push(`${label}: id "${id}" đã dùng ở vòng trước — finding mới cần id mới`);
    }
    if (text(id)) seen.add(id);

    const d = item.disposition;
    let disposition = null;
    if (d === undefined || d === null) {
      if (NEEDS_DISPOSITION.includes(f.severity)) {
        errors.push(`${label} [${f.severity}] thiếu "disposition" — ${f.severity} cần quyết định fix hay kept theo rubric`);
      }
    } else if (typeof d !== 'object' || Array.isArray(d)) {
      errors.push(`${label}: "disposition" phải là object { "action", "reason" }`);
    } else if (!ACTIONS.includes(d.action)) {
      errors.push(`${label}: disposition.action ${JSON.stringify(d.action)} không hợp lệ. Phải là: ${ACTIONS.join(', ')}`);
    } else if (!text(d.reason) && (d.action === 'kept' || f.severity === 'Minor')) {
      errors.push(d.action === 'kept'
        ? `${label}: kept thì phải có disposition.reason nói vì sao giữ`
        : `${label}: Minor fix thì phải có disposition.reason nói điều kiện nào của rubric`);
    } else {
      disposition = text(d.reason) ? { action: d.action, reason: d.reason.trim() } : { action: d.action };
    }

    let origin = item.origin ?? null;
    if (kind === 'full') {
      if (origin !== null && origin !== 'original') {
        errors.push(`${label}: vòng 1 soi toàn bộ, origin chỉ có thể là "original" (hay bỏ trống)`);
      }
      origin = 'original';
      if (item.causedBy !== undefined) errors.push(`${label}: vòng 1 không có "causedBy" — chưa có bản sửa nào`);
    } else if (origin === 'original') {
      errors.push(`${label}: vòng verify không có finding "original". Lỗi ở code vòng trước đã soi mà bị bỏ sót là "missed"`);
    } else if (!VERIFY_ORIGINS.includes(origin)) {
      errors.push(`${label}: origin ${JSON.stringify(origin)} không hợp lệ. Phải là: ${VERIFY_ORIGINS.join(', ')}`);
    } else if (origin === 'fix-induced') {
      if (!text(item.causedBy)) {
        errors.push(`${label}: fix-induced thì phải có "causedBy" — id của finding mà bản sửa của nó sinh ra lỗi này`);
      } else if (!fixedBefore.has(item.causedBy)) {
        errors.push(`${label}: causedBy "${item.causedBy}" không phải finding fix của vòng trước`);
      } else if (!f.file || !inHunks(hunks, f.file, f.line)) {
        errors.push(`${label}: khai fix-induced nhưng ${f.file ? `${f.file}:${f.line ?? '?'}` : 'không nêu file và dòng'} không nằm trong bản sửa — không hunk nào của diff sửa chứa dòng đó`);
      }
    } else if (origin === 'missed' && !text(item.lens)) {
      errors.push(`${label}: missed thì phải có "lens" — góc soi lẽ ra phải bắt lỗi này ở vòng trước`);
    }

    record.push({
      id,
      severity: f.severity,
      criterion: f.criterion,
      title: f.title,
      detail: f.detail,
      file: f.file,
      line: f.line,
      origin,
      causedBy: origin === 'fix-induced' ? item.causedBy : null,
      lens: text(item.lens) ? item.lens.trim() : null,
      disposition,
    });
  });

  // Closure: mỗi finding fix còn mở của vòng trước đúng một cái.
  const closures = [];
  const rawClosures = raw.closures;
  if (kind === 'full') {
    if (rawClosures !== undefined && !(Array.isArray(rawClosures) && rawClosures.length === 0)) {
      errors.push('vòng 1 không có "closures" — chưa có finding cũ nào để đóng');
    }
  } else if (!Array.isArray(rawClosures)) {
    errors.push(`vòng verify phải có "closures": mỗi finding đang chờ sửa (${open.map((f) => f.id).join(', ') || 'không có'}) một closure`);
  } else {
    const openIds = new Set(open.map((f) => f.id));
    const got = new Set();
    rawClosures.forEach((c, index) => {
      const label = `closure thứ ${index + 1}`;
      if (typeof c !== 'object' || c === null) { errors.push(`${label} không phải object`); return; }
      if (!openIds.has(c.id)) {
        errors.push(`${label}: id ${JSON.stringify(c.id)} không phải finding đang chờ sửa`);
        return;
      }
      if (got.has(c.id)) { errors.push(`${label}: finding ${c.id} có hai closure`); return; }
      got.add(c.id);
      if (c.status !== 'closed' && c.status !== 'open') {
        errors.push(`closure ${c.id}: status ${JSON.stringify(c.status)} không hợp lệ. Phải là: closed, open`);
        return;
      }
      if (c.status === 'closed' && !RUNGS.includes(c.rung)) {
        errors.push(`closure ${c.id}: closed thì phải có "rung" là một trong ${RUNGS.join(', ')}`);
        return;
      }
      const fields = c.status === 'closed' ? closureTest(c, errors, testTitles) : { redTest: null, rerunBy: null };
      if (!fields) return;
      closures.push({ id: c.id, status: c.status, rung: c.status === 'closed' ? c.rung : null, note: text(c.note) ? c.note.trim() : null, ...fields });
    });
    for (const f of open) {
      if (!got.has(f.id)) errors.push(`finding ${f.id} đang chờ sửa mà không có closure — ghi closed (kèm rung) hay open`);
    }
  }

  if (errors.length) return { errors };

  const byId = new Map([...priorFindings, ...record].map((f) => [f.id, f]));
  // Dòng chấp nhận khóa theo id kèm dấu vân tay của finding (`F1#3fa2c1`): một finding khác
  // mang lại id đó — vòng 1 soi lại, sổ làm lại — không được ké quyết định của người duyệt.
  const acceptKey = (id) => (byId.has(id) ? `${id}#${findingFingerprint(byId.get(id))}` : id);
  const accepted = (id) => text(acceptances[acceptKey(id)]);
  const toFix = record.filter((f) => f.disposition?.action === 'fix');
  // Quyết định chỉ người gỡ được thì chặn ở mọi vòng sau, không chỉ vòng nó xuất hiện: một
  // Major giữ lại, hay mắt thứ ba đóng không bằng revert, không được hết chặn chỉ vì code đổi.
  // Chỉ closure mới nhất của mỗi id được tính: gỡ cơ chế ở vòng sau thay được lần đóng cũ.
  const everyFinding = [...priorFindings, ...record];
  const latest = latestClosures([...priors.flatMap((r) => r.closures ?? []), ...closures]);
  const keptMajor = everyFinding.filter((f) => BLOCKING.includes(f.severity) && f.disposition?.action === 'kept');
  const keptBlocking = keptMajor.filter((f) => !accepted(f.id));
  const keptAccepted = keptMajor.filter((f) => accepted(f.id));
  const stillOpen = closures.filter((c) => c.status === 'open').map((c) => byId.get(c.id));
  const longChains = toFix
    .map((f) => chainOf(byId, f.id))
    .filter((chain) => chain.length >= CHAIN_LIMIT);
  const badClosures = [...latest.values()]
    .filter((c) => c.status === 'closed' && c.rung !== 'revert' && !accepted(c.id))
    .map((c) => ({ closure: c, chain: chainOf(byId, c.id) }))
    .filter(({ chain }) => chain.length >= CHAIN_LIMIT);
  const missed = record.filter((f) => f.origin === 'missed');

  return {
    errors: [],
    record,
    closures,
    toFix,
    keptBlocking,
    keptAccepted,
    stillOpen,
    longChains,
    badClosures,
    missed,
    blockingCount: toFix.length + keptBlocking.length + stillOpen.length + badClosures.length,
    acceptKey,
  };
}

// Rung thêm hay đổi code: bản sửa phải có test phủ nó (CP-107, mục 11 của issue #7).
export const RUNGS_NEEDING_TEST = ['narrow', 'reuse', 'mechanism'];

// `redTest` và `rerunBy` của một closure đã đóng. Trả null khi có lỗi (đã ghi vào `errors`).
function closureTest(c, errors, testTitles) {
  if (c.rerunBy !== undefined && !text(c.rerunBy)) {
    errors.push(`closure ${c.id}: "rerunBy" phải là chuỗi không rỗng — tên lens đã chạy lại trên diff của bản sửa`);
    return null;
  }
  const rerunBy = text(c.rerunBy) ? c.rerunBy.trim() : null;
  if (c.redTest === undefined) {
    if (RUNGS_NEEDING_TEST.includes(c.rung)) {
      errors.push(`closure ${c.id}: rung ${c.rung} thêm hay đổi code, nên phải có "redTest": tên test phủ bản sửa, hay null kèm "note" nói vì sao không có test`);
      return null;
    }
    return { redTest: null, rerunBy };
  }
  if (c.redTest === null) {
    if (!text(c.note)) {
      errors.push(`closure ${c.id}: "redTest": null phải kèm "note" nói vì sao bản sửa không có test`);
      return null;
    }
    return { redTest: null, rerunBy };
  }
  if (!text(c.redTest)) {
    errors.push(`closure ${c.id}: "redTest" phải là tên một test (chuỗi không rỗng), hay null kèm "note"`);
    return null;
  }
  const got = testTitles ? testTitles() : { ok: false, reason: 'không có log của gate test để đối chiếu' };
  if (!got.ok) {
    errors.push(`closure ${c.id} nêu redTest "${c.redTest}" nhưng ${got.reason}`);
    return null;
  }
  if (!got.titles.has(c.redTest)) {
    errors.push(`closure ${c.id}: test "${c.redTest}" không có trên dòng pass nào trong ${got.log} — tên phải khớp nguyên vẹn`);
    return null;
  }
  return { redTest: c.redTest, rerunBy };
}

const inHunks = (hunks, file, line) => Boolean(hunks) && inHunk(hunks, file, line);

// Luật của CP-78, tách khỏi `parseFindings` để hàm đó vẫn chỉ lo một việc: đọc
// đúng định dạng từng finding. Lệnh `review` gọi cả hai.
//
// Trả về `errors` rỗng khi mọi tiêu chí có kết luận hợp lệ và kết luận khớp với
// các finding. `insufficient` không phải lỗi; nó được trả về để gate in ra.
export function checkCoverage(coverage, findings, { conventionsDeclared }) {
  const errors = [];
  const keys = CRITERIA.map((c) => c.key);

  if (typeof coverage !== 'object' || coverage === null || Array.isArray(coverage)) {
    return {
      errors: [`findings.json thiếu "coverage": cần một kết luận cho mỗi tiêu chí (${keys.join(', ')})`],
      insufficient: [],
      counts: null,
    };
  }

  for (const key of Object.keys(coverage)) {
    if (!keys.includes(key)) errors.push(`coverage có tiêu chí lạ "${key}". Tiêu chí hợp lệ: ${keys.join(', ')}`);
  }

  const counts = { clean: 0, findings: 0, insufficient: 0 };
  const insufficient = [];

  for (const key of keys) {
    const entry = coverage[key];
    if (entry === undefined) {
      errors.push(`coverage thiếu tiêu chí "${key}" — mỗi tiêu chí phải có kết luận, kể cả khi không thấy gì`);
      continue;
    }
    const verdict = entry?.verdict;
    if (!VERDICTS.includes(verdict)) {
      errors.push(`coverage.${key} có verdict ${JSON.stringify(verdict)} không hợp lệ. Phải là: ${VERDICTS.join(', ')}`);
      continue;
    }
    counts[verdict] += 1;

    const own = findings.filter((f) => f.criterion === key);
    if (verdict === 'findings' && own.length === 0) {
      errors.push(`coverage.${key} ghi "findings" nhưng không có finding nào mang criterion "${key}"`);
    }
    if (verdict === 'clean' && own.length > 0) {
      errors.push(`coverage.${key} ghi "clean" nhưng có ${own.length} finding mang criterion "${key}"`);
    }
    if (verdict === 'insufficient') {
      if (NEVER_INSUFFICIENT.includes(key)) {
        errors.push(`coverage.${key} không được là "insufficient": brief luôn có spec và diff, đủ để xét tiêu chí này`);
      } else if (typeof entry.note !== 'string' || entry.note.trim() === '') {
        errors.push(`coverage.${key} là "insufficient" thì phải có "note" nói thiếu dữ liệu gì`);
      } else {
        insufficient.push({ key, note: entry.note.trim() });
      }
    }
  }

  findings.forEach((f, index) => {
    const label = `finding thứ ${index + 1}`;
    if (f.criterion === null) {
      errors.push(`${label} thiếu trường "criterion" — mỗi finding phải thuộc một tiêu chí`);
      return;
    }
    if (!keys.includes(f.criterion)) {
      errors.push(`${label} có criterion "${f.criterion}" không hợp lệ. Phải là: ${keys.join(', ')}`);
      return;
    }
    if (f.criterion === 'convention') {
      if (!BASES.includes(f.basis)) {
        errors.push(`${label} thuộc convention thì phải có "basis": declared (theo luật đã khai) hoặc inferred (suy ra từ code)`);
      } else if (f.basis === 'declared' && !conventionsDeclared) {
        errors.push(`${label} ghi basis "declared" nhưng repo chưa khai convention nào — dùng "inferred"`);
      }
    }
  });

  return { errors, insufficient, counts };
}

export function formatFinding(f) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : 'không nêu vị trí';
  return `[${f.severity}] ${f.title}\n      ${where}\n      ${f.detail}`;
}
