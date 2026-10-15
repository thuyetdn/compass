import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, compassDir, taskDir, specPath, configPath, validateTaskId } from '../lib/paths.mjs';
import { TASK_TYPES, rulesFor } from '../lib/task-types.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';
import { hint } from '../lib/report.mjs';
import { ensureCompassGitignore } from '../lib/signature.mjs';

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
function gitignoreLine(root, taskId, state) {
  if (state === 'upgraded') {
    return 'Đã nâng .compass/.gitignore: thêm data/ — kết quả query, log, dump không lên git.';
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
  lines.push(
    '',
    hint('Điền spec, rồi chạy: compass spec ' + taskId)
  );

  return {
    exitCode: 0,
    output: lines.join('\n'),
  };
}
