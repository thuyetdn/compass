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
    return lstatSync(p).isDirectory() && !lstatSync(p).isSymbolicLink();
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

    const match = text.match(/\bport\s*:\s*(\d{2,5})\b/);
    if (match) return Number(match[1]);
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

// Đi sâu tối đa hai mức: `frontend/` và `sorm/backend/` đều là bố cục thường
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
      entry.__portDeclared = port !== null;
      entry.__framework = framework.name;
    }

    return { name: name.split(path.sep).join('/'), dir, entry };
  });

  // Hai repo cùng devUrl mà không repo nào khai cổng: Compass không chọn hộ
  // được, vì đoán sai thì `visual` chụp nhầm trang và baseline của repo này trở
  // thành bằng chứng cho repo kia.
  const byUrl = new Map();
  for (const repo of repos) {
    const url = repo.entry.devUrl;
    if (!url || repo.entry.__portDeclared) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(repo.name);
  }
  const conflicts = [...byUrl.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([url, names]) => ({ url, names }));

  for (const repo of repos) {
    delete repo.entry.__portDeclared;
    delete repo.entry.__framework;
  }

  return { repos, problems, conflicts };
}

export { NO_TEST };
