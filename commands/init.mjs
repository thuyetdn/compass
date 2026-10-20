import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, compassDir, taskDir, specPath, configPath, validateTaskId } from '../lib/paths.mjs';
import { TASK_TYPES, rulesFor } from '../lib/task-types.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';
import { hint } from '../lib/report.mjs';
import { ensureCompassGitignore } from '../lib/signature.mjs';
import { conventionStatus } from '../lib/convention-draft.mjs';
import { detectRepos } from '../lib/repo-detect.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(here, '..', 'templates', 'spec.md');

// Hỏi git thật xem `data/` của task này có bị bỏ qua không — luật có thể nằm ở
// `.gitignore` gốc repo, ở thư mục cha, hay ở exclude toàn cục, và chỉ git mới
// gộp được hết. Dò một đường dẫn chứ không cần file có thật.
//   true  — git nói đã che (exit 0)
//   false — git nói chưa che (exit 1)
//   null  — không hỏi được: không có git, hay không phải repo (exit 128)
function dataIgnored(root, taskId) {
  const r = spawnSync('git', ['check-ignore', '-q', `.compass/${taskId}/data/x.csv`], {
    cwd: root,
    stdio: 'ignore',
  });
  if (r.error) return null;
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}

// Một dòng, chỉ khi có chuyện để nói — dự án mới thì output giữ nguyên.
// Bản nâng nói đúng các dòng vừa thêm: file đã che `data/` mà nghe "thêm data/"
// thì người đọc tưởng trước đó dữ liệu khách đã hở (CP-80).
const VI_SAO = {
  'data/': 'kết quả query, log, dump',
  'review-brief.md': 'brief soi code sinh lại mỗi lần chạy review',
};

function gitignoreLine(root, taskId, { state, added = [] }) {
  if (state === 'upgraded') {
    const what = added.map((l) => `${l} (${VI_SAO[l] ?? 'mặc định mới'})`).join(' và ');
    return `Đã nâng .compass/.gitignore: thêm ${what} — không lên git.`;
  }
  const warn = 'Cảnh báo: .compass/.gitignore chưa che data/ — kết quả query production có thể ' +
    'lên git. Thêm dòng `data/` vào .compass/.gitignore.';
  // File của người dùng: không đụng, chỉ nói khi git xác nhận data/ hở. Không
  // hỏi được git thì im — ngoài repo thì chẳng có gì để lọt.
  if (state === 'user') return dataIgnored(root, taskId) === false ? warn : null;
  // Định nâng mà không ghi được: file vẫn thiếu data/. Im chỉ khi git xác nhận
  // có luật khác đã che; còn lại phải nói, không được khai là đã nâng.
  if (state === 'failed') return dataIgnored(root, taskId) === true ? null : warn;
  return null;
}

