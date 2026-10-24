import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { configPath } from './paths.mjs';
import { isInside, reposForScope, repoDir } from './repos.mjs';
import { gitTopLevel, gitFilesFromRepoRoot, gitLines, realPath, isUnder, foldsCase, scopeForm } from './git-files.mjs';
import { collectDiff, checkSize, parseScopePaths } from './review-brief.mjs';

// CP-84 (issue #1). Một gốc Compass có thể khai `repos` mà mỗi repo nằm trong thư
// mục con với `.git` riêng. `test` và `convention` chạy trong từng thư mục repo nên
// thấy code đó; `review` và `secrets` chỉ hỏi git của gốc, nên không thấy gì: brief
// trống code của task, và `.env` commit trong repo con lọt qua `secrets`.
//
// Một "đơn vị git" là một git chứa code của task: git của gốc (khi gốc nằm trong
// một git), cộng mỗi git riêng của repo khai trong `repos` nằm trong gốc. Hai repo
// chung một git con là một đơn vị. `review` và `secrets` lấy danh sách từ đây, để
// hai gate không bao giờ nói khác nhau về việc task đã đổi (CP-33).

const posix = (p) => p.split(path.sep).join('/');

// Thư mục gần nhất từ `dir` đi lên (tới `stop`, gồm cả hai đầu; không có `stop` thì
// tới gốc ổ đĩa) có `.git`, thư mục hay file. Git không trả gốc nào mà vẫn có `.git`
// ở đâu đó phía trên thì git đang từ chối nó (`safe.directory`, gitfile hỏng), không
// phải là không có git: coi nó là thư mục thường thì `secrets` xanh trên một `.env` đã
// commit (lần soi thứ tư và thứ năm của CP-84).
function gitMarker(dir, stop = null) {
  let d = path.resolve(dir);
  const end = stop ? path.resolve(stop) : null;
  for (;;) {
    if (existsSync(path.join(d, '.git'))) return d;
    if (end && d === end) return null;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

// Mọi đơn vị git của gốc. `space` là gốc của mọi đường dẫn trong brief: gốc git của
// thư mục Compass, hay chính nó khi nó không nằm trong git nào. `prefix` của một đơn
// vị tính từ đó, nên `be/b.js` của repo con đứng cạnh `src/x.js` của git gốc.
//
// Đọc `repos` ở đây chứ không qua `resolveRepos`: một mục thiếu lệnh `test` là lỗi
// của gate `test`, không phải lý do để không biết repo nào có git riêng. Bản trước đi
// qua `resolveRepos`, nên chỉ một mục hỏng là `secrets` không quét repo con nào mà
// vẫn xanh (lần soi đầu của CP-84). Thứ không đọc được thì nói ra trong `errors`.
export function gitUnits(root) {
  const realRoot = realPath(root);
  const rootTop = gitTopLevel(root);
  const space = rootTop ? realPath(rootTop) : realRoot;
  const out = { rootGit: rootTop !== null, space, fold: foldsCase(root), units: [], shared: [], plain: [], missing: [], outside: [], errors: [] };

  // Đọc JSON thô, không qua kiểm tra của `loadConfig`: thiếu `test` ở phần chung là
  // việc của gate `test`, và dự án một git từng chạy `review` được với config như vậy
  // (lần soi thứ ba của CP-84). Chỉ khi không đọc nổi JSON mà file có nhắc `repos` thì
  // mới không biết repo con nào cần soi.
  let text = '';
  let config;
  try {
    text = readFileSync(configPath(root), 'utf8');
    config = JSON.parse(text);
  } catch (err) {
    if (/"repos"/.test(text)) out.errors.push(`Không đọc được .compass/config.json, nên không biết repo con nào có git riêng: ${err.message}`);
    return out;
  }
  const declared = config?.repos;
  if (declared === undefined) return out;
  if (!rootTop) {
    const broken = gitMarker(root);
    if (broken) {
      out.errors.push(`Git của gốc Compass (${broken}) có .git nhưng git không đọc được nó (thử \`git -C "${broken}" status\` để xem lý do, thường là safe.directory). Compass không soi hay quét được nó.`);
      return out;
    }
  }
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    out.errors.push('"repos" trong config.json phải là object, mỗi khóa là một repo — chưa đọc được thì không biết repo con nào có git riêng.');
    return out;
  }

  const byTop = new Map();
  for (const [name, own] of Object.entries(declared)) {
    const where = repoDir(root, name, own);
    if (where.error) {
      out.errors.push(where.error);
      continue;
    }
    const { dir } = where;
    const repo = { name, rel: posix(path.relative(root, dir)) };
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      out.missing.push(repo);
      continue;
    }
    const top = gitTopLevel(dir);
    if (!top) {
      // Có `.git` mà git không đọc được (trên Windows hay gặp nhất là `safe.directory`,
      // "dubious ownership"): không phải thư mục thường. Coi nó là thư mục thường thì
      // `secrets` xanh trên một `.env` đã commit (lần soi thứ tư của CP-84).
      const broken = gitMarker(dir, root);
      if (broken) {
        const where = posix(path.relative(root, broken)) || '.';
        out.errors.push(`Repo "${name}" có .git nhưng git không đọc được nó (thử \`git -C ${where} status\` để xem lý do, thường là safe.directory). Compass không soi hay quét được repo này.`);
      } else {
        out.plain.push(repo);
      }
      continue;
    }
    const realTop = realPath(top);
    if (rootTop && realTop === space) {
      out.shared.push(repo);
      continue;
    }
    // Junction hay đường dẫn trỏ ra ngoài: Compass không soi hay quét một git nó
    // không được giao, kể cả khi thư mục khai nằm trong gốc theo chữ.
    // Có từ chối hay không tuỳ Phạm vi, nên ở đây chỉ ghi lại (issue #2, CP-88).
    if (!isInside(realRoot, realTop)) {
      out.outside.push({ ...repo, top, inSpace: posix(path.relative(space, path.join(realRoot, repo.rel))) });
      continue;
    }
    if (!byTop.has(realTop)) {
      byTop.set(realTop, { names: [], repos: [], dir: realTop, rel: posix(path.relative(realRoot, realTop)), prefix: posix(path.relative(space, realTop)) });
    }
    const unit = byTop.get(realTop);
    unit.names.push(name);
    unit.repos.push({ ...repo, own, inUnit: posix(path.relative(realTop, realPath(dir))) });
  }
  out.units = [...byTop.values()];
  return out;
}

