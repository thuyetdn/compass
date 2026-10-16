import { readdirSync, readFileSync, statSync, lstatSync } from 'node:fs';
import path from 'node:path';

// Dựng config nhiều repo bằng tay là chỗ hay sai nhất: một lockfile đọc nhầm
// thì lệnh test của nửa dự án sai, một repo bị bỏ sót thì gate của nó không bao
// giờ chạy mà vẫn xanh. Thông tin cần thì đã nằm sẵn trong file — đọc còn rẻ
// hơn hỏi người dùng từng repo một.
//
// Module này chỉ **đọc**. Nó không cài gì, không gọi mạng, và không bao giờ chạy
// script của repo đích: một `scripts.test` chứa `&& rm -rf` phải đi vào config
// nguyên văn như một chuỗi, không được thực thi lúc dò.

// Thư mục không bao giờ là repo của dự án: sản phẩm build, phụ thuộc, vùng của
// chính Compass. Một package.json nằm trong node_modules là của thư viện khác.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.compass', '.knowledge', '.claude',
  'dist', 'build', 'coverage', 'out', '.next', '.nuxt', '.cache',
  'vendor', '__pycache__', '.venv', 'venv',
]);

// Lockfile → trình quản lý gói. Thứ tự quan trọng: một repo có cả pnpm-lock và
// package-lock (di cư dở dang) thì pnpm là cái đang dùng, package-lock là rác.
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

