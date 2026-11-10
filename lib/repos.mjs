import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

// One task usually crosses repos: change an endpoint in the backend, then the
// screen that calls it. Declaring them under one Compass root means a single
// spec can cover both, instead of two installs that never know about each other.
//
// Config merges per field, the way ESLint config does: a repo that only names
// its own test command still inherits dev, devUrl and the rest from the shared
// level.

const REQUIRED = ['test'];

export function isInside(root, dir) {
  const relative = path.relative(root, dir);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Thư mục của một repo khai trong `repos`: `path` nếu có, không thì chính tên. Một
// chỗ duy nhất, dùng chung với `lib/workspace-git.mjs` (CP-84) để hai bên không lệch.
// Trả `{ dir, relative }`, hoặc `{ error }` khi mục hỏng hay trỏ ra ngoài gốc.
export function repoDir(root, name, own) {
  if (typeof own !== 'object' || own === null || Array.isArray(own)) return { error: `repo "${name}" phải là object` };
  const relative = typeof own.path === 'string' && own.path !== '' ? own.path : name;
  const dir = path.resolve(root, relative);
  if (!isInside(root, dir)) return { error: `repo "${name}" trỏ ra ngoài thư mục gốc: ${relative}` };
  return { dir, relative };
}

// `allowMissing` (CP-103): repo khai mà không có thư mục trên máy không còn là lỗi; nó
// vào `missing` để nơi gọi tự quyết theo Phạm vi. Mặc định giữ hành vi cũ cho mọi nơi
// gọi khác.
export function resolveRepos(root, config, { allowMissing = false } = {}) {
  const declared = config.repos;

  // No repos means the whole root is the one repo. Everything downstream then
  // works the same for one repo as for many.
  if (declared === undefined) {
    return { ok: true, repos: [{ name: null, dir: root, config }] };
  }

  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    return { ok: false, errors: ['"repos" trong config.json phải là object, mỗi khóa là một repo'] };
  }

  const { repos: _ignored, ...shared } = config;
  const errors = [];
  const repos = [];
  const missing = [];

  for (const [name, own] of Object.entries(declared)) {
    const where = repoDir(root, name, own);
    if (where.error) {
      errors.push(where.error);
      continue;
    }
    const { dir, relative } = where;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      if (allowMissing) missing.push({ name, relative });
      else errors.push(missingError(name, relative));
      continue;
    }

    const merged = { ...shared, ...own };
    delete merged.path;

    for (const field of REQUIRED) {
      if (typeof merged[field] !== 'string' || merged[field].trim() === '') {
        errors.push(`repo "${name}" thiếu "${field}" — không khai ở repo thì phải có ở phần chung`);
      }
    }

    repos.push({ name, dir, config: merged });
  }

  if (errors.length) return { ok: false, errors };
  return allowMissing ? { ok: true, repos, missing } : { ok: true, repos };
}

const missingError = (name, relative) => `repo "${name}" không tìm thấy thư mục: ${relative}`;

// Repo của một task, cho `check`, `done`, `test`, `status` và các gate theo repo (CP-103,
// issue #6). Repo khai mà chưa clone về máy chỉ chặn khi task nhắc tới nó trong Phạm vi;
// ngoài Phạm vi thì bỏ qua, và `notes` nói ra để không ai tưởng nó đã được đo.
export function resolveReposForScope(root, config, scope) {
  const resolved = resolveRepos(root, config, { allowMissing: true });
  if (!resolved.ok) return resolved;
  const missing = resolved.missing ?? [];
  const named = reposForScope(missing, scope);
  if (named.length) return { ok: false, errors: named.map((m) => missingError(m.name, m.relative)) };
  return {
    ok: true,
    repos: resolved.repos,
    missing,
    notes: missing.map((m) => `Bỏ qua repo "${m.name}": không tìm thấy thư mục ${m.relative} trên máy này, và nó không nằm trong Phạm vi.`),
  };
}

// Which repos a task touches comes from the spec's `Phạm vi` line. Matching on
// a path segment, not a prefix, so "app" does not claim "app-admin".
export function reposForScope(repos, scope) {
  if (repos.length === 1 && repos[0].name === null) return repos;
  if (typeof scope !== 'string') return [];

  const paths = scope
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/\\/g, '/'))
    .filter(Boolean);

  return repos.filter((repo) =>
    paths.some((p) => p === repo.name || p.startsWith(`${repo.name}/`)));
}