const label = (unit) => unit.names.join(', ');

// Một mục Phạm vi thuộc repo con khi nó viết theo đường dẫn của repo (`apps/web/x.js`),
// theo tên repo (`web/x.js`, như `reposForScope` vẫn đọc), hay theo thư mục git của
// đơn vị (`apps/x.js`). Trả đường dẫn tính từ gốc git của đơn vị, hoặc `null`. Chọn
// repo và thu hẹp theo `Soi đến` cùng đi qua hàm này: hai bên từng đọc hai kiểu khác
// nhau, nên một repo có tên khác đường dẫn bị bỏ khỏi brief (lần soi đầu của CP-84).
//
// Đường dẫn của repo luôn nằm trong thư mục git của đơn vị, nên dạng thư mục git
// đã gồm nó; chỉ tên repo cần một dạng riêng.
//
// So như hệ thống file so (`fold`): `BE/x.js` cho repo `be` trên Windows là repo của
// task. So phân biệt hoa thường thì repo đó thành "ngoài Phạm vi", và `secrets` chỉ còn
// đọc thay đổi chưa commit của nó (lần soi thứ tư của CP-88).
function inUnit(p, unit, fold) {
  const entry = scopeForm(p);
  const forms = [...unit.repos.map((r) => [r.name, r.inUnit]), [unit.rel, '']];
  for (const [form, base] of forms) {
    if (!isUnder(entry, form, { fold })) continue;
    // Phần sau tiền tố giữ nguyên chữ người viết. Pathspec của git phân biệt hoa thường
    // kể cả với `core.ignorecase`, nên `Soi đến` thu hẹp theo một chữ sai thì ra rỗng và
    // gate đỏ: hỏng về phía an toàn.
    const rest = entry.slice(scopeForm(form).length + 1);
    if (rest === '') return base === '' ? '.' : base;
    return base === '' ? rest : `${base}/${rest}`;
  }
  return null;
}

const namesRepo = (p, repo, fold) => [repo.rel, repo.name].some((form) => isUnder(p, form, { fold }));

