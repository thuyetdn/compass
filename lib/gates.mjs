import { loadConfig } from './config.mjs';
import { resolveRepos, reposForScope } from './repos.mjs';
import { info } from './report.mjs';

// The one list of gates Compass can actually run. Keeping it here stops the
// failure that shipped once already: check.mjs knew about a gate that
// task-types.mjs had never heard of, so the gate silently never ran.
// `done` không nằm trong danh sách này: nó là cổng cuối, không phải gate mà
// `check` chạy. Nhưng nó **có** ghi bản ghi vào cùng sổ, nên chỗ nào duyệt sổ
// cũng phải chấp nhận khoá đó.
export const IMPLEMENTED_GATES = ['spec', 'knowledge', 'secrets', 'convention', 'test', 'ui', 'visual', 'review'];

// Cheap first, expensive last, so a fast failure never pays for a slow gate.
export const GATE_ORDER = ['spec', 'knowledge', 'secrets', 'convention', 'test', 'ui', 'visual', 'review'];

// Gates that read the project's code, and so must record what that code looked
// like. `done` compares the recording against the tree as it stands now; a gate
// left off this list closes a task on evidence about code that has moved on.
//
// It lives here beside the other lists because the same omission has shipped
// twice: a gate added in one file that another file never learned about.
export const SOURCE_DEPENDENT_GATES = ['knowledge', 'secrets', 'convention', 'test', 'ui', 'visual'];

// Gate cần một trang để mở. Repo không khai `devUrl` thì không có trang nào, và
// bắt chúng chạy là bắt đo một thứ không tồn tại.
export const BROWSER_GATES = ['ui', 'visual'];

// Lý do duy nhất `check` được phép bỏ qua một gate bắt buộc, và là chuỗi duy
// nhất `done` chấp nhận. Một hằng số chung chứ không phải hai chuỗi giống nhau
// ở hai file: `check` sửa lời văn mà `done` không biết thì mọi bản ghi skip
// biến thành "chưa chạy", và task đang đóng được bỗng đóng không được.
export const LY_DO_KHONG_DEVURL = 'không khai devUrl';

export function isImplemented(gate) {
  return IMPLEMENTED_GATES.includes(gate);
}

// Gate đo code của từng repo: mỗi repo một bản ghi `<gate>@<repo>`. Ở dự án nhiều
// repo, khe trần của ba gate này không nói được nó đã đo repo nào, nên `done`
// coi nó là bản ghi mốc. `test` không nằm đây: nó gộp output mọi repo rồi mới
// đối chiếu ID một lần (CP-13-H7), nên vẫn ghi một khe trần.
export const PER_REPO_GATES = ['convention', 'ui', 'visual'];

// Tên repo đi vào đường dẫn baseline và evidence. `sorm/frontend` lồng thư mục là
// cách khai SKILL.md hướng dẫn; còn đoạn rỗng, `.`, `..`, `\`, `:` hay `/` ở đầu
// thì đưa file ra khỏi chỗ của nó — từ chối trước khi ghi bất cứ thứ gì.
export function repoPathError(repo) {
  const bad = repo.startsWith('/') || repo.includes('\\') || repo.includes(':') ||
    repo.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
  return bad
    ? `Tên repo "${repo}" không dùng làm đường dẫn được: không được có đoạn rỗng, ".", "..", "\\", ":" hay "/" ở đầu.`
    : null;
}

// Repo nào một gate theo repo phải đo. Gate tự nạp, không trông chờ nơi gọi đưa:
// `compass convention <id>` gọi thẳng từ CLI cũng phải chạy đúng những repo mà
// `check` chạy, nếu không nó ghi một khe trần đè lên bằng chứng theo repo (CP-13-S3).
//
// Trả `repos: null` khi dự án một repo — gate chạy đúng đường cũ, không đổi gì.
// Config hỏng mà nơi gọi không nêu repo cũng đi đường cũ: gate đó tự báo lỗi config
// như trước, và `done` không bao giờ tính khe trần khi không đọc được config.
export function reposForGate(root, scope, repo) {
  const cfg = loadConfig(root);
  if (repo === null && (!cfg.ok || cfg.config.repos === undefined)) return { ok: true, repos: null };
  if (!cfg.ok) return { ok: false, output: cfg.errors.join('\n') };

  const resolved = resolveRepos(root, cfg.config);
  if (!resolved.ok) return { ok: false, output: resolved.errors.join('\n') };
  const co = resolved.repos.map((r) => r.name).filter((n) => n !== null).join(', ');

  if (repo !== null) {
    const found = resolved.repos.find((r) => r.name === repo);
    if (!found) {
      return {
        ok: false,
        output: [`Repo "${repo}" không có trong "repos" của config.json.`, `Repo có: ${co || '(chưa khai repo nào)'}`].join('\n'),
      };
    }
    return { ok: true, repos: [found] };
  }

  const khop = reposForScope(resolved.repos, scope);
  if (khop.length === 0) {
    return { ok: false, output: [`Phạm vi "${scope}" không khớp repo nào đã khai.`, `Repo có: ${co}`].join('\n') };
  }
  return { ok: true, repos: khop };
}

// `compass ui <id>` / `compass visual <id>` gọi thẳng ở dự án nhiều repo: đi từng
// repo trong phạm vi theo đúng luật của `check`. Repo không khai devUrl được bỏ
// qua, và `skip(repo)` ghi bản ghi bỏ qua khi loại task đòi gate này. Tuần tự,
// dừng ở repo đỏ đầu tiên — dev server repo trước tắt hẳn rồi repo sau mới lên.
export async function runBrowserGatePerRepo({ gate, repos, required, run, skip }) {
  // Kiểm tra mọi tên repo sẽ được đo trước khi repo nào chạy: repo đầu đã ghi
  // baseline rồi mới tới repo tên hỏng thì "không ghi gì" đã thành sai.
  for (const r of repos) {
    const err = r.config.devUrl ? repoPathError(r.name) : null;
    if (err) return { exitCode: 2, output: `[${r.name}] ${err}` };
  }

  const lines = [];
  const skipped = [];
  for (const r of repos) {
    if (!r.config.devUrl) {
      skipped.push(`${gate}@${r.name} (${LY_DO_KHONG_DEVURL})`);
      if (required) skip(r);
      continue;
    }
    const result = await run(r);
    lines.push(`[${r.name}] ${result.output}`);
    if (result.exitCode !== 0) return { exitCode: result.exitCode, output: lines.join('\n') };
  }
  if (skipped.length) lines.push('', info(`Bỏ qua: ${skipped.join(', ')}`));
  return { exitCode: 0, output: lines.join('\n') };
}