export function initCommand({ cwd, taskId, type }) {
  if (!taskId) {
    return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass init <id> --type=<loại>' };
  }

  const validation = validateTaskId(taskId);
  if (!validation.ok) {
    return { exitCode: 2, output: validation.reason };
  }

  if (!type) {
    return {
      exitCode: 2,
      output: `Thiếu --type. Phải là một trong: ${TASK_TYPES.join(', ')}`,
    };
  }
  const rules = rulesFor(type);
  if (!rules) {
    return {
      exitCode: 2,
      output: `Loại task không hợp lệ: "${type}". Phải là một trong: ${TASK_TYPES.join(', ')}`,
    };
  }

  const found = findRoot(cwd);
  const root = found ?? cwd;
  const isNewProject = !found;

  mkdirSync(compassDir(root), { recursive: true });
  if (!existsSync(configPath(root))) {
    writeFileSync(configPath(root), JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

  // .salt không được rời khỏi máy này, và data/ — kết quả query production —
  // cũng vậy. Ghi qua cùng hàm `getSalt` dùng, nên lệnh nào chạy trước cũng ra
  // cùng một file. `init` chạy đầu mỗi task, nên đây cũng là chỗ dự án cũ được
  // nâng: file một dòng `.salt` do bản trước viết.
  const ignoreState = ensureCompassGitignore(root);

  const spec = specPath(root, taskId);
  if (existsSync(spec)) {
    return { exitCode: 2, output: `Spec đã tồn tại: ${spec}` };
  }

  mkdirSync(taskDir(root, taskId), { recursive: true });
  const filled = readFileSync(TEMPLATE, 'utf8')
    .replaceAll('{{taskId}}', taskId)
    .replaceAll('{{type}}', type)
    .replaceAll('{{minTests}}', String(rules.minTests))
    .replaceAll('{{layers}}', rules.requiredLayers.join(', '));
  writeFileSync(spec, filled);

  const lines = [];
  if (isNewProject) {
    lines.push(`Khởi tạo dự án Compass mới tại: ${root}`);
  }
  lines.push(
    `Đã tạo task ${taskId} (loại ${type})`,
    `  spec: ${spec}`,
  );
  const ignoreLine = gitignoreLine(root, taskId, ignoreState);
  if (ignoreLine) lines.push(ignoreLine);
  // Task nào cũng mở bằng `init`, nên đây là chỗ convention thiếu hay đã cũ được
  // nói ra trước khi ai viết spec — không đợi người nhớ mà hỏi (CP-82).
  lines.push(...conventionStatus(root).lines);
  lines.push(
    '',
    hint('Điền spec, rồi chạy: compass spec ' + taskId)
  );

  return {
    exitCode: 0,
    output: lines.join('\n'),
  };
}

// `compass init --multi` — dựng config cho dự án nhiều repo bằng cách đọc các
// thư mục con, thay vì hỏi người dùng từng repo một.
//
// Lệnh này không nhận task id: nó dựng **config**, không mở task. Chạy một lần
// lúc bắt đầu dự án, rồi `init <id> --type=` như bình thường.
//
// Ba lúc nó từ chối ghi, và cả ba đều vì cùng một lý do — ghi ra một config sai
// tệ hơn không ghi gì, vì người dùng tin là nó đúng:
//   - config đã có     → in cái dò được, để người tự gộp
//   - không thấy repo  → dự án một repo, `init <id>` lo được
//   - devUrl trùng nhau → phải người chọn cổng, đoán thì `visual` chụp nhầm trang
export function initMultiCommand({ cwd, taskId }) {
  // `compass init TD-1 --multi` từng ghi config rồi exit 0, im lặng bỏ task id
  // — người gõ tin là TD-1 đã được tạo, mà không có task nào cả. Lệnh này dựng
  // config, không mở task; hai việc đó không gộp được.
  if (taskId) {
    return {
      exitCode: 2,
      output: [
        `--multi không nhận task id, nhưng nhận được "${taskId}".`,
        '',
        hint('Dựng config: compass init --multi · Mở task: compass init <id> --type=<loại>'),
      ].join('\n'),
    };
  }

  const root = findRoot(cwd) ?? cwd;
  const found = detectRepos(root);
  const lines = [];

  const describe = (repo) => {
    const parts = [`  "${repo.name}": test = ${repo.entry.test}`];
    if (repo.entry.devUrl) parts.push(`      dev = ${repo.entry.dev} · ${repo.entry.devUrl}`);
    return parts.join('\n');
  };

  if (found.repos.length === 0) {
    lines.push('Không tìm thấy repo con nào có package.json.');
    for (const p of found.problems) lines.push(`  ${p.name}: ${p.reason}`);
    lines.push('', hint('Dự án một repo thì dùng: compass init <id> --type=<loại>'));
    return { exitCode: 2, output: lines.join('\n') };
  }

  lines.push(`Dò được ${found.repos.length} repo:`);
  for (const repo of found.repos) lines.push(describe(repo));

  if (found.problems.length) {
    lines.push('', 'Cần bạn nhìn:');
    for (const p of found.problems) lines.push(`  ${p.name}: ${p.reason}`);
  }

  const config = { ...DEFAULT_CONFIG, repos: {} };
  for (const repo of found.repos) config.repos[repo.name] = repo.entry;
  const block = JSON.stringify(config, null, 2);

  if (found.conflicts.length) {
    lines.push('', 'Chưa ghi — hai repo cùng một devUrl, phải bạn chọn cổng:');
    for (const c of found.conflicts) {
      lines.push(`  ${c.url} ← ${c.names.join(', ')}`);
    }
    lines.push('', hint('Khai cổng trong config của từng repo rồi chạy lại.'));
    return { exitCode: 2, output: lines.join('\n') };
  }

  if (found.problems.length) {
    lines.push('', 'Chưa ghi — còn thư mục cần bạn quyết. Config dò được:', block);
    return { exitCode: 2, output: lines.join('\n') };
  }

  if (existsSync(configPath(root))) {
    lines.push('', 'Chưa ghi — config.json đã có. Phần dò được, bạn tự gộp:', block);
    return { exitCode: 2, output: lines.join('\n') };
  }

  mkdirSync(compassDir(root), { recursive: true });
  writeFileSync(configPath(root), block);
  ensureCompassGitignore(root);

  lines.push('', `Đã ghi: ${configPath(root)}`);
  lines.push('', hint('Đọc lại cùng người dùng: compass status'));
  return { exitCode: 0, output: lines.join('\n') };
}
