// Vòng soi (CP-106). Vòng 1 soi toàn bộ; từ vòng 2 người soi chỉ đọc bản sửa — diff
// từ trạng thái code lúc vòng trước được chấm tới nay. Muốn có diff đó thì phải giữ lại
// trạng thái ấy: mỗi vòng chụp một git tree cho từng git, ghi vào sổ cái.
//
// Tree ghi bằng một index tạm chép từ index thật, như `collectDiff`: index, HEAD và
// nhánh của người dùng không bao giờ bị đụng. Chỉ file trong danh sách của vòng được
// băm vào object database — một `.env` chưa theo dõi nằm cạnh không bao giờ vào đó.
//
// Tree không có ref nào giữ, nên `git gc` xoá được sau hạn của nó (mặc định hai tuần).
// Khi đó `review` nói ra và soi lại từ vòng 1, thay vì tạo ref trong repo người dùng.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Windows giới hạn dòng lệnh ~32k ký tự; chia đường dẫn theo tổng độ dài như `collectDiff`.
const BATCH_CHARS = 24_000;

function git(cwd, args, { env, input } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 50_000_000,
    input,
    // stderr giữ lại để lỗi git đi vào thông báo, thay vì một dòng "Command failed" trần.
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function batches(paths) {
  const out = [];
  let cur = [];
  let chars = 0;
  for (const p of paths) {
    if (cur.length && chars + p.length + 16 > BATCH_CHARS) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(p);
    chars += p.length + 16;
  }
  if (cur.length) out.push(cur);
  return out;
}

// Đường dẫn trong danh sách file của brief tính từ gốc của git (diff không `--relative`),
// nên pathspec dùng `:(top,literal)`: đúng cả khi gốc Compass là thư mục con của repo, và
// tên file chứa `*` hay `[` không thành mẫu.
const top = (p) => `:(top,literal)${p}`;

// Các git của một lần soi, mỗi git một khóa: '.' cho git của gốc, tiền tố repo cho repo
// con có git riêng. `end` là commit Soi đến của git đó, nếu có.
export function unitsOf(root, plan, collected) {
  if (!plan.units) return [{ key: '.', dir: root, prefix: '', end: collected.end ?? null }];
  const out = [];
  if (plan.found.rootGit) out.push({ key: '.', dir: root, prefix: '', end: collected.end ?? null });
  for (const unit of plan.units) {
    const range = (collected.repoRanges ?? []).find((r) => r.prefix === unit.prefix);
    out.push({ key: unit.prefix, dir: unit.dir, prefix: unit.prefix, end: range?.end ?? null });
  }
  return out;
}

// Chia danh sách file (mang tiền tố repo) về từng git, bỏ tiền tố. Tiền tố dài nhất
// thắng: repo `apps/web` lồng trong `apps` nhận file của nó.
export function splitFiles(units, files) {
  const byKey = new Map(units.map((u) => [u.key, []]));
  const ordered = [...units].filter((u) => u.prefix).sort((a, b) => b.prefix.length - a.prefix.length);
  for (const f of files) {
    const unit = ordered.find((u) => f.startsWith(`${u.prefix}/`));
    if (unit) byKey.get(unit.key).push(f.slice(unit.prefix.length + 1));
    else if (byKey.has('.')) byKey.get('.').push(f);
  }
  return byKey;
}

// Tree của trạng thái hiện tại cho `paths`, trong một git. Có Soi đến thì là tree của
// commit đó: bản soi nói về commit, không về cây làm việc.
function snapshotOne(unit, paths) {
  if (unit.end) return git(unit.dir, ['rev-parse', `${unit.end}^{tree}`]).trim();
  const scratch = mkdtempSync(path.join(tmpdir(), 'compass-snap-'));
  const indexFile = path.join(scratch, 'index');
  try {
    copyFileSync(path.resolve(unit.dir, git(unit.dir, ['rev-parse', '--git-path', 'index']).trim()), indexFile);
    const env = { GIT_INDEX_FILE: indexFile };
    const toplevel = git(unit.dir, ['rev-parse', '--show-toplevel']).trim();
    const present = [];
    const gone = [];
    // File chưa theo dõi mà nay bị ignore (bản sửa `git rm --cached` rồi thêm vào
    // .gitignore) thì `git add` từ chối. Coi nó như đã gỡ khỏi code của task; `add -f` sẽ
    // băm một file người dùng vừa chủ ý giấu vào object database.
    const ignored = new Set();
    for (const b of batches(paths)) {
      for (const f of git(unit.dir, ['ls-files', '-z', '--full-name', '--others', '--ignored', '--exclude-standard', '--', ...b.map(top)], { env }).split('\0')) {
        if (f) ignored.add(f);
      }
    }
    for (const p of paths) (existsSync(path.join(toplevel, p)) && !ignored.has(p) ? present : gone).push(p);
    for (const b of batches(present)) git(unit.dir, ['add', '--', ...b.map(top)], { env });
    for (const b of batches(gone)) git(unit.dir, ['rm', '--cached', '-q', '--ignore-unmatch', '--', ...b.map(top)], { env });
    return git(unit.dir, ['write-tree'], { env }).trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// `{ ok, trees, heads }`, mỗi git một tree và một HEAD. Lỗi git thì `{ ok: false, reason }`.
export function snapshot(units, files) {
  const byKey = splitFiles(units, files);
  const trees = {};
  const heads = {};
  try {
    for (const unit of units) {
      trees[unit.key] = snapshotOne(unit, byKey.get(unit.key));
      heads[unit.key] = git(unit.dir, ['rev-parse', 'HEAD']).trim();
    }
  } catch (err) {
    return { ok: false, reason: `Không chụp được trạng thái code cho vòng soi: ${err.message}` };
  }
  return { ok: true, trees, heads };
}

// Mọi tree của một vòng cũ còn trong object database không. `git gc` xoá tree không có
// ref giữ sau hạn của nó, và một diff tính từ tree đã mất thì không còn là bản sửa.
export function snapshotAlive(units, trees) {
  for (const unit of units) {
    const tree = trees?.[unit.key];
    if (!tree) continue;
    try {
      git(unit.dir, ['cat-file', '-e', `${tree}^{tree}`]);
    } catch {
      return false;
    }
  }
  return true;
}

// Diff của bản sửa: từ tree vòng trước tới tree bây giờ, chỉ trên `files`. Tên file mang
// tiền tố repo như brief. `--no-renames` để mỗi file một mục, hunk đọc thẳng được.
export function fixDiff(units, before, after, files) {
  const byKey = splitFiles(units, files);
  let diff = '';
  const changed = [];
  try {
    for (const unit of units) {
      const a = before?.[unit.key];
      const b = after?.[unit.key];
      const paths = byKey.get(unit.key);
      if (!b || !paths.length) continue;
      // Git mới xuất hiện sau vòng trước: so với cây rỗng của chính git đó.
      const from = a ?? git(unit.dir, ['hash-object', '-t', 'tree', '--stdin'], { input: '' }).trim();
      const pre = unit.prefix ? `${unit.prefix}/` : '';
      const base = ['diff', '--no-ext-diff', '--no-color', '--no-renames', `--src-prefix=a/${pre}`, `--dst-prefix=b/${pre}`, from, b];
      for (const batch of batches(paths)) {
        diff += git(unit.dir, [...base, '--', ...batch.map(top)]);
        changed.push(...git(unit.dir, [...base, '--name-only', '-z', '--', ...batch.map(top)])
          .split('\0').filter(Boolean).map((f) => `${pre}${f}`));
      }
    }
  } catch (err) {
    return { ok: false, reason: `Không tính được diff của bản sửa: ${err.message}` };
  }
  return { ok: true, diff, files: changed };
}

// Dòng phía mới của từng hunk, theo file: Map<file, [[start, count]]>. Đọc tên từ dòng
// `+++ b/…`; file bị xoá (`+++ /dev/null`) không có dòng mới nào để chỉ vào.
export function parseHunks(diff) {
  const hunks = new Map();
  let file = null;
  // Số dòng còn lại của thân hunk đang đọc, bên cũ và bên mới (CP-107). Trong thân hunk,
  // dòng thêm có nội dung `++ x` hiện ra là `+++ x`, giống hệt dòng tên file; chỉ dòng
  // `+++ ` nằm ngoài thân hunk mới là tên file.
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of diff.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('\\')) continue;
      if (line.startsWith('+')) newLeft -= 1;
      else if (line.startsWith('-')) oldLeft -= 1;
      else { oldLeft -= 1; newLeft -= 1; }
      continue;
    }
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).replace(/\t.*$/, '');
      file = name === '/dev/null' ? null : unquote(name).replace(/^b\//, '');
      if (file !== null && !hunks.has(file)) hunks.set(file, []);
      continue;
    }
    const m = line.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    oldLeft = m[1] === undefined ? 1 : Number(m[1]);
    newLeft = m[3] === undefined ? 1 : Number(m[3]);
    if (file !== null) hunks.get(file).push([Number(m[2]), newLeft]);
  }
  return hunks;
}

// Git đặt tên ngoài ASCII trong nháy, escape theo kiểu C (`"b/c\303\272.js"`).
function unquote(name) {
  if (!name.startsWith('"') || !name.endsWith('"')) return name;
  const bytes = [];
  const body = name.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const next = body[++i];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push({ n: 10, t: 9, r: 13, '"': 34, '\\': 92 }[next] ?? next.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

// Người soi viết đường dẫn theo nhiều kiểu: `./x.js`, `x\\y.js`.
export function normaliseFile(p) {
  return String(p).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

// Dòng `line` của `file` có nằm trong một hunk của bản sửa không. Hunk chỉ xoá
// (`+c,0`) không còn dòng nào ở phía mới; dòng `c` (dòng ngay trước chỗ xoá) và `c+1`
// (dòng ngay sau) là hai chỗ một người soi chỉ vào được.
export function inHunk(hunks, file, line) {
  const list = hunks.get(normaliseFile(file));
  if (!list || !Number.isInteger(line)) return false;
  return list.some(([start, count]) => (count === 0
    ? line === start || line === start + 1
    : line >= start && line < start + count));
}