// Framework → file config và cổng mặc định. Cổng mặc định chỉ dùng khi repo
// không khai; hai repo cùng framework cùng im lặng là hai devUrl trùng nhau, và
// đó là lúc phải hỏi người chứ không đoán.
const FRAMEWORKS = [
  { name: 'vite', configs: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'], port: 5173 },
  { name: 'next', configs: ['next.config.js', 'next.config.mjs', 'next.config.ts'], port: 3000 },
  { name: 'angular', configs: ['angular.json'], port: 4200 },
];

// Repo không có test vẫn phải vào config. Bỏ nó ra ngoài thì gate không bao giờ
// đụng tới và dự án trông như đã được kiểm tra đủ.
const NO_TEST = "echo 'chưa có test' && exit 1";

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Symlink bị bỏ qua hẳn, không đi theo. Một junction trỏ ra ngoài dự án mà được
// dò thì config mang repo của người khác, và `resolveRepos` sẽ từ chối nó sau —
// muộn hơn và khó hiểu hơn là bỏ qua ngay ở đây.
function isRealDir(p) {
  try {
    // `lstat` không đi theo link, nên symlink và junction đều trả
    // `isDirectory() === false` — một lần gọi là đủ để loại cả hai.
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (err) {
    return { ok: false, reason: err instanceof SyntaxError ? 'JSON hỏng' : 'không đọc được' };
  }
}

function packageManager(dir) {
  for (const [file, manager] of LOCKFILES) {
    try {
      statSync(path.join(dir, file));
      return manager;
    } catch {
      // không có lockfile này, thử cái tiếp theo
    }
  }
  return 'npm';
}

// Cổng khai trong config của framework. Đọc bằng regex chứ không parse: file
// config là JS thật, đánh giá nó là chạy code của repo đích — đúng thứ module
// này hứa không làm. Không đọc ra thì trả null và người gọi dùng cổng mặc định.
// Bỏ chú thích trước khi dò, thay bằng khoảng trắng để số dòng và vị trí không
// xê dịch. Một dòng `// cổng cũ port: 9999 đã bỏ` mà tính là lời khai thì gate
// mở nhầm trang, và người đọc config không hiểu con số ở đâu ra.
function stripComments(text) {
  let out = '';
  let i = 0;
  // Chuỗi phải đi qua nguyên vẹn, không chỉ để giữ nội dung mà để `//` bên
  // trong nó đừng bị tính là chú thích: một `target: 'http://localhost:8080'`
  // rất thường đứng ngay trên `server.port`, và nuốt nhầm nó là nuốt luôn cả
  // phần còn lại của dòng.
  let quote = null;

  while (i < text.length) {
    const ch = text[i];

    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

// Cổng phải nằm **trong khối `server`**, không phải chỗ nào cũng được. Bản
// trước quét phẳng cả file và lấy `port:` đầu tiên, nên một khối `proxy` hay
// `preview` đứng trên `server.port` là thắng — rồi con số sai đó lại được đánh
// dấu "đã khai", tắt luôn lưới chắn devUrl trùng nhau.
//
// Đếm ngoặc để biết khối `server` kết thúc ở đâu, và chỉ nhận `port` ở **đúng
// một mức** bên trong nó: `server.proxy['/api'].port` sâu hơn một mức nên
// không tính. Vẫn là đọc text, không đánh giá file — đánh giá nghĩa là chạy
// code của dự án đích.
//
// Đọc không ra thì trả `null`, và framework dùng cổng mặc định. Nói "chưa khai"
// còn hơn khai một con số sai mà chắc nịch: cổng mặc định vẫn bị soi xem có trùng
// repo khác không, còn con số sai thì không.
function portInServerBlock(source) {
  const text = stripComments(source);
  const header = /\bserver\s*:\s*\{/g;
  let match;

  while ((match = header.exec(text)) !== null) {
    const open = header.lastIndex - 1;
    let depth = 0;

    for (let i = open; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      } else if (depth === 1 && (ch === 'p' || ch === '"' || ch === "'")) {
        // Chỉ ở depth 1 — ngay trong `server`, không phải trong khối con của nó.
        const rest = text.slice(i);
        const found = /^["']?port["']?\s*:\s*(\d{2,5})\b/.exec(rest);
        if (found) return Number(found[1]);
      }
    }
  }
  return null;
}

function declaredPort(dir, framework) {
  for (const file of framework.configs) {
    let text;
    try {
      text = readFileSync(path.join(dir, file), 'utf8');
    } catch {
      continue;
    }

    if (framework.name === 'angular') {
      const json = readJson(path.join(dir, file));
      if (!json.ok) continue;
      const projects = json.value?.projects ?? {};
      for (const project of Object.values(projects)) {
        const port = project?.architect?.serve?.options?.port ?? project?.targets?.serve?.options?.port;
        if (Number.isInteger(port)) return port;
      }
      continue;
    }

    const port = portInServerBlock(text);
    if (port !== null) return port;
  }
  return null;
}

function detectFramework(dir, pkg) {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const framework of FRAMEWORKS) {
    const hasConfig = framework.configs.some((f) => {
      try {
        statSync(path.join(dir, f));
        return true;
      } catch {
        return false;
      }
    });
    if (hasConfig || deps[framework.name]) return framework;
  }
  return null;
}

// Đi sâu tối đa hai mức: `frontend/` và `store/backend/` đều là bố cục thường
// gặp, còn sâu hơn thì gần như chắc chắn là thư mục con của một repo đã tìm
// thấy. Gặp package.json thì dừng, không đào tiếp vào trong nó.
function walk(root, rel, depth, found, problems) {
  let entries;
  try {
    entries = readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

    const childRel = rel === '' ? entry.name : path.posix.join(rel, entry.name);
    const childAbs = path.join(root, childRel);
    if (!isRealDir(childAbs)) continue;

    const pkgPath = path.join(childAbs, 'package.json');
    let hasPkg = false;
    try {
      hasPkg = statSync(pkgPath).isFile();
    } catch {
      hasPkg = false;
    }

    if (hasPkg) {
      const pkg = readJson(pkgPath);
      if (!pkg.ok) {
        problems.push({ name: childRel, reason: `package.json ${pkg.reason}` });
        continue;
      }
      found.push({ name: childRel, dir: childAbs, pkg: pkg.value });
      continue;
    }

    // Không phải dự án Node nhưng rõ ràng là một dự án: nói ra, để người tự khai
    // lệnh test. Im lặng bỏ qua là cách một repo biến mất khỏi mọi gate.
    const foreign = ['pom.xml', 'build.gradle', 'go.mod', 'Cargo.toml', 'composer.json', 'requirements.txt'];
    const marker = foreign.find((f) => {
      try {
        return statSync(path.join(childAbs, f)).isFile();
      } catch {
        return false;
      }
    });
    if (marker) {
      problems.push({ name: childRel, reason: `${marker} — không phải Node, tự khai lệnh test` });
      continue;
    }

    if (depth > 1) walk(root, childRel, depth - 1, found, problems);
  }
}

// Dò toàn bộ dự án. Chỉ đọc, không ghi — người gọi quyết định làm gì với kết quả.
//
// Trả về:
//   repos     — mỗi repo một entry đã sẵn sàng đưa vào config.repos
//   problems  — thư mục cần người nhìn: JSON hỏng, dự án không phải Node
//   conflicts — nhóm repo trùng devUrl, phải hỏi người trước khi ghi
export function detectRepos(root) {
  const found = [];
  const problems = [];
  walk(root, '', 2, found, problems);

  const repos = found.map(({ name, dir, pkg }) => {
    const scripts = pkg.scripts ?? {};
    const manager = packageManager(dir);
    const entry = {
      test: typeof scripts.test === 'string' && scripts.test.trim() !== ''
        ? `${manager} test`
        : NO_TEST,
    };

    // Chỉ repo có giao diện mới được devUrl. Backend khai vào thì `ui` và
    // `visual` chạy oan rồi đỏ vì không có trang nào để mở.
    const framework = detectFramework(dir, pkg);
    if (typeof scripts.dev === 'string' && scripts.dev.trim() !== '' && framework) {
      const port = declaredPort(dir, framework);
      entry.dev = manager === 'npm' ? 'npm run dev' : `${manager} dev`;
      entry.devUrl = `http://localhost:${port ?? framework.port}/`;
    }

    return { name: name.split(path.sep).join('/'), dir, entry };
  });

  // Hai repo cùng một devUrl thì Compass không chọn hộ được, dù cổng đó do
  // người khai hay do mặc định của framework: `visual` sẽ chụp trang của repo
  // này và lưu làm baseline cho repo kia, mà gate vẫn xanh.
  //
  // Bản trước bỏ qua repo đã khai cổng, nên nó chỉ bắt được khi *cả hai* cùng
  // im lặng. Một repo khai thẳng 5173 đứng cạnh một repo Vite im lặng — cũng
  // 5173 — lọt thẳng vào config. Trùng là trùng, ai khai không đổi hậu quả.
  const byUrl = new Map();
  for (const repo of repos) {
    const url = repo.entry.devUrl;
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(repo.name);
  }
  const conflicts = [...byUrl.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([url, names]) => ({ url, names }));


  return { repos, problems, conflicts };
}

export { NO_TEST };