// Mốc soi của từng đơn vị: dòng `Gốc soi (be):` trong spec, rồi `reviewBase` ở đúng
// mục của repo trong config — không lấy `reviewBase` chung, vì nó là sha của git gốc.
// `review` chọn đơn vị theo Phạm vi; `secrets` quét mọi đơn vị.
//
// Trả `{ ok: true, units: null }` khi không có repo con nào có git riêng: người gọi
// đi đúng đường cũ, không đổi một byte nào của brief.
export function planUnits(root, spec, { forSecrets = false } = {}) {
  const found = gitUnits(root);
  const errors = [...found.errors];
  const bases = spec.repoBases ?? {};
  const ends = forSecrets ? {} : (spec.repoEnds ?? {});
  // `toString` hay `constructor` là tên repo hợp lệ: chỉ đọc khóa spec thật sự khai.
  const own = (table, name) => (Object.hasOwn(table, name) ? table[name] : undefined);
  const unitOf = new Map(found.units.flatMap((u) => u.names.map((n) => [n, u])));
  const scope = parseScopePaths(spec.scope).paths;

  for (const [kind, table] of [['Gốc soi', bases], ['Soi đến', ends]]) {
    for (const name of Object.keys(table)) {
      if (unitOf.has(name)) continue;
      const is = (list) => list.some((r) => r.name === name);
      if (is(found.shared)) {
        errors.push(`\`${kind} (${name}):\` — repo "${name}" dùng chung git với gốc Compass. Khai \`${kind}:\` (không ngoặc) cho nó.`);
      } else if (is(found.plain)) {
        errors.push(`\`${kind} (${name}):\` — repo "${name}" không nằm trong git nào, nên không có mốc để soi.`);
      } else if (is(found.outside)) {
        errors.push(`\`${kind} (${name}):\` — repo "${name}" có git nằm ngoài gốc Compass, nên Compass không soi nó; bỏ dòng này đi.`);
      } else if (is(found.missing)) {
        errors.push(`\`${kind} (${name}):\` — repo "${name}" khai trong "repos" nhưng không thấy thư mục của nó.`);
      } else {
        const has = found.units.flatMap((u) => u.names);
        errors.push(`\`${kind} (${name}):\` — repo "${name}" không phải repo con có git riêng khai trong "repos" của config.json. Repo con có git riêng: ${has.length ? has.join(', ') : '(không có)'}.`);
      }
    }
  }
  // Repo task khai trong Phạm vi mà không có trên đĩa thì không soi được nó. `secrets`
  // không cần: không có thư mục thì không có file nào để lộ.
  if (!forSecrets) {
    for (const repo of found.missing) {
      // Git của gốc biết thư mục đó (task xoá nó) thì nó là việc của git gốc, như dự
      // án một git vẫn soi trước CP-84 (lần soi thứ năm).
      const known = found.rootGit && (gitLines(root, ['log', '-1', '--format=%H', '--', repo.rel]) ?? []).length > 0;
      if (!known && scope.some((p) => namesRepo(p, repo, found.fold))) {
        errors.push(`Repo "${repo.name}" nằm trong Phạm vi nhưng không thấy thư mục ${repo.rel} — chưa clone, hay khai sai \`path\`.`);
      }
    }
  }
  // Repo có git nằm ngoài gốc: Compass không soi hay quét một git nó không được giao.
  // Task nhắc tới nó thì dừng; không nhắc thì bỏ qua và nói ra, để một repo không ai
  // đụng tới không làm đỏ mọi task (issue #2, CP-88). Không đọc file nào của nó.
  const notes = [];
  for (const repo of found.outside) {
    if (scope.some((p) => namesRepo(p, repo, found.fold))) {
      errors.push(`Repo "${repo.name}" có git nằm ngoài gốc Compass (${repo.top}). Compass không soi hay quét một git nằm ngoài gốc.`);
    } else {
      notes.push(`Bỏ qua repo "${repo.name}": git của nó nằm ngoài gốc Compass (${repo.top}), và nó không nằm trong Phạm vi.`);
    }
  }
  if (errors.length) return { ok: false, errors };
  // Repo bị bỏ qua vẫn cần đường mới: git gốc không được `add -N` thư mục của nó.
  if (found.units.length === 0 && found.outside.length === 0) return { ok: true, units: null, found, notes };

  // `reposForScope` vẫn đọc Phạm vi thô (`be` không có `/`), như mọi gate theo repo.
  const byName = new Set(reposForScope(found.units.flatMap((u) => u.names.map((name) => ({ name }))), spec.scope).map((r) => r.name));
  const inScope = (u) => u.names.some((n) => byName.has(n)) || scope.some((p) => inUnit(p, u, found.fold) !== null);
  const chosen = forSecrets ? found.units : found.units.filter(inScope);

  const planned = [];
  for (const unit of chosen) {
    const pick = (values, what) => {
      const distinct = [...new Set(values.filter((v) => v !== undefined && v !== null))];
      if (distinct.length > 1) errors.push(`Repo ${label(unit)} chung một git nhưng khai ${what} khác nhau: ${distinct.join(', ')}.`);
      return distinct[0] ?? null;
    };
    const specBase = pick(unit.names.map((n) => own(bases, n)), '`Gốc soi (…)`');
    const configBase = pick(unit.repos.map((r) => r.own.reviewBase), '`reviewBase`');
    const baseRef = specBase ?? configBase;
    const endRef = pick(unit.names.map((n) => own(ends, n)), '`Soi đến (…)`');
    planned.push({
      label: label(unit),
      dir: unit.dir,
      rel: unit.rel,
      repos: unit.repos,
      prefix: unit.prefix,
      baseRef,
      baseFrom: specBase !== null ? 'spec' : (configBase ? 'config.json' : null),
      endRef,
      inScope: inScope(unit),
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, units: planned, found, notes };
}

// Phạm vi viết theo đường dẫn từ gốc Compass. Mục nằm trong một repo con thuộc về
// repo đó (đổi sang đường dẫn trong git của nó); phần còn lại thuộc git gốc.
export function splitScope(paths, units, fold) {
  const root = [];
  const byUnit = new Map(units.map((u) => [u, []]));
  for (const p of paths) {
    const unit = units.find((u) => inUnit(p, u, fold) !== null);
    if (unit) byUnit.get(unit).push(inUnit(p, unit, fold));
    else root.push(p);
  }
  return { root, byUnit };
}

// Diff của mọi đơn vị, gộp làm một. Mỗi đơn vị chạy `collectDiff` trong chính git
// của nó, giữ mọi luật (index tạm, file chưa theo dõi, cây rỗng). Một đơn vị rỗng là
// bình thường — git gốc thường chỉ theo dõi `.compass/` — nên chỉ đỏ khi mọi đơn vị
// đều rỗng. Cỡ diff đo trên bản gộp.
// `scopePaths` là cả Phạm vi đã đọc ra pathspec: mỗi `Soi đến` thu hẹp theo phần
// của nó, kể cả khi git gốc không khai `Soi đến`.
export function collectUnits(root, plan, rootOptions, { forSecrets = false, scopePaths = [] } = {}) {
  const { root: rootScope, byUnit } = splitScope(scopePaths, plan.units, plan.found.fold);
  const parts = [];
  // Soi đến của git gốc thu hẹp theo Phạm vi. Phạm vi chỉ còn mục của repo con thì
  // git gốc không có gì trong phạm vi: bỏ nó, thay vì soi trọn khoảng của nó.
  const rootSkipped = Boolean(rootOptions.endRef) && scopePaths.length > 0 && rootScope.length === 0;
  if (plan.found.rootGit && !rootSkipped) {
    parts.push({
      unit: null,
      result: collectDiff(root, { ...rootOptions, scopePaths: rootOptions.endRef ? rootScope : [], skipNested: [...plan.found.units, ...plan.found.outside].map((u) => u.rel), foldCase: plan.found.fold }),
    });
  }
  // Repo con có git riêng lồng trong một repo con khác (`apps/` và `apps/web/`): git
  // bên ngoài không được `add -N` nó thành gitlink, như git của gốc (lần soi thứ tư).
  // Repo bị bỏ qua (git ngoài gốc, CP-88) lồng trong repo con cũng vậy: đường dẫn của nó
  // tính từ thư mục khai, vì git của nó nằm ở chỗ khác.
  const nestedIn = (unit) => [...plan.found.units, ...plan.found.outside.map((r) => ({ dir: path.join(realPath(root), r.rel) }))]
    .filter((u) => u.dir !== unit.dir && isInside(unit.dir, u.dir))
    .map((u) => posix(path.relative(unit.dir, u.dir)));
  for (const unit of plan.units) {
    parts.push({
      unit,
      result: collectDiff(unit.dir, {
        baseRef: unit.baseRef,
        baseFrom: unit.baseFrom ?? 'config.json',
        endRef: unit.endRef,
        endFrom: 'spec',
        scopePaths: unit.endRef ? byUnit.get(unit) : [],
        pathPrefix: unit.prefix,
        // Chỉ repo NGOÀI Phạm vi mới rút về thay đổi chưa commit. Repo của task đứng
        // trên nhánh chính vẫn quét từ điểm lần như `review`: commit xong là lọt qua
        // chốt duy nhất cần người duyệt, và hai gate nói khác nhau (lần soi thứ hai).
        fallbackToHead: forSecrets && !unit.baseRef && !unit.inScope,
        skipNested: nestedIn(unit),
        foldCase: plan.found.fold,
      }),
    });
  }

  // Lỗi của git gốc cũng mang nhãn: "Repo chưa có commit nào" trần đọc như lỗi của be.
  const named = (part, reason) => (part.unit ? `Repo \`${part.unit.label}\`: ${reason}` : `Git của gốc Compass: ${reason}`);
  for (const part of parts) {
    if (!part.result.ok && part.result.ly_do !== 'empty') {
      return { ok: false, reason: named(part, part.result.reason) };
    }
  }
  // Không git nào để đọc không phải "không có thay đổi": `secrets` đọc `empty` là xanh,
  // và một lần quét không đọc gì mà xanh là kiểu sai gate này sinh ra để chặn (lần soi
  // đầu của CP-88).
  if (parts.length === 0) {
    return { ok: false, reason: 'Không có git nào để đọc: gốc Compass không nằm trong git, và không repo con nào có git riêng đọc được trong phạm vi.' };
  }
  const done = parts.filter((p) => p.result.ok);
  if (done.length === 0) {
    const lines = ['Không có thay đổi nào để soi, ở git nào:'];
    for (const part of parts) {
      const first = String(part.result.reason).split('\n');
      lines.push(...[`- ${part.unit ? `repo \`${part.unit.label}\`` : 'git của gốc Compass'}: ${first[0]}`, ...first.slice(1).map((l) => `  ${l}`)]);
    }
    return { ok: false, ly_do: 'empty', reason: lines.join('\n') };
  }

  const diff = done.map((p) => p.result.diff).join('');
  const files = done.flatMap((p) => p.result.files);
  const deleted = done.flatMap((p) => p.result.deleted ?? []);
  const tooBig = checkSize(diff, files);
  if (tooBig) return tooBig;

  const rootPart = done.find((p) => p.unit === null) ?? null;
  const r = rootPart?.result ?? {};
  return {
    ok: true,
    diff,
    files,
    deleted,
    rootRange: rootPart !== null,
    base: r.base ?? null,
    end: r.end ?? null,
    endAtHead: r.endAtHead ?? false,
    narrowedTo: r.narrowedTo ?? [],
    fromEmptyTree: r.fromEmptyTree ?? false,
    // Mỗi repo con đã soi một dòng, kể cả repo diff rỗng: brief phải nói đã nhìn git đó.
    repoRanges: parts.filter((p) => p.unit).map(({ unit, result }) => (!result.ok ? {
      label: unit.label,
      prefix: unit.prefix,
      empty: true,
    } : {
      label: unit.label,
      prefix: unit.prefix,
      base: result.base,
      baseFrom: unit.baseFrom,
      end: result.end ?? null,
      endAtHead: result.endAtHead ?? false,
      narrowedTo: (result.narrowedTo ?? []).map((p) => `${unit.prefix}/${p}`),
      fromEmptyTree: result.fromEmptyTree ?? false,
    })),
  };
}

// Đường dẫn (tính từ gốc đường dẫn của brief) không nằm dưới repo bị bỏ qua nào. Mọi
// danh sách file của gốc hay repo con đi qua đây, vì git đi xuyên junction và liệt kê
// file của git bên ngoài như file của chính nó (lần soi thứ hai của CP-88).
//
// Chỉ dùng cho danh sách file CHƯA theo dõi: file git đã theo dõi là của git đó, kể cả
// khi nó nằm dưới junction (lần soi thứ ba của CP-88).
export function notSkipped(found) {
  const dirs = (found?.outside ?? []).map((r) => r.inSpace);
  return (p) => !dirs.some((d) => isUnder(p, d, { fold: found?.fold }));
}

// File git theo dõi (hay chưa theo dõi mà không bị ignore) của mọi đơn vị, mang
// tiền tố. `null` khi git của một đơn vị không liệt kê được: người gọi phải nói
// "không lấy được", không được coi là "không có gì".
export function listUnits(units, args) {
  const out = [];
  for (const unit of units) {
    const lines = gitFilesFromRepoRoot(unit.dir, args);
    if (lines === null) return null;
    out.push(...lines.map((f) => `${unit.prefix}/${posix(f)}`));
  }
  return out;
}
