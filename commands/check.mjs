import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath } from '../lib/paths.mjs';
import { writeSkip } from '../lib/gate-store.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { specCommand } from './spec.mjs';
import { testCommand } from './test.mjs';
import { info } from '../lib/report.mjs';
import { conventionCommand } from './convention.mjs';
import { knowledgeCommand } from './knowledge.mjs';
import { uiCommand } from './ui.mjs';
import { visualCommand } from './visual.mjs';
import { reviewCommand } from './review.mjs';
import { secretsCommand } from './secrets.mjs';
import { GATE_ORDER, BROWSER_GATES, LY_DO_KHONG_DEVURL } from '../lib/gates.mjs';
import { resolveRepos, reposForScope } from '../lib/repos.mjs';
import { loadConfig } from '../lib/config.mjs';

const IMPLEMENTED = {
  spec: specCommand,
  knowledge: knowledgeCommand,
  secrets: secretsCommand,
  convention: conventionCommand,
  test: testCommand,
  ui: uiCommand,
  visual: visualCommand,
  review: reviewCommand,
};


export async function checkCommand({ cwd, taskId, only }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass check <id>' };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const rules = rulesFor(spec.type);
  if (!rules) {
    return { exitCode: 2, output: `Loại task không hợp lệ trong spec: "${spec.type}"` };
  }

  let gates = GATE_ORDER.filter((g) => rules.gates.includes(g));

  if (only) {
    if (!gates.includes(only)) {
      return {
        exitCode: 2,
        output: `Gate "${only}" không áp dụng cho loại task "${spec.type}". Gate hợp lệ: ${gates.join(', ')}`,
      };
    }
    if (!IMPLEMENTED[only]) {
      return {
        exitCode: 2,
        output: `Gate "${only}" áp dụng nhưng chưa được xây dựng ở giai đoạn này.`,
      };
    }
    gates = gates.filter((g) => g === only);
  }

  // `spec`, `knowledge`, `review` đọc spec, tài liệu và diff — đều là thứ của
  // cả task, không của riêng repo nào. Chạy một lần ở gốc.
  const CHUNG = ['spec', 'knowledge', 'secrets', 'review'];

  const cfg = loadConfig(root);
  if (!cfg.ok) return { exitCode: 2, output: cfg.errors.join("\n") };

  const resolved = resolveRepos(root, cfg.config);
  if (!resolved.ok) {
    return { exitCode: 2, output: resolved.errors.join("\n") };
  }
  const daChon = reposForScope(resolved.repos, spec.scope);
  if (daChon.length === 0) {
    return {
      exitCode: 2,
      output: [
        `Phạm vi "${spec.scope}" không khớp repo nào đã khai.`,
        `Repo có: ${resolved.repos.map((r) => r.name).join(", ")}`,
      ].join("\n"),
    };
  }

  // Gate cần trình duyệt chỉ chạy ở repo khai devUrl. Backend không khai thì bỏ
  // qua repo đó — không thêm quy ước đặt tên nào phải nhớ.
  const CAN_TRINH_DUYET = BROWSER_GATES;

  const lines = [];
  const skipped = [];

  for (const gate of gates) {
    const run = IMPLEMENTED[gate];
    if (!run) { skipped.push(gate); continue; }

    // A gate may be async (ui drives a browser); awaiting a sync return is harmless.
    // Một repo, không khai `repos`: `repo.name` là null và mọi thứ chạy y như
    // trước — cùng thư mục, cùng khe bản ghi.
    // `test` tự lặp bên trong: nó cần gộp kết quả mọi repo rồi mới đối chiếu
    // ID một lần. Chia case theo repo thì backend đòi cả case frontend.
    if (gate === 'test') {
      const result = await run({ cwd: root, taskId, repos: daChon, gateRoot: root });
      lines.push(result.output);
      if (result.exitCode !== 0) return { exitCode: result.exitCode, output: lines.join("\n") };
      continue;
    }

    const chay = CHUNG.includes(gate) ? [{ name: null, dir: root }] : daChon;

    // Tuần tự, không song song: hai dev server tranh cổng là lỗi chập chờn đã
    // tốn nhiều giờ ở CP-8. Vài giây không đáng đổi lấy chuyện đó.
    for (const repo of chay) {
      if (CAN_TRINH_DUYET.includes(gate) && repo.config && !repo.config.devUrl) {
        skipped.push(`${gate}${repo.name ? "@" + repo.name : ""} (${LY_DO_KHONG_DEVURL})`);
        // Ghi lại, không chỉ in ra. `done` đòi đủ gate bắt buộc của loại task, và
        // `ui`/`visual` nằm trong đó từ feature-m. Không để lại bản ghi thì `done`
        // báo "chưa chạy" một gate mà chính `check` vừa từ chối chạy, rồi khuyên
        // chạy lại `check` — vòng lặp không có lối ra, gặp thật ở CP-32.
        //
        // Chỉ ghi cho gate BẮT BUỘC. Ghi cho mọi loại task thì `fix` cũng có bản
        // ghi skip, mà `done` không đòi nó — sổ mọc thêm dòng không ai đọc.
        //
        // Cùng một hàm ghi với lời gọi thẳng `compass ui <id>`, để hai đường vào
        // để lại cùng một bản ghi.
        if (!rules.gates.includes(gate)) continue;
        writeSkip(root, taskId, gate, repo.name);
        continue;
      }

      // Gate chung chạy ở gốc nhận `repo: null` như trước. Gate theo repo nhận tên
      // repo và tự đo đúng thư mục, đúng config đã gộp của repo đó.
      const result = await run({ cwd: repo.dir, taskId, repo: repo.name, gateRoot: root });
      lines.push(repo.name === null ? result.output : `[${repo.name}] ${result.output}`);
      if (result.exitCode !== 0) {
        // Dừng ngay: chạy tiếp repo sau chỉ tốn thời gian cho một kết quả đã đỏ.
        return { exitCode: result.exitCode, output: lines.join("\n") };
      }
    }
  }

  if (skipped.length) {
    lines.push('', info(`Bỏ qua (chưa cài ở giai đoạn này): ${skipped.join(', ')}`));
  }

  return { exitCode: 0, output: lines.join('\n') };
}
