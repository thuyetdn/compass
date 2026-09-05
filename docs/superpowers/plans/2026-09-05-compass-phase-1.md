# Compass GĐ 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây bộ xương Compass — CLI với 5 lệnh (`init`, `spec`, `test`, `check`, `done`), gate record có chữ ký chống sửa tay, và SKILL.md bản đầu — đủ để chạy thử spec-first + gate cứng trên một task thật.

**Architecture:** Một CLI Node thuần, zero runtime dependency. Mọi lệnh đọc `config.json`, tự spawn process con để chạy test, tự bắt exit code, tự ghi `gate.json` kèm HMAC signature. AI không có đường truyền kết quả vào — nó chỉ gọi lệnh. Code chia theo trách nhiệm: `lib/` là logic thuần (test được không cần I/O), `commands/` là orchestration, `cli.mjs` là entry point.

**Tech Stack:** Node.js 24 (ESM, `node:test`, `node:crypto`, `node:child_process`). Không dependency ngoài.

**Spec:** [docs/superpowers/specs/2026-09-05-compass-design.md](../specs/2026-09-05-compass-design.md)

## Global Constraints

- **Zero runtime dependency.** Chỉ dùng Node built-in. `package.json` không có `dependencies`.
- **ESM only.** Mọi file `.mjs`, dùng `import`/`export`.
- **Node ≥ 20.** Dùng `node:test` làm test runner (`node --test`).
- **Không dùng `process.exit()` trong `lib/`.** Chỉ `cli.mjs` được set exit code. Lý do: `lib/` phải test được.
- **Mọi thông báo ra người dùng bằng tiếng Việt.** Tên hàm, biến, test name, commit message bằng tiếng Anh (theo spec §6.5).
- **Exit code:** `0` = pass, `1` = gate fail, `2` = lỗi sử dụng (thiếu tham số, file không tồn tại).
- **Đường dẫn trong code luôn dùng `path.join`/`path.resolve`** — không nối chuỗi. Dự án chạy trên Windows.

---

## File Structure

```
compass/
├── package.json              type:module, bin, scripts
├── cli.mjs                   entry point: parse argv → dispatch → set exit code
├── lib/
│   ├── paths.mjs             tìm root (.compass/), dựng đường dẫn task
│   ├── config.mjs            đọc + validate config.json
│   ├── hash.mjs              sha256, hash file, hash cây thư mục
│   ├── signature.mjs         salt, ký và xác minh gate record
│   ├── gate-store.mjs        đọc/ghi gate.json
│   ├── spec-parser.mjs       parse spec.md → object (loại, test cases, sections)
│   ├── spec-validator.mjs    kiểm spec hợp lệ theo loại task
│   ├── task-types.mjs        bảng quy tắc theo loại task
│   ├── test-runner.mjs       spawn test command, bắt exit code + output
│   ├── test-parser.mjs       trích test ID từ output
│   └── report.mjs            định dạng output ra terminal
├── commands/
│   ├── init.mjs
│   ├── spec.mjs
│   ├── test.mjs
│   ├── check.mjs
│   ├── done.mjs
│   └── status.mjs
├── templates/
│   └── spec.md               template spec sinh bởi init
└── test/
    ├── paths.test.mjs
    ├── hash.test.mjs
    ├── signature.test.mjs
    ├── gate-store.test.mjs
    ├── spec-parser.test.mjs
    ├── spec-validator.test.mjs
    ├── task-types.test.mjs
    ├── test-parser.test.mjs
    └── integration.test.mjs

SKILL.md                      quy trình AI phải theo
```

**Vì sao chia thế này:** `lib/` toàn hàm thuần hoặc I/O tối thiểu → test được độc lập, không cần dựng cả CLI. `commands/` ghép các mảnh lại, chỉ test qua integration. Ranh giới rõ: một file một trách nhiệm, không file nào quá ~150 dòng.

---

## Task 1: Khởi tạo dự án và module đường dẫn

**Files:**
- Create: `package.json`
- Create: `lib/paths.mjs`
- Create: `.gitignore`
- Test: `test/paths.test.mjs`

**Interfaces:**
- Consumes: (không có — task đầu)
- Produces:
  - `findRoot(startDir: string): string | null` — đi ngược lên tìm thư mục chứa `.compass/config.json`, trả về đường dẫn thư mục đó hoặc `null`
  - `compassDir(root: string): string` — trả `<root>/.compass`
  - `taskDir(root: string, taskId: string): string` — trả `<root>/.compass/<taskId>`
  - `evidenceDir(root: string, taskId: string): string` — trả `<root>/.compass/<taskId>/evidence`
  - `specPath(root: string, taskId: string): string` — trả `<root>/.compass/<taskId>/spec.md`
  - `gatePath(root: string, taskId: string): string` — trả `<root>/.compass/<taskId>/evidence/gate.json`
  - `configPath(root: string): string` — trả `<root>/.compass/config.json`
  - `saltPath(root: string): string` — trả `<root>/.compass/.salt`

- [ ] **Step 1: Tạo package.json**

```json
{
  "name": "compass",
  "version": "0.1.0",
  "type": "module",
  "bin": { "compass": "./cli.mjs" },
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test \"test/**/*.test.mjs\""
  }
}
```

**Lưu ý:** phải dùng glob `"test/**/*.test.mjs"` (có dấu nháy) chứ không phải thư mục trần `test/` — Node 24 báo `MODULE_NOT_FOUND` khi nhận thư mục làm tham số của `--test`.

- [ ] **Step 2: Tạo .gitignore**

```
node_modules/
.compass/.salt
.knowledge/derived/
*.log
```

- [ ] **Step 3: Viết test thất bại cho paths.mjs**

Tạo `test/paths.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findRoot, compassDir, taskDir, evidenceDir,
  specPath, gatePath, configPath, saltPath
} from '../lib/paths.mjs';

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{}');
  return root;
}

test('findRoot finds the directory containing .compass/config.json', () => {
  const root = makeFixture();
  assert.equal(findRoot(root), root);
});

test('findRoot walks up from a nested directory', () => {
  const root = makeFixture();
  const nested = path.join(root, 'a', 'b', 'c');
  mkdirSync(nested, { recursive: true });
  assert.equal(findRoot(nested), root);
});

test('findRoot returns null when no config exists', () => {
  const orphan = mkdtempSync(path.join(tmpdir(), 'compass-orphan-'));
  assert.equal(findRoot(orphan), null);
});

test('path builders compose the expected locations', () => {
  const root = makeFixture();
  assert.equal(compassDir(root), path.join(root, '.compass'));
  assert.equal(taskDir(root, 'T-1'), path.join(root, '.compass', 'T-1'));
  assert.equal(evidenceDir(root, 'T-1'), path.join(root, '.compass', 'T-1', 'evidence'));
  assert.equal(specPath(root, 'T-1'), path.join(root, '.compass', 'T-1', 'spec.md'));
  assert.equal(gatePath(root, 'T-1'), path.join(root, '.compass', 'T-1', 'evidence', 'gate.json'));
  assert.equal(configPath(root), path.join(root, '.compass', 'config.json'));
  assert.equal(saltPath(root), path.join(root, '.compass', '.salt'));
});
```

- [ ] **Step 4: Chạy test, xác nhận nó fail**

Run: `node --test test/paths.test.mjs`
Expected: FAIL — `Cannot find module '../lib/paths.mjs'`

- [ ] **Step 5: Viết lib/paths.mjs**

```javascript
import { existsSync } from 'node:fs';
import path from 'node:path';

const COMPASS = '.compass';

export function findRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, COMPASS, 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const compassDir  = (root) => path.join(root, COMPASS);
export const taskDir     = (root, taskId) => path.join(root, COMPASS, taskId);
export const evidenceDir = (root, taskId) => path.join(root, COMPASS, taskId, 'evidence');
export const specPath    = (root, taskId) => path.join(root, COMPASS, taskId, 'spec.md');
export const gatePath    = (root, taskId) => path.join(root, COMPASS, taskId, 'evidence', 'gate.json');
export const configPath  = (root) => path.join(root, COMPASS, 'config.json');
export const saltPath    = (root) => path.join(root, COMPASS, '.salt');
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `node --test test/paths.test.mjs`
Expected: PASS — 4 test

- [ ] **Step 7: Khởi tạo git và commit**

```bash
git init
git add package.json .gitignore lib/paths.mjs test/paths.test.mjs
git commit -m "feat: add path resolution module"
```

---

## Task 2: Hash và chữ ký

**Files:**
- Create: `lib/hash.mjs`
- Create: `lib/signature.mjs`
- Test: `test/hash.test.mjs`
- Test: `test/signature.test.mjs`

**Interfaces:**
- Consumes: `saltPath` từ `lib/paths.mjs`
- Produces:
  - `sha256(text: string): string` — trả `"sha256:<hex>"`
  - `hashFile(filePath: string): string` — hash nội dung file; trả `"sha256:missing"` nếu file không tồn tại
  - `hashFiles(filePaths: string[]): string` — hash tổng hợp nhiều file, ổn định theo thứ tự đã sắp
  - `getSalt(root: string): string` — đọc salt, tự sinh nếu chưa có (32 byte hex)
  - `signRecord(record: object, salt: string): string` — trả chữ ký `"sha256:<hex>"`
  - `verifyRecord(record: object, salt: string): boolean` — record phải có trường `sig`

**Lưu ý thiết kế:** `signRecord` bỏ trường `sig` ra khỏi record trước khi ký, và serialize với key đã sắp xếp ở **mọi tầng** — nếu không, thứ tự key thay đổi sẽ làm chữ ký sai dù nội dung y hệt.

**Cạm bẫy đã gặp:** không được dùng `JSON.stringify(obj, keysArray)` để sắp key. Mảng key trong `JSON.stringify` là **bộ lọc đệ quy**, không phải thứ tự sắp xếp — mọi object lồng sẽ bị rỗng hóa thành `{}`, khiến hai record khác nhau cho ra cùng chữ ký. Gate record có `missingIds` là mảng, nên lỗi này phá hỏng đúng thứ module cần bảo vệ. Phải viết serializer đệ quy như dưới.

- [ ] **Step 1: Viết test thất bại cho hash.mjs**

Tạo `test/hash.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256, hashFile, hashFiles } from '../lib/hash.mjs';

test('sha256 returns a prefixed hex digest', () => {
  const result = sha256('hello');
  assert.match(result, /^sha256:[0-9a-f]{64}$/);
});

test('sha256 is deterministic', () => {
  assert.equal(sha256('same input'), sha256('same input'));
});

test('sha256 differs for different input', () => {
  assert.notEqual(sha256('a'), sha256('b'));
});

test('hashFile hashes file content', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-hash-'));
  const file = path.join(dir, 'a.txt');
  writeFileSync(file, 'content');
  assert.equal(hashFile(file), sha256('content'));
});

test('hashFile returns a missing marker for absent files', () => {
  assert.equal(hashFile('/definitely/not/here.txt'), 'sha256:missing');
});

test('hashFiles is independent of input order', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-hash-'));
  const a = path.join(dir, 'a.txt');
  const b = path.join(dir, 'b.txt');
  writeFileSync(a, 'aaa');
  writeFileSync(b, 'bbb');
  assert.equal(hashFiles([a, b]), hashFiles([b, a]));
});

test('hashFiles changes when any file changes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-hash-'));
  const a = path.join(dir, 'a.txt');
  writeFileSync(a, 'first');
  const before = hashFiles([a]);
  writeFileSync(a, 'second');
  assert.notEqual(hashFiles([a]), before);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/hash.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết lib/hash.mjs**

```javascript
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export function sha256(text) {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashFile(filePath) {
  if (!existsSync(filePath)) return 'sha256:missing';
  return sha256(readFileSync(filePath, 'utf8'));
}

export function hashFiles(filePaths) {
  const parts = [...filePaths].sort().map((p) => `${p}:${hashFile(p)}`);
  return sha256(parts.join('\n'));
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test test/hash.test.mjs`
Expected: PASS — 7 test

- [ ] **Step 5: Viết test thất bại cho signature.mjs**

Tạo `test/signature.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getSalt, signRecord, verifyRecord } from '../lib/signature.mjs';

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-sig-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{}');
  return root;
}

test('getSalt creates a salt file when absent', () => {
  const root = makeRoot();
  const salt = getSalt(root);
  assert.match(salt, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(path.join(root, '.compass', '.salt'), 'utf8'), salt);
});

test('getSalt reuses the existing salt', () => {
  const root = makeRoot();
  assert.equal(getSalt(root), getSalt(root));
});

test('signRecord produces a stable signature regardless of key order', () => {
  const salt = 'abc';
  const a = signRecord({ gate: 'test', exitCode: 0 }, salt);
  const b = signRecord({ exitCode: 0, gate: 'test' }, salt);
  assert.equal(a, b);
});

test('verifyRecord accepts an untouched record', () => {
  const salt = 'abc';
  const record = { gate: 'test', exitCode: 0 };
  record.sig = signRecord(record, salt);
  assert.equal(verifyRecord(record, salt), true);
});

test('verifyRecord rejects a tampered exitCode', () => {
  const salt = 'abc';
  const record = { gate: 'test', exitCode: 1 };
  record.sig = signRecord(record, salt);
  record.exitCode = 0;
  assert.equal(verifyRecord(record, salt), false);
});

test('verifyRecord rejects a record signed with a different salt', () => {
  const record = { gate: 'test', exitCode: 0 };
  record.sig = signRecord(record, 'salt-one');
  assert.equal(verifyRecord(record, 'salt-two'), false);
});

test('verifyRecord rejects a record without a signature', () => {
  assert.equal(verifyRecord({ gate: 'test' }, 'abc'), false);
});

test('signRecord distinguishes records differing only inside a nested object', () => {
  const salt = 'abc';
  const a = signRecord({ gate: 'test', evidence: { exitCode: 0, log: 'clean' } }, salt);
  const b = signRecord({ gate: 'test', evidence: { exitCode: 1, log: 'FAILED' } }, salt);
  assert.notEqual(a, b);
});

test('signRecord ignores key order inside a nested object', () => {
  const salt = 'abc';
  const a = signRecord({ gate: 't', evidence: { exitCode: 0, log: 'x' } }, salt);
  const b = signRecord({ gate: 't', evidence: { log: 'x', exitCode: 0 } }, salt);
  assert.equal(a, b);
});

test('signRecord distinguishes records differing only in array contents', () => {
  const salt = 'abc';
  const a = signRecord({ gate: 'test', missingIds: ['EC3', 'S2'] }, salt);
  const b = signRecord({ gate: 'test', missingIds: ['EC3'] }, salt);
  assert.notEqual(a, b);
});

test('signRecord treats array order as significant', () => {
  const salt = 'abc';
  const a = signRecord({ gate: 'test', missingIds: ['a', 'b'] }, salt);
  const b = signRecord({ gate: 'test', missingIds: ['b', 'a'] }, salt);
  assert.notEqual(a, b);
});

test('verifyRecord rejects a tampered nested value', () => {
  const salt = 'abc';
  const record = { gate: 'test', evidence: { exitCode: 1 } };
  record.sig = signRecord(record, salt);
  record.evidence.exitCode = 0;
  assert.equal(verifyRecord(record, salt), false);
});
```

- [ ] **Step 6: Chạy test, xác nhận fail**

Run: `node --test test/signature.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 7: Viết lib/signature.mjs**

```javascript
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from './hash.mjs';
import { saltPath } from './paths.mjs';

export function getSalt(root) {
  const file = saltPath(root);
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const salt = randomBytes(32).toString('hex');
  writeFileSync(file, salt);
  return salt;
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k]));
  return '{' + pairs.join(',') + '}';
}

function canonical(record) {
  const { sig, ...rest } = record;
  return canonicalize(rest);
}

export function signRecord(record, salt) {
  return sha256(canonical(record) + '|' + salt);
}

export function verifyRecord(record, salt) {
  if (!record || typeof record.sig !== 'string') return false;
  return signRecord(record, salt) === record.sig;
}
```

- [ ] **Step 8: Chạy test, xác nhận pass**

Run: `node --test test/signature.test.mjs`
Expected: PASS — 12 test

- [ ] **Step 9: Commit**

```bash
git add lib/hash.mjs lib/signature.mjs test/hash.test.mjs test/signature.test.mjs
git commit -m "feat: add hashing and gate record signing"
```

---

## Task 3: Bảng quy tắc loại task

**Files:**
- Create: `lib/task-types.mjs`
- Test: `test/task-types.test.mjs`

**Interfaces:**
- Consumes: (không)
- Produces:
  - `TASK_TYPES: string[]` — `['fix', 'bug', 'feature-s', 'feature-m', 'feature-l']`
  - `rulesFor(type: string): {minTests: number, requiredLayers: string[], gates: string[]} | null`
  - `LAYERS: string[]` — `['Happy', 'Validation', 'Error', 'Edge', 'Security', 'Performance']`
  - `isUpgrade(from: string, to: string): boolean` — true nếu `to` nặng hơn `from`

**Số liệu lấy từ spec §5** (kế thừa `qa-standards/01-qa-strategy.md`). GĐ 1 chỉ có gate `spec` và `test`; các gate khác khai báo sẵn nhưng chưa cài — `check` sẽ bỏ qua gate chưa cài và ghi rõ trong output.

- [ ] **Step 1: Viết test thất bại**

Tạo `test/task-types.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_TYPES, LAYERS, rulesFor, isUpgrade } from '../lib/task-types.mjs';

test('TASK_TYPES lists the five sizes in ascending weight', () => {
  assert.deepEqual(TASK_TYPES, ['fix', 'bug', 'feature-s', 'feature-m', 'feature-l']);
});

test('LAYERS lists the six test layers', () => {
  assert.deepEqual(LAYERS, ['Happy', 'Validation', 'Error', 'Edge', 'Security', 'Performance']);
});

test('rulesFor returns the minimum test count per type', () => {
  assert.equal(rulesFor('fix').minTests, 2);
  assert.equal(rulesFor('bug').minTests, 6);
  assert.equal(rulesFor('feature-s').minTests, 13);
  assert.equal(rulesFor('feature-m').minTests, 21);
  assert.equal(rulesFor('feature-l').minTests, 30);
});

test('rulesFor requires all six layers for feature-m and above', () => {
  assert.deepEqual(rulesFor('feature-m').requiredLayers, LAYERS);
  assert.deepEqual(rulesFor('feature-l').requiredLayers, LAYERS);
});

test('rulesFor requires only Happy for fix', () => {
  assert.deepEqual(rulesFor('fix').requiredLayers, ['Happy']);
});

test('rulesFor returns null for an unknown type', () => {
  assert.equal(rulesFor('gigantic'), null);
});

test('isUpgrade allows moving to a heavier type', () => {
  assert.equal(isUpgrade('fix', 'feature-m'), true);
  assert.equal(isUpgrade('bug', 'feature-s'), true);
});

test('isUpgrade rejects moving to a lighter type', () => {
  assert.equal(isUpgrade('feature-m', 'fix'), false);
});

test('isUpgrade rejects staying the same', () => {
  assert.equal(isUpgrade('bug', 'bug'), false);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/task-types.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết lib/task-types.mjs**

```javascript
export const TASK_TYPES = ['fix', 'bug', 'feature-s', 'feature-m', 'feature-l'];

export const LAYERS = ['Happy', 'Validation', 'Error', 'Edge', 'Security', 'Performance'];

const RULES = {
  'fix':       { minTests: 2,  requiredLayers: ['Happy'],
                 gates: ['spec', 'test'] },
  'bug':       { minTests: 6,  requiredLayers: ['Happy', 'Validation', 'Error', 'Edge'],
                 gates: ['spec', 'test'] },
  'feature-s': { minTests: 13, requiredLayers: ['Happy', 'Validation', 'Error', 'Edge', 'Security'],
                 gates: ['spec', 'test', 'convention'] },
  'feature-m': { minTests: 21, requiredLayers: LAYERS,
                 gates: ['spec', 'test', 'convention', 'review'] },
  'feature-l': { minTests: 30, requiredLayers: LAYERS,
                 gates: ['spec', 'test', 'convention', 'review'] },
};

export function rulesFor(type) {
  return RULES[type] ?? null;
}

export function isUpgrade(from, to) {
  const a = TASK_TYPES.indexOf(from);
  const b = TASK_TYPES.indexOf(to);
  if (a === -1 || b === -1) return false;
  return b > a;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test test/task-types.test.mjs`
Expected: PASS — 9 test

- [ ] **Step 5: Commit**

```bash
git add lib/task-types.mjs test/task-types.test.mjs
git commit -m "feat: add task type rules table"
```

---

## Task 4: Đọc và kiểm tra config

**Files:**
- Create: `lib/config.mjs`
- Test: `test/config.test.mjs`

**Interfaces:**
- Consumes: `configPath` từ `lib/paths.mjs`
- Produces:
  - `loadConfig(root: string): {ok: true, config: object} | {ok: false, errors: string[]}`
  - `DEFAULT_CONFIG: object` — dùng bởi `init` khi tạo config lần đầu

Cấu trúc config GĐ 1 (một repo; multi-repo để GĐ 4):

```json
{
  "test": "npm test",
  "lint": "npm run lint",
  "testReporter": "tap"
}
```

`test` là trường bắt buộc duy nhất. `testReporter` nhận `"tap"` hoặc `"plain"`; mặc định `"tap"`.

- [ ] **Step 1: Viết test thất bại**

Tạo `test/config.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config.mjs';

function makeRoot(configText) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cfg-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), configText);
  return root;
}

test('loadConfig accepts a config with a test command', () => {
  const root = makeRoot('{"test": "npm test"}');
  const result = loadConfig(root);
  assert.equal(result.ok, true);
  assert.equal(result.config.test, 'npm test');
});

test('loadConfig defaults testReporter to tap', () => {
  const root = makeRoot('{"test": "npm test"}');
  assert.equal(loadConfig(root).config.testReporter, 'tap');
});

test('loadConfig rejects a config without a test command', () => {
  const root = makeRoot('{}');
  const result = loadConfig(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('test')));
});

test('loadConfig rejects malformed JSON', () => {
  const root = makeRoot('{ not json');
  const result = loadConfig(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('JSON')));
});

test('loadConfig rejects an unknown testReporter', () => {
  const root = makeRoot('{"test": "npm test", "testReporter": "xml"}');
  const result = loadConfig(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('testReporter')));
});

test('DEFAULT_CONFIG carries a test command', () => {
  assert.equal(typeof DEFAULT_CONFIG.test, 'string');
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/config.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết lib/config.mjs**

```javascript
import { existsSync, readFileSync } from 'node:fs';
import { configPath } from './paths.mjs';

export const DEFAULT_CONFIG = {
  test: 'npm test',
  testReporter: 'tap',
};

const REPORTERS = ['tap', 'plain'];

export function loadConfig(root) {
  const file = configPath(root);
  if (!existsSync(file)) {
    return { ok: false, errors: [`Không tìm thấy config: ${file}`] };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`config.json không phải JSON hợp lệ: ${err.message}`] };
  }

  const errors = [];
  if (typeof raw.test !== 'string' || raw.test.trim() === '') {
    errors.push('config.json thiếu trường "test" (lệnh chạy test)');
  }
  const reporter = raw.testReporter ?? 'tap';
  if (!REPORTERS.includes(reporter)) {
    errors.push(`testReporter phải là một trong: ${REPORTERS.join(', ')}`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, config: { ...raw, testReporter: reporter } };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test test/config.test.mjs`
Expected: PASS — 6 test

- [ ] **Step 5: Commit**

```bash
git add lib/config.mjs test/config.test.mjs
git commit -m "feat: add config loading and validation"
```

---

## Task 5: Parse spec.md

**Files:**
- Create: `lib/spec-parser.mjs`
- Test: `test/spec-parser.test.mjs`

**Interfaces:**
- Consumes: (không)
- Produces:
  - `parseSpec(markdown: string): {taskId, title, type, scope, sections: Map<string,string>, testCases: TestCase[]}`
  - `TestCase = {id: string, layer: string, description: string, expected: string, priority: string}`

Parser đọc:
- Dòng `# <taskId>: <title>`
- Dòng `Loại: <type>`
- Dòng `Phạm vi: <scope>`
- Các heading `## <tên>` → nội dung vào `sections`
- Bảng dưới `## Test cases` → mảng `testCases` (bỏ qua dòng header và dòng phân cách `|---|`)

- [ ] **Step 1: Viết test thất bại**

Tạo `test/spec-parser.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../lib/spec-parser.mjs';

const SAMPLE = `# T-001: Thêm bộ lọc theo quốc gia
Loại: feature-s
Phạm vi: nexus-app-backend/src/modules/mastercontact

## Mục tiêu
Người dùng lọc contact theo quốc gia.

## Ràng buộc
Không đổi shape của response hiện tại.

## Rủi ro hồi quy
Trang Browse Members dùng chung endpoint này.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Lọc theo 1 quốc gia | Trả đúng danh sách | P0 |
| H2 | Happy | Lọc theo nhiều quốc gia | Trả hợp của các tập | P0 |
| V1 | Validation | Mã quốc gia không tồn tại | 400 kèm thông báo | P1 |
`;

test('parseSpec reads the task id and title', () => {
  const spec = parseSpec(SAMPLE);
  assert.equal(spec.taskId, 'T-001');
  assert.equal(spec.title, 'Thêm bộ lọc theo quốc gia');
});

test('parseSpec reads the task type', () => {
  assert.equal(parseSpec(SAMPLE).type, 'feature-s');
});

test('parseSpec reads the scope', () => {
  assert.equal(parseSpec(SAMPLE).scope, 'nexus-app-backend/src/modules/mastercontact');
});

test('parseSpec collects named sections', () => {
  const spec = parseSpec(SAMPLE);
  assert.match(spec.sections.get('Mục tiêu'), /lọc contact theo quốc gia/);
  assert.match(spec.sections.get('Rủi ro hồi quy'), /Browse Members/);
});

test('parseSpec extracts every test case row', () => {
  const cases = parseSpec(SAMPLE).testCases;
  assert.equal(cases.length, 3);
  assert.deepEqual(cases.map((c) => c.id), ['H1', 'H2', 'V1']);
});

test('parseSpec keeps each test case field', () => {
  const first = parseSpec(SAMPLE).testCases[0];
  assert.equal(first.id, 'H1');
  assert.equal(first.layer, 'Happy');
  assert.equal(first.description, 'Lọc theo 1 quốc gia');
  assert.equal(first.expected, 'Trả đúng danh sách');
  assert.equal(first.priority, 'P0');
});

test('parseSpec ignores the table separator row', () => {
  const ids = parseSpec(SAMPLE).testCases.map((c) => c.id);
  assert.ok(!ids.some((id) => id.startsWith('--')));
});

test('parseSpec returns empty test cases when the table is absent', () => {
  const spec = parseSpec('# T-002: Không có bảng\nLoại: fix\n');
  assert.deepEqual(spec.testCases, []);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/spec-parser.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết lib/spec-parser.mjs**

```javascript
function splitRow(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function isSeparator(cells) {
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function parseSpec(markdown) {
  const lines = markdown.split(/\r?\n/);

  let taskId = '';
  let title = '';
  let type = '';
  let scope = '';
  const sections = new Map();
  const testCases = [];

  let currentSection = null;
  let buffer = [];
  let inTestTable = false;

  const flush = () => {
    if (currentSection !== null) {
      sections.set(currentSection, buffer.join('\n').trim());
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading1 = line.match(/^#\s+([^:]+):\s*(.+)$/);
    if (heading1) {
      taskId = heading1[1].trim();
      title = heading1[2].trim();
      continue;
    }

    const heading2 = line.match(/^##\s+(.+)$/);
    if (heading2) {
      flush();
      currentSection = heading2[1].trim();
      inTestTable = currentSection === 'Test cases';
      continue;
    }

    if (currentSection === null) {
      const typeLine = line.match(/^Loại:\s*(.+)$/);
      if (typeLine) { type = typeLine[1].trim(); continue; }
      const scopeLine = line.match(/^Phạm vi:\s*(.+)$/);
      if (scopeLine) { scope = scopeLine[1].trim(); continue; }
    }

    if (inTestTable && line.trim().startsWith('|')) {
      const cells = splitRow(line);
      if (cells.length >= 5 && !isSeparator(cells) && cells[0] !== 'ID') {
        testCases.push({
          id: cells[0],
          layer: cells[1],
          description: cells[2],
          expected: cells[3],
          priority: cells[4],
        });
      }
      continue;
    }

    buffer.push(line);
  }
  flush();

  return { taskId, title, type, scope, sections, testCases };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test test/spec-parser.test.mjs`
Expected: PASS — 8 test

- [ ] **Step 5: Commit**

```bash
git add lib/spec-parser.mjs test/spec-parser.test.mjs
git commit -m "feat: add spec markdown parser"
```

---

## Task 6: Kiểm tra spec hợp lệ

**Files:**
- Create: `lib/spec-validator.mjs`
- Test: `test/spec-validator.test.mjs`

**Interfaces:**
- Consumes: `parseSpec` (Task 5), `rulesFor`/`TASK_TYPES`/`LAYERS` (Task 3)
- Produces:
  - `validateSpec(markdown: string): {ok: boolean, errors: string[], warnings: string[]}`

Kiểm theo spec §6.3:
1. Loại task phải nằm trong `TASK_TYPES`
2. Không còn `TBD`/`TODO` bất kỳ đâu
3. Mục `Rủi ro hồi quy` không được trống
4. Đủ số test case tối thiểu theo loại
5. Đủ các lớp bắt buộc theo loại
6. Mỗi test case phải có ID, mô tả, và kỳ vọng không trống
7. ID không trùng nhau

- [ ] **Step 1: Viết test thất bại**

Tạo `test/spec-validator.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../lib/spec-validator.mjs';

function buildSpec({ type = 'fix', regression = 'Không có', rows = [] } = {}) {
  const table = rows.length
    ? ['| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
       '|----|-----|-------|---------|---------|',
       ...rows].join('\n')
    : '';
  return `# T-001: Tiêu đề
Loại: ${type}
Phạm vi: src/

## Mục tiêu
Làm gì đó.

## Ràng buộc
Không có.

## Rủi ro hồi quy
${regression}

## Test cases
${table}
`;
}

const happy = (n) => `| H${n} | Happy | Mô tả ${n} | Kỳ vọng ${n} | P0 |`;

test('validateSpec accepts a minimal valid fix spec', () => {
  const result = validateSpec(buildSpec({ type: 'fix', rows: [happy(1), happy(2)] }));
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('validateSpec rejects an unknown task type', () => {
  const result = validateSpec(buildSpec({ type: 'huge', rows: [happy(1), happy(2)] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Loại')));
});

test('validateSpec rejects leftover TBD markers', () => {
  const spec = buildSpec({ type: 'fix', regression: 'TBD', rows: [happy(1), happy(2)] });
  const result = validateSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('TBD')));
});

test('validateSpec rejects an empty regression section', () => {
  const result = validateSpec(buildSpec({ type: 'fix', regression: '', rows: [happy(1), happy(2)] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('hồi quy')));
});

test('validateSpec rejects too few test cases', () => {
  const result = validateSpec(buildSpec({ type: 'fix', rows: [happy(1)] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('tối thiểu')));
});

test('validateSpec rejects a spec missing a required layer', () => {
  const rows = Array.from({ length: 6 }, (_, i) => happy(i + 1));
  const result = validateSpec(buildSpec({ type: 'bug', rows }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Validation')));
});

test('validateSpec rejects duplicate test case ids', () => {
  const result = validateSpec(buildSpec({ type: 'fix', rows: [happy(1), happy(1)] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('trùng')));
});

test('validateSpec rejects a test case with an empty expectation', () => {
  const rows = [happy(1), '| H2 | Happy | Có mô tả |  | P0 |'];
  const result = validateSpec(buildSpec({ type: 'fix', rows }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('H2')));
});

test('validateSpec reports every problem at once', () => {
  const result = validateSpec(buildSpec({ type: 'huge', regression: '', rows: [] }));
  assert.ok(result.errors.length >= 3);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/spec-validator.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết lib/spec-validator.mjs**

```javascript
import { parseSpec } from './spec-parser.mjs';
import { rulesFor, TASK_TYPES } from './task-types.mjs';

const PLACEHOLDERS = /\b(TBD|TODO|FIXME|XXX)\b/;

export function validateSpec(markdown) {
  const spec = parseSpec(markdown);
  const errors = [];
  const warnings = [];

  const rules = rulesFor(spec.type);
  if (!rules) {
    errors.push(`Loại task không hợp lệ: "${spec.type}". Phải là một trong: ${TASK_TYPES.join(', ')}`);
  }

  if (PLACEHOLDERS.test(markdown)) {
    errors.push('Spec còn placeholder (TBD/TODO/FIXME/XXX) — phải điền hết trước khi duyệt');
  }

  const regression = (spec.sections.get('Rủi ro hồi quy') ?? '').trim();
  if (regression === '') {
    errors.push('Mục "Rủi ro hồi quy" đang trống — bắt buộc phải điền');
  }

  const seen = new Set();
  for (const c of spec.testCases) {
    if (seen.has(c.id)) errors.push(`Test case ID bị trùng: ${c.id}`);
    seen.add(c.id);
    if (c.description === '') errors.push(`Test case ${c.id} thiếu mô tả`);
    if (c.expected === '') errors.push(`Test case ${c.id} thiếu kỳ vọng`);
  }

  if (rules) {
    if (spec.testCases.length < rules.minTests) {
      errors.push(
        `Loại "${spec.type}" cần tối thiểu ${rules.minTests} test cases, hiện có ${spec.testCases.length}`
      );
    }
    const layers = new Set(spec.testCases.map((c) => c.layer));
    for (const layer of rules.requiredLayers) {
      if (!layers.has(layer)) {
        errors.push(`Thiếu lớp test bắt buộc cho loại "${spec.type}": ${layer}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test test/spec-validator.test.mjs`
Expected: PASS — 9 test

- [ ] **Step 5: Commit**

```bash
git add lib/spec-validator.mjs test/spec-validator.test.mjs
git commit -m "feat: add spec validation rules"
```

---

## Task 7: Lưu trữ gate record

**Files:**
- Create: `lib/gate-store.mjs`
- Test: `test/gate-store.test.mjs`

**Interfaces:**
- Consumes: `gatePath`/`evidenceDir` (Task 1), `getSalt`/`signRecord`/`verifyRecord` (Task 2)
- Produces:
  - `writeGate(root, taskId, record): object` — thêm `sig`, ghi vào `gate.json`, trả record đã ký
  - `readGates(root, taskId): object` — map `{gateName: record}`; trả `{}` nếu chưa có file
  - `readGate(root, taskId, gateName): object | null`
  - `verifyAllGates(root, taskId): {ok: boolean, tampered: string[]}`

`gate.json` là một object, key là tên gate — mỗi lần chạy lại một gate thì ghi đè bản ghi cũ.

- [ ] **Step 1: Viết test thất bại**

Tạo `test/gate-store.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeGate, readGates, readGate, verifyAllGates } from '../lib/gate-store.mjs';
import { gatePath } from '../lib/paths.mjs';

function makeTask() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-gate-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{"test":"npm test"}');
  return root;
}

test('writeGate stores a signed record', () => {
  const root = makeTask();
  const record = writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  assert.match(record.sig, /^sha256:[0-9a-f]{64}$/);
});

test('readGate returns a stored record', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  assert.equal(readGate(root, 'T-1', 'test').exitCode, 0);
});

test('readGate returns null for an unknown gate', () => {
  const root = makeTask();
  assert.equal(readGate(root, 'T-1', 'never-ran'), null);
});

test('readGates returns an empty object before any gate runs', () => {
  const root = makeTask();
  assert.deepEqual(readGates(root, 'T-1'), {});
});

test('writeGate keeps records for other gates', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'spec', exitCode: 0 });
  writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  const gates = readGates(root, 'T-1');
  assert.deepEqual(Object.keys(gates).sort(), ['spec', 'test']);
});

test('writeGate overwrites a rerun of the same gate', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'test', exitCode: 1 });
  writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  assert.equal(readGate(root, 'T-1', 'test').exitCode, 0);
});

test('verifyAllGates passes for untouched records', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'spec', exitCode: 0 });
  writeGate(root, 'T-1', { gate: 'test', exitCode: 0 });
  assert.deepEqual(verifyAllGates(root, 'T-1'), { ok: true, tampered: [] });
});

test('verifyAllGates detects a hand-edited exitCode', () => {
  const root = makeTask();
  writeGate(root, 'T-1', { gate: 'test', exitCode: 1 });
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.test.exitCode = 0;
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = verifyAllGates(root, 'T-1');
  assert.equal(result.ok, false);
  assert.deepEqual(result.tampered, ['test']);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/gate-store.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết lib/gate-store.mjs**

```javascript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gatePath, evidenceDir } from './paths.mjs';
import { getSalt, signRecord, verifyRecord } from './signature.mjs';

export function readGates(root, taskId) {
  const file = gatePath(root, taskId);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function readGate(root, taskId, gateName) {
  return readGates(root, taskId)[gateName] ?? null;
}

export function writeGate(root, taskId, record) {
  const dir = evidenceDir(root, taskId);
  mkdirSync(dir, { recursive: true });

  const salt = getSalt(root);
  const signed = { ...record, sig: signRecord(record, salt) };

  const gates = readGates(root, taskId);
  gates[record.gate] = signed;
  writeFileSync(gatePath(root, taskId), JSON.stringify(gates, null, 2));

  return signed;
}

export function verifyAllGates(root, taskId) {
  const salt = getSalt(root);
  const gates = readGates(root, taskId);
  const tampered = Object.entries(gates)
    .filter(([, record]) => !verifyRecord(record, salt))
    .map(([name]) => name);
  return { ok: tampered.length === 0, tampered };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test test/gate-store.test.mjs`
Expected: PASS — 8 test

- [ ] **Step 5: Commit**

```bash
git add lib/gate-store.mjs test/gate-store.test.mjs
git commit -m "feat: add signed gate record store"
```

---

## Task 8: Trích test ID từ output

**Files:**
- Create: `lib/test-parser.mjs`
- Test: `test/test-parser.test.mjs`

**Interfaces:**
- Consumes: (không)
- Produces:
  - `extractRanIds(output: string, knownIds: string[]): string[]` — tìm ID nào xuất hiện trong tên test đã chạy
  - `compareWithSpec(specIds: string[], ranIds: string[]): {missing: string[], extra: string[], ok: boolean}`

**Vì sao không parse TAP chặt chẽ:** mỗi framework in một kiểu. Cách bền hơn là quét toàn bộ output tìm ID có ranh giới từ (`\bH1\b`). Đánh đổi: nếu ID xuất hiện trong output vì lý do khác (ví dụ tên file) sẽ tính nhầm là đã chạy. Chấp nhận được ở GĐ 1 — GĐ sau có thể đọc JSON reporter.

- [ ] **Step 1: Viết test thất bại**

Tạo `test/test-parser.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRanIds, compareWithSpec } from '../lib/test-parser.mjs';

const TAP_OUTPUT = `
TAP version 13
ok 1 - test_H1_filters by a single country
ok 2 - test_H2_filters by multiple countries
not ok 3 - test_V1_rejects an unknown country code
1..3
`;

test('extractRanIds finds ids present in test names', () => {
  const ran = extractRanIds(TAP_OUTPUT, ['H1', 'H2', 'V1', 'V2']);
  assert.deepEqual(ran.sort(), ['H1', 'H2', 'V1']);
});

test('extractRanIds omits ids that never appear', () => {
  const ran = extractRanIds(TAP_OUTPUT, ['H1', 'S1']);
  assert.ok(!ran.includes('S1'));
});

test('extractRanIds respects word boundaries', () => {
  const output = 'ok 1 - test_H10_something';
  assert.deepEqual(extractRanIds(output, ['H1']), []);
});

test('extractRanIds returns each id once', () => {
  const output = 'ok 1 - test_H1_a\nok 2 - test_H1_b';
  assert.deepEqual(extractRanIds(output, ['H1']), ['H1']);
});

test('compareWithSpec reports ids the run never covered', () => {
  const result = compareWithSpec(['H1', 'H2', 'V1'], ['H1', 'H2']);
  assert.deepEqual(result.missing, ['V1']);
  assert.equal(result.ok, false);
});

test('compareWithSpec reports ids not declared in the spec', () => {
  const result = compareWithSpec(['H1'], ['H1', 'Z9']);
  assert.deepEqual(result.extra, ['Z9']);
});

test('compareWithSpec passes when every spec id ran', () => {
  const result = compareWithSpec(['H1', 'H2'], ['H1', 'H2']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('compareWithSpec tolerates extra ids as long as none are missing', () => {
  const result = compareWithSpec(['H1'], ['H1', 'H2']);
  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/test-parser.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết lib/test-parser.mjs**

```javascript
function escapeForRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractRanIds(output, knownIds) {
  const found = new Set();
  for (const id of knownIds) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeForRegex(id)}([^A-Za-z0-9]|$)`, 'm');
    if (pattern.test(output)) found.add(id);
  }
  return [...found];
}

export function compareWithSpec(specIds, ranIds) {
  const ran = new Set(ranIds);
  const spec = new Set(specIds);
  const missing = specIds.filter((id) => !ran.has(id));
  const extra = ranIds.filter((id) => !spec.has(id));
  return { missing, extra, ok: missing.length === 0 };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test test/test-parser.test.mjs`
Expected: PASS — 8 test

- [ ] **Step 5: Commit**

```bash
git add lib/test-parser.mjs test/test-parser.test.mjs
git commit -m "feat: add test id extraction and spec comparison"
```

---

## Task 9: Chạy test command

**Files:**
- Create: `lib/test-runner.mjs`
- Test: `test/test-runner.test.mjs`

**Interfaces:**
- Consumes: (không)
- Produces:
  - `runCommand(command: string, cwd: string): {exitCode: number, output: string, durationMs: number}`

Dùng `spawnSync` với `shell: true` để lệnh trong config (`npm test`, `pnpm vitest run`) chạy đúng như gõ tay. Gộp stdout và stderr vào một chuỗi — evidence cần cả hai.

- [ ] **Step 1: Viết test thất bại**

Tạo `test/test-runner.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { runCommand } from '../lib/test-runner.mjs';

test('runCommand reports exit code 0 for a successful command', () => {
  const result = runCommand('node -e "process.exit(0)"', tmpdir());
  assert.equal(result.exitCode, 0);
});

test('runCommand reports a non-zero exit code', () => {
  const result = runCommand('node -e "process.exit(3)"', tmpdir());
  assert.equal(result.exitCode, 3);
});

test('runCommand captures stdout', () => {
  const result = runCommand('node -e "console.log(\'from stdout\')"', tmpdir());
  assert.match(result.output, /from stdout/);
});

test('runCommand captures stderr', () => {
  const result = runCommand('node -e "console.error(\'from stderr\')"', tmpdir());
  assert.match(result.output, /from stderr/);
});

test('runCommand measures duration', () => {
  const result = runCommand('node -e "process.exit(0)"', tmpdir());
  assert.equal(typeof result.durationMs, 'number');
  assert.ok(result.durationMs >= 0);
});

test('runCommand reports a non-zero code for a missing binary', () => {
  const result = runCommand('definitely-not-a-real-command-xyz', tmpdir());
  assert.notEqual(result.exitCode, 0);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/test-runner.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết lib/test-runner.mjs**

```javascript
import { spawnSync } from 'node:child_process';

export function runCommand(command, cwd) {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const output = stderr ? `${stdout}\n${stderr}` : stdout;

  let exitCode = result.status;
  if (exitCode === null || exitCode === undefined) exitCode = 1;

  return { exitCode, output, durationMs };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test test/test-runner.test.mjs`
Expected: PASS — 6 test

- [ ] **Step 5: Commit**

```bash
git add lib/test-runner.mjs test/test-runner.test.mjs
git commit -m "feat: add command runner capturing exit code and output"
```

---

## Task 10: Định dạng output

**Files:**
- Create: `lib/report.mjs`
- Test: `test/report.test.mjs`

**Interfaces:**
- Consumes: (không)
- Produces:
  - `pass(gate: string, detail?: string): string`
  - `fail(gate: string, lines: string[]): string`
  - `info(text: string): string`
  - `hint(text: string): string` — dòng gợi ý bước tiếp theo, có tiền tố `→`

Không màu mè ANSI ở GĐ 1 — một số terminal Windows hiển thị lộn xộn, và output còn được ghi vào file log.

- [ ] **Step 1: Viết test thất bại**

Tạo `test/report.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pass, fail, info, hint } from '../lib/report.mjs';

test('pass marks the gate name with a check', () => {
  assert.match(pass('test'), /✓/);
  assert.match(pass('test'), /test/);
});

test('pass appends optional detail', () => {
  assert.match(pass('test', '21/21 cases'), /21\/21 cases/);
});

test('fail marks the gate name with a cross', () => {
  assert.match(fail('test', []), /✗/);
});

test('fail lists every detail line', () => {
  const text = fail('test', ['thiếu EC3', 'thiếu S2']);
  assert.match(text, /thiếu EC3/);
  assert.match(text, /thiếu S2/);
});

test('hint prefixes the arrow marker', () => {
  assert.match(hint('chạy compass spec'), /→/);
});

test('info returns the text unchanged in content', () => {
  assert.match(info('đang chạy'), /đang chạy/);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/report.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết lib/report.mjs**

```javascript
export function pass(gate, detail = '') {
  return detail ? `✓ Gate ${gate} PASSED — ${detail}` : `✓ Gate ${gate} PASSED`;
}

export function fail(gate, lines = []) {
  const body = lines.map((line) => `  ${line}`).join('\n');
  return body ? `✗ Gate ${gate} FAILED\n${body}` : `✗ Gate ${gate} FAILED`;
}

export function info(text) {
  return text;
}

export function hint(text) {
  return `→ ${text}`;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test test/report.test.mjs`
Expected: PASS — 6 test

- [ ] **Step 5: Commit**

```bash
git add lib/report.mjs test/report.test.mjs
git commit -m "feat: add terminal report formatting"
```

---

## Task 11: Template spec và lệnh init

**Files:**
- Create: `templates/spec.md`
- Create: `commands/init.mjs`
- Create: `cli.mjs`
- Test: `test/init.test.mjs`

**Interfaces:**
- Consumes: `findRoot`/`taskDir`/`specPath`/`configPath` (Task 1), `TASK_TYPES`/`rulesFor` (Task 3), `DEFAULT_CONFIG` (Task 4), `pass`/`fail`/`hint` (Task 10)
- Produces:
  - `initCommand({cwd, taskId, type}): {exitCode: number, output: string}`
  - `cli.mjs` — entry point, dispatch theo `argv[2]`

`init` tạo `.compass/config.json` nếu chưa có (bootstrap lần đầu), rồi tạo thư mục task + `spec.md` từ template với `{{taskId}}`, `{{type}}`, `{{minTests}}`, `{{layers}}` đã thay.

- [ ] **Step 1: Tạo templates/spec.md**

```markdown
# {{taskId}}: <tiêu đề ngắn>
Loại: {{type}}
Phạm vi: <file/module sẽ đụng>

## Mục tiêu
<1-3 câu. Xong nghĩa là gì.>

## Ràng buộc
<không đổi API / backward compatible / theo ADR-002... — ghi "Không có" nếu thật sự không có>

## Rủi ro hồi quy
<tính năng cũ nào có thể vỡ — BẮT BUỘC, không được để trống>

## Test cases
<Loại "{{type}}" cần tối thiểu {{minTests}} test cases, đủ các lớp: {{layers}}>

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 |  |  |  | P0 |
```

- [ ] **Step 2: Viết test thất bại**

Tạo `test/init.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initCommand } from '../commands/init.mjs';

const makeDir = () => mkdtempSync(path.join(tmpdir(), 'compass-init-'));

test('initCommand bootstraps config.json on first run', () => {
  const cwd = makeDir();
  const result = initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  assert.equal(result.exitCode, 0);
  assert.ok(existsSync(path.join(cwd, '.compass', 'config.json')));
});

test('initCommand creates the task spec file', () => {
  const cwd = makeDir();
  initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  assert.ok(existsSync(path.join(cwd, '.compass', 'T-1', 'spec.md')));
});

test('initCommand fills the template placeholders', () => {
  const cwd = makeDir();
  initCommand({ cwd, taskId: 'T-42', type: 'feature-m' });
  const spec = readFileSync(path.join(cwd, '.compass', 'T-42', 'spec.md'), 'utf8');
  assert.match(spec, /# T-42:/);
  assert.match(spec, /Loại: feature-m/);
  assert.match(spec, /tối thiểu 21 test cases/);
  assert.ok(!spec.includes('{{'));
});

test('initCommand rejects an unknown task type', () => {
  const cwd = makeDir();
  const result = initCommand({ cwd, taskId: 'T-1', type: 'gigantic' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Loại/);
});

test('initCommand rejects a missing task type', () => {
  const cwd = makeDir();
  const result = initCommand({ cwd, taskId: 'T-1', type: undefined });
  assert.equal(result.exitCode, 2);
});

test('initCommand refuses to overwrite an existing spec', () => {
  const cwd = makeDir();
  initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  const second = initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  assert.equal(second.exitCode, 2);
  assert.match(second.output, /đã tồn tại/);
});

test('initCommand reuses an existing config', () => {
  const cwd = makeDir();
  initCommand({ cwd, taskId: 'T-1', type: 'fix' });
  const before = readFileSync(path.join(cwd, '.compass', 'config.json'), 'utf8');
  initCommand({ cwd, taskId: 'T-2', type: 'fix' });
  const after = readFileSync(path.join(cwd, '.compass', 'config.json'), 'utf8');
  assert.equal(before, after);
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `node --test test/init.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 4: Viết commands/init.mjs**

```javascript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, compassDir, taskDir, specPath, configPath } from '../lib/paths.mjs';
import { TASK_TYPES, rulesFor } from '../lib/task-types.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';
import { hint } from '../lib/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(here, '..', 'templates', 'spec.md');

export function initCommand({ cwd, taskId, type }) {
  if (!taskId) {
    return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass init <id> --type=<loại>' };
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

  const root = findRoot(cwd) ?? cwd;
  mkdirSync(compassDir(root), { recursive: true });
  if (!existsSync(configPath(root))) {
    writeFileSync(configPath(root), JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

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

  return {
    exitCode: 0,
    output: [
      `Đã tạo task ${taskId} (loại ${type})`,
      `  spec: ${spec}`,
      '',
      hint('Điền spec, rồi chạy: compass spec ' + taskId),
    ].join('\n'),
  };
}
```

- [ ] **Step 5: Viết cli.mjs**

```javascript
#!/usr/bin/env node
import { initCommand } from './commands/init.mjs';

const USAGE = `compass — quy trình có bằng chứng

Dùng:
  compass init <id> --type=<fix|bug|feature-s|feature-m|feature-l>
  compass spec <id>
  compass test <id>
  compass check <id>
  compass done <id>
  compass status <id>
`;

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) flags[match[1]] = match[2] ?? true;
    else rest.push(arg);
  }
  return { flags, rest };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const { flags, rest } = parseFlags(args);
  const cwd = process.cwd();
  const taskId = rest[0];

  let result;
  switch (command) {
    case 'init':
      result = initCommand({ cwd, taskId, type: flags.type });
      break;
    default:
      result = { exitCode: 2, output: USAGE };
  }

  if (result.output) console.log(result.output);
  process.exitCode = result.exitCode;
}

main();
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `node --test test/init.test.mjs`
Expected: PASS — 7 test

- [ ] **Step 7: Thử tay để xác nhận CLI chạy**

```bash
node cli.mjs init T-999 --type=fix
```
Expected: in ra "Đã tạo task T-999 (loại fix)" và tạo `.compass/T-999/spec.md`

Dọn sau khi thử: `rm -rf .compass`

- [ ] **Step 8: Commit**

```bash
git add templates/spec.md commands/init.mjs cli.mjs test/init.test.mjs
git commit -m "feat: add init command and CLI entry point"
```

---

## Task 12: Lệnh spec

**Files:**
- Create: `commands/spec.mjs`
- Modify: `cli.mjs` (thêm nhánh `spec`)
- Test: `test/spec-command.test.mjs`

**Interfaces:**
- Consumes: `findRoot`/`specPath` (Task 1), `validateSpec` (Task 6), `writeGate` (Task 7), `hashFile` (Task 2), `pass`/`fail`/`hint` (Task 10)
- Produces:
  - `specCommand({cwd, taskId}): {exitCode: number, output: string}`

Gate record ghi kèm `specHash` — các gate sau đối chiếu để phát hiện spec bị sửa sau khi duyệt.

- [ ] **Step 1: Viết test thất bại**

Tạo `test/spec-command.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { specCommand } from '../commands/spec.mjs';
import { readGate } from '../lib/gate-store.mjs';

const VALID_SPEC = `# T-1: Tiêu đề
Loại: fix
Phạm vi: src/

## Mục tiêu
Làm gì đó.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có vùng nào bị ảnh hưởng.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Trường hợp chính | Trả về đúng | P0 |
| H2 | Happy | Trường hợp chính 2 | Trả về đúng | P0 |
`;

function makeTask(specText) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-speccmd-'));
  mkdirSync(path.join(root, '.compass', 'T-1'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{"test":"npm test"}');
  if (specText !== null) {
    writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), specText);
  }
  return root;
}

test('specCommand passes a valid spec', () => {
  const root = makeTask(VALID_SPEC);
  const result = specCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /✓/);
});

test('specCommand records a signed gate on pass', () => {
  const root = makeTask(VALID_SPEC);
  specCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'spec');
  assert.equal(gate.exitCode, 0);
  assert.match(gate.specHash, /^sha256:/);
});

test('specCommand fails an invalid spec and lists reasons', () => {
  const root = makeTask(VALID_SPEC.replace('Không có vùng nào bị ảnh hưởng.', ''));
  const result = specCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /hồi quy/);
});

test('specCommand records the failure too', () => {
  const root = makeTask(VALID_SPEC.replace('| H2 | Happy | Trường hợp chính 2 | Trả về đúng | P0 |', ''));
  specCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(readGate(root, 'T-1', 'spec').exitCode, 1);
});

test('specCommand reports a missing spec file', () => {
  const root = makeTask(null);
  const result = specCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không tìm thấy spec/);
});

test('specCommand reports a missing task id', () => {
  const root = makeTask(VALID_SPEC);
  const result = specCommand({ cwd: root, taskId: undefined });
  assert.equal(result.exitCode, 2);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/spec-command.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết commands/spec.mjs**

```javascript
import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath } from '../lib/paths.mjs';
import { validateSpec } from '../lib/spec-validator.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

export function specCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass spec <id>' };

  const root = findRoot(cwd);
  if (!root) {
    return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.\nChạy: compass init <id> --type=<loại>' };
  }

  const file = specPath(root, taskId);
  if (!existsSync(file)) {
    return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };
  }

  const markdown = readFileSync(file, 'utf8');
  const result = validateSpec(markdown);

  writeGate(root, taskId, {
    gate: 'spec',
    exitCode: result.ok ? 0 : 1,
    checkedAt: new Date().toISOString(),
    specHash: hashFile(file),
    errorCount: result.errors.length,
  });

  if (!result.ok) {
    return {
      exitCode: 1,
      output: [fail('spec', result.errors), '', hint('Sửa spec rồi chạy lại: compass spec ' + taskId)].join('\n'),
    };
  }

  return {
    exitCode: 0,
    output: [
      pass('spec'),
      '',
      hint('Đưa spec cho người duyệt. Duyệt xong mới bắt đầu code.'),
    ].join('\n'),
  };
}
```

- [ ] **Step 4: Thêm nhánh spec vào cli.mjs**

Trong `cli.mjs`, thêm import và nhánh switch:

```javascript
import { specCommand } from './commands/spec.mjs';
```

```javascript
    case 'spec':
      result = specCommand({ cwd, taskId });
      break;
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `node --test test/spec-command.test.mjs`
Expected: PASS — 6 test

- [ ] **Step 6: Commit**

```bash
git add commands/spec.mjs cli.mjs test/spec-command.test.mjs
git commit -m "feat: add spec gate command"
```

---

## Task 13: Lệnh test

**Files:**
- Create: `commands/test.mjs`
- Modify: `cli.mjs` (thêm nhánh `test`)
- Test: `test/test-command.test.mjs`

**Interfaces:**
- Consumes: `findRoot`/`specPath`/`evidenceDir` (Task 1), `loadConfig` (Task 4), `parseSpec` (Task 5), `runCommand` (Task 9), `extractRanIds`/`compareWithSpec` (Task 8), `writeGate` (Task 7), `hashFile` (Task 2), `pass`/`fail`/`hint` (Task 10)
- Produces:
  - `testCommand({cwd, taskId}): {exitCode: number, output: string}`

Gate fail khi **một trong hai**: lệnh test trả exit code khác 0, **hoặc** có test case trong spec không tìm thấy dấu vết đã chạy. Output đầy đủ ghi vào `evidence/test.log`.

- [ ] **Step 1: Viết test thất bại**

Tạo `test/test-command.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testCommand } from '../commands/test.mjs';
import { readGate } from '../lib/gate-store.mjs';

const SPEC = `# T-1: Tiêu đề
Loại: fix
Phạm vi: src/

## Mục tiêu
Làm gì đó.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

function makeTask(testCmd) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-testcmd-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'),
    JSON.stringify({ test: testCmd }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  return root;
}

const printBoth = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\')"';
const printOne  = 'node -e "console.log(\'ok 1 - test_H1_a\')"';
const failing   = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\'); process.exit(1)"';

test('testCommand passes when the suite is green and every id ran', () => {
  const root = makeTask(printBoth);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('testCommand fails when the suite exits non-zero', () => {
  const root = makeTask(failing);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /exit code/i);
});

test('testCommand fails when a spec id never ran', () => {
  const root = makeTask(printOne);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /H2/);
});

test('testCommand names every missing id', () => {
  const root = makeTask('node -e "console.log(\'nothing here\')"');
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.match(result.output, /H1/);
  assert.match(result.output, /H2/);
});

test('testCommand writes the full output to evidence', () => {
  const root = makeTask(printBoth);
  testCommand({ cwd: root, taskId: 'T-1' });
  const log = path.join(root, '.compass', 'T-1', 'evidence', 'test.log');
  assert.ok(existsSync(log));
  assert.match(readFileSync(log, 'utf8'), /test_H1_a/);
});

test('testCommand records the command and exit code in the gate', () => {
  const root = makeTask(printBoth);
  testCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'test');
  assert.equal(gate.exitCode, 0);
  assert.equal(gate.command, printBoth);
  assert.match(gate.outputHash, /^sha256:/);
});

test('testCommand reports an invalid config', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-testcmd-bad-'));
  mkdirSync(path.join(root, '.compass', 'T-1'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), '{}');
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  const result = testCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /config/);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/test-command.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết commands/test.mjs**

```javascript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, evidenceDir } from '../lib/paths.mjs';
import { loadConfig } from '../lib/config.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { runCommand } from '../lib/test-runner.mjs';
import { extractRanIds, compareWithSpec } from '../lib/test-parser.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile, sha256 } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

export function testCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass test <id>' };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const cfg = loadConfig(root);
  if (!cfg.ok) return { exitCode: 2, output: cfg.errors.join('\n') };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const specIds = spec.testCases.map((c) => c.id);

  const run = runCommand(cfg.config.test, root);

  const dir = evidenceDir(root, taskId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'test.log'), run.output);

  const ranIds = extractRanIds(run.output, specIds);
  const comparison = compareWithSpec(specIds, ranIds);

  const suiteOk = run.exitCode === 0;
  const ok = suiteOk && comparison.ok;

  writeGate(root, taskId, {
    gate: 'test',
    command: cfg.config.test,
    exitCode: ok ? 0 : 1,
    suiteExitCode: run.exitCode,
    startedAt: new Date(Date.now() - run.durationMs).toISOString(),
    durationMs: run.durationMs,
    outputHash: sha256(run.output),
    outputFile: 'evidence/test.log',
    specHash: hashFile(file),
    specIdCount: specIds.length,
    ranIdCount: ranIds.length,
    missingIds: comparison.missing,
  });

  if (ok) {
    return {
      exitCode: 0,
      output: pass('test', `${ranIds.length}/${specIds.length} test cases đã chạy`),
    };
  }

  const lines = [];
  if (!suiteOk) {
    lines.push(`Test suite trả về exit code ${run.exitCode}.`);
    lines.push(`Xem output đầy đủ: ${path.join('.compass', taskId, 'evidence', 'test.log')}`);
  }
  if (!comparison.ok) {
    lines.push(`Spec khai báo ${specIds.length} test cases, chỉ tìm thấy ${ranIds.length} đã chạy.`);
    lines.push(`Thiếu: ${comparison.missing.join(', ')}`);
  }

  return {
    exitCode: 1,
    output: [
      fail('test', lines),
      '',
      hint('Viết test cho các case còn thiếu, hoặc sửa spec nếu chúng không còn cần thiết (sửa spec cần duyệt lại).'),
    ].join('\n'),
  };
}
```

- [ ] **Step 4: Thêm nhánh test vào cli.mjs**

```javascript
import { testCommand } from './commands/test.mjs';
```

```javascript
    case 'test':
      result = testCommand({ cwd, taskId });
      break;
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `node --test test/test-command.test.mjs`
Expected: PASS — 7 test

- [ ] **Step 6: Commit**

```bash
git add commands/test.mjs cli.mjs test/test-command.test.mjs
git commit -m "feat: add test gate command with spec id reconciliation"
```

---

## Task 14: Lệnh check, done và status

**Files:**
- Create: `commands/check.mjs`
- Create: `commands/done.mjs`
- Create: `commands/status.mjs`
- Modify: `cli.mjs` (thêm ba nhánh)
- Test: `test/check-done.test.mjs`

**Interfaces:**
- Consumes: `findRoot`/`specPath` (Task 1), `parseSpec` (Task 5), `rulesFor` (Task 3), `specCommand` (Task 12), `testCommand` (Task 13), `readGates`/`verifyAllGates` (Task 7), `hashFile` (Task 2), `pass`/`fail`/`hint`/`info` (Task 10)
- Produces:
  - `checkCommand({cwd, taskId, only}): {exitCode: number, output: string}`
  - `doneCommand({cwd, taskId}): {exitCode: number, output: string}`
  - `statusCommand({cwd, taskId}): {exitCode: number, output: string}`

`check` chạy các gate áp dụng cho loại task, theo thứ tự rẻ trước, **dừng ngay khi fail**. GĐ 1 mới có `spec` và `test`; gate chưa cài (`convention`, `review`) được báo là bỏ qua, không tính fail.

`done` kiểm ba điều: mọi gate bắt buộc đã chạy · mọi gate exit 0 · mọi chữ ký còn nguyên. Thêm một kiểm nữa: `specHash` trong gate `test` phải khớp spec hiện tại — bắt được trường hợp sửa spec sau khi test đã chạy.

- [ ] **Step 1: Viết test thất bại**

Tạo `test/check-done.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkCommand } from '../commands/check.mjs';
import { doneCommand } from '../commands/done.mjs';
import { statusCommand } from '../commands/status.mjs';
import { gatePath } from '../lib/paths.mjs';

const SPEC = `# T-1: Tiêu đề
Loại: fix
Phạm vi: src/

## Mục tiêu
Làm gì đó.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

const GREEN = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\')"';
const RED   = 'node -e "console.log(\'ok 1 - test_H1_a\'); process.exit(1)"';

function makeTask(testCmd, specText = SPEC) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-check-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: testCmd }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), specText);
  return root;
}

test('checkCommand runs every applicable gate and passes', () => {
  const root = makeTask(GREEN);
  const result = checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /spec/);
  assert.match(result.output, /test/);
});

test('checkCommand stops at the first failing gate', () => {
  const badSpec = SPEC.replace('Không có.\n\n## Test cases', '\n\n## Test cases');
  const root = makeTask(GREEN, badSpec);
  const result = checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.ok(!result.output.includes('Gate test'));
});

test('checkCommand reports gates not yet implemented as skipped', () => {
  const root = makeTask(GREEN);
  const result = checkCommand({ cwd: root, taskId: 'T-1' });
  assert.doesNotMatch(result.output, /Gate convention FAILED/);
});

test('checkCommand honours --only', () => {
  const root = makeTask(RED);
  const result = checkCommand({ cwd: root, taskId: 'T-1', only: 'spec' });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, /Gate test/);
});

test('doneCommand passes after a clean check', () => {
  const root = makeTask(GREEN);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('doneCommand fails when a required gate never ran', () => {
  const root = makeTask(GREEN);
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /chưa chạy/);
});

test('doneCommand fails when a gate exited non-zero', () => {
  const root = makeTask(RED);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
});

test('doneCommand detects a hand-edited gate record', () => {
  const root = makeTask(RED);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.test.exitCode = 0;
  writeFileSync(file, JSON.stringify(data, null, 2));

  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /chữ ký/);
});

test('doneCommand detects a spec edited after the test gate ran', () => {
  const root = makeTask(GREEN);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const spec = path.join(root, '.compass', 'T-1', 'spec.md');
  writeFileSync(spec, SPEC + '\n<!-- sửa sau khi test đã chạy -->\n');
  const result = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Spec đã thay đổi/);
});

test('statusCommand lists gate state', () => {
  const root = makeTask(GREEN);
  checkCommand({ cwd: root, taskId: 'T-1' });
  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /spec/);
  assert.match(result.output, /test/);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test test/check-done.test.mjs`
Expected: FAIL — module không tồn tại

- [ ] **Step 3: Viết commands/check.mjs**

```javascript
import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { specCommand } from './spec.mjs';
import { testCommand } from './test.mjs';
import { info } from '../lib/report.mjs';

const IMPLEMENTED = {
  spec: specCommand,
  test: testCommand,
};

const ORDER = ['spec', 'convention', 'test', 'ui', 'visual', 'review'];

export function checkCommand({ cwd, taskId, only }) {
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

  let gates = ORDER.filter((g) => rules.gates.includes(g));
  if (only) gates = gates.filter((g) => g === only);

  const lines = [];
  const skipped = [];

  for (const gate of gates) {
    const run = IMPLEMENTED[gate];
    if (!run) { skipped.push(gate); continue; }

    const result = run({ cwd: root, taskId });
    lines.push(result.output);
    if (result.exitCode !== 0) {
      return { exitCode: result.exitCode, output: lines.join('\n') };
    }
  }

  if (skipped.length) {
    lines.push('', info(`Bỏ qua (chưa cài ở giai đoạn này): ${skipped.join(', ')}`));
  }

  return { exitCode: 0, output: lines.join('\n') };
}
```

- [ ] **Step 4: Viết commands/done.mjs**

```javascript
import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { readGates, verifyAllGates } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

const IMPLEMENTED_GATES = ['spec', 'test'];

export function doneCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass done <id>' };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const rules = rulesFor(spec.type);
  if (!rules) return { exitCode: 2, output: `Loại task không hợp lệ trong spec: "${spec.type}"` };

  const problems = [];

  const integrity = verifyAllGates(root, taskId);
  if (!integrity.ok) {
    problems.push(`Chữ ký không khớp ở gate: ${integrity.tampered.join(', ')} — bản ghi đã bị sửa tay.`);
  }

  const gates = readGates(root, taskId);
  const required = rules.gates.filter((g) => IMPLEMENTED_GATES.includes(g));

  for (const name of required) {
    const record = gates[name];
    if (!record) {
      problems.push(`Gate "${name}" chưa chạy.`);
      continue;
    }
    if (record.exitCode !== 0) {
      problems.push(`Gate "${name}" chưa pass (exit code ${record.exitCode}).`);
    }
  }

  const currentSpecHash = hashFile(file);
  for (const name of required) {
    const record = gates[name];
    if (record && record.specHash && record.specHash !== currentSpecHash) {
      problems.push(`Spec đã thay đổi sau khi gate "${name}" chạy — phải chạy lại và duyệt lại.`);
    }
  }

  if (problems.length) {
    return {
      exitCode: 1,
      output: [fail('done', problems), '', hint('Chạy: compass check ' + taskId)].join('\n'),
    };
  }

  return {
    exitCode: 0,
    output: [
      pass('done', `${required.length} gate đã pass`),
      '',
      `Task ${taskId} hoàn thành. Bằng chứng: .compass/${taskId}/evidence/`,
    ].join('\n'),
  };
}
```

- [ ] **Step 5: Viết commands/status.mjs**

```javascript
import { existsSync, readFileSync } from 'node:fs';
import { findRoot, specPath } from '../lib/paths.mjs';
import { parseSpec } from '../lib/spec-parser.mjs';
import { rulesFor } from '../lib/task-types.mjs';
import { readGates, verifyAllGates } from '../lib/gate-store.mjs';

const IMPLEMENTED_GATES = ['spec', 'test'];

export function statusCommand({ cwd, taskId }) {
  if (!taskId) return { exitCode: 2, output: 'Thiếu task id.\nDùng: compass status <id>' };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = specPath(root, taskId);
  if (!existsSync(file)) return { exitCode: 2, output: `Không tìm thấy spec: ${file}` };

  const spec = parseSpec(readFileSync(file, 'utf8'));
  const rules = rulesFor(spec.type);
  const gates = readGates(root, taskId);
  const integrity = verifyAllGates(root, taskId);

  const lines = [
    `Task ${taskId} — ${spec.title}`,
    `Loại: ${spec.type}   Test cases trong spec: ${spec.testCases.length}`,
    '',
  ];

  for (const name of rules?.gates ?? []) {
    const record = gates[name];
    let state;
    if (!IMPLEMENTED_GATES.includes(name)) state = '– chưa cài ở giai đoạn này';
    else if (!record) state = '· chưa chạy';
    else if (record.exitCode === 0) state = '✓ pass';
    else state = '✗ fail';
    lines.push(`  ${name.padEnd(12)} ${state}`);
  }

  if (!integrity.ok) {
    lines.push('', `⚠ Chữ ký không khớp: ${integrity.tampered.join(', ')}`);
  }

  return { exitCode: 0, output: lines.join('\n') };
}
```

- [ ] **Step 6: Thêm ba nhánh vào cli.mjs**

```javascript
import { checkCommand } from './commands/check.mjs';
import { doneCommand } from './commands/done.mjs';
import { statusCommand } from './commands/status.mjs';
```

```javascript
    case 'check':
      result = checkCommand({ cwd, taskId, only: flags.only });
      break;
    case 'done':
      result = doneCommand({ cwd, taskId });
      break;
    case 'status':
      result = statusCommand({ cwd, taskId });
      break;
```

- [ ] **Step 7: Chạy test, xác nhận pass**

Run: `node --test test/check-done.test.mjs`
Expected: PASS — 10 test

- [ ] **Step 8: Chạy toàn bộ test suite**

Run: `npm test`
Expected: PASS — tất cả test của mọi task

- [ ] **Step 9: Commit**

```bash
git add commands/check.mjs commands/done.mjs commands/status.mjs cli.mjs test/check-done.test.mjs
git commit -m "feat: add check, done and status commands"
```

---

## Task 15: Test tích hợp đầu-cuối

**Files:**
- Create: `test/integration.test.mjs`

**Interfaces:**
- Consumes: `cli.mjs` (chạy qua `spawnSync`, không import)
- Produces: (không — đây là test)

Test này chạy CLI thật như người dùng gõ, xác nhận exit code đúng. Nó bắt được lỗi mà unit test bỏ sót: dispatch sai, exit code không được set, import vòng.

- [ ] **Step 1: Viết test tích hợp**

Tạo `test/integration.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

function compass(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

const FILLED_SPEC = `# T-1: Thêm bộ lọc
Loại: fix
Phạm vi: src/

## Mục tiêu
Lọc được theo quốc gia.

## Ràng buộc
Không đổi response shape.

## Rủi ro hồi quy
Trang Browse Members dùng chung endpoint.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Lọc một quốc gia | Trả đúng danh sách | P0 |
| H2 | Happy | Lọc nhiều quốc gia | Trả hợp các tập | P0 |
`;

const GREEN = 'node -e "console.log(\'ok 1 - test_H1_a\'); console.log(\'ok 2 - test_H2_b\')"';

test('a full happy path runs from init to done', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));

  const init = compass(cwd, ['init', 'T-1', '--type=fix']);
  assert.equal(init.status, 0, init.stdout + init.stderr);

  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T-1', 'spec.md'), FILLED_SPEC);

  const check = compass(cwd, ['check', 'T-1']);
  assert.equal(check.status, 0, check.stdout + check.stderr);

  const done = compass(cwd, ['done', 'T-1']);
  assert.equal(done.status, 0, done.stdout + done.stderr);
});

test('done refuses a task whose gates never ran', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));
  compass(cwd, ['init', 'T-1', '--type=fix']);
  writeFileSync(path.join(cwd, '.compass', 'T-1', 'spec.md'), FILLED_SPEC);

  const done = compass(cwd, ['done', 'T-1']);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /chưa chạy/);
});

test('spec gate rejects the untouched template', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));
  compass(cwd, ['init', 'T-1', '--type=fix']);

  const spec = compass(cwd, ['spec', 'T-1']);
  assert.equal(spec.status, 1);
});

test('an unknown command exits with a usage error', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));
  const result = compass(cwd, ['nonsense']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /compass init/);
});

test('done refuses after a gate record is hand-edited', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'compass-e2e-'));
  compass(cwd, ['init', 'T-1', '--type=fix']);
  writeFileSync(path.join(cwd, '.compass', 'config.json'), JSON.stringify({ test: GREEN }));
  writeFileSync(path.join(cwd, '.compass', 'T-1', 'spec.md'), FILLED_SPEC);
  compass(cwd, ['check', 'T-1']);

  const gateFile = path.join(cwd, '.compass', 'T-1', 'evidence', 'gate.json');
  const gates = JSON.parse(readFileSync(gateFile, 'utf8'));
  gates.test.durationMs = 1;
  writeFileSync(gateFile, JSON.stringify(gates, null, 2));

  const done = compass(cwd, ['done', 'T-1']);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /chữ ký/);
});
```

- [ ] **Step 2: Chạy test tích hợp**

Run: `node --test test/integration.test.mjs`
Expected: PASS — 5 test

- [ ] **Step 3: Chạy toàn bộ suite**

Run: `npm test`
Expected: PASS — toàn bộ

- [ ] **Step 4: Commit**

```bash
git add test/integration.test.mjs
git commit -m "test: add end-to-end CLI integration tests"
```

---

## Task 16: SKILL.md

**Files:**
- Create: `SKILL.md`
- Create: `README.md`

**Interfaces:**
- Consumes: (không — tài liệu)
- Produces: (không)

SKILL.md là thứ dán vào AI. Nội dung theo spec §6, rút gọn cho phạm vi GĐ 1 — không nhắc các gate chưa cài (`ui`, `visual`, `convention`, `review`) như thể chúng đã chạy được, nhưng có nói rõ chúng thuộc giai đoạn sau.

- [ ] **Step 1: Viết SKILL.md**

```markdown
---
name: compass
description: Quy trình phát triển có bằng chứng — spec trước code, gate máy kiểm thay vì AI tự khai. Dùng khi bắt đầu bất kỳ task lập trình nào trong dự án có .compass/.
---

# Compass

Quy trình làm việc có bằng chứng kiểm chứng được. La bàn không đi thay bạn — nó đảm bảo bạn không lạc.

## Luật tối cao

1. **Không bao giờ tự tuyên bố kết quả.** Chỉ `compass` mới phán pass/fail.
2. **Không sửa gì trong `evidence/`.** Đó là vùng của máy.
3. **Spec trước code.** Không có spec đã duyệt thì không gõ dòng code nào.
4. **Nghi ngờ độ lớn task → nâng cấp.** Không bao giờ hạ cấp.
5. **Knowledge base mâu thuẫn với code → DỪNG, hỏi người.** Không tự chọn bên.

## Ngôn ngữ

- Đối thoại, giải thích, báo cáo với người → **tiếng Việt**
- Spec, test name, commit message, code comment → **tiếng Anh**

### Quy tắc diễn đạt tiếng Việt

**Cấm:**
- Dịch code thành lời (*"gọi hàm X để lấy Y rồi trả về Z"*)
- Hán-Việt nặng khi có từ thuần Việt: "thực hiện việc kiểm tra" → "kiểm tra"
- Câu bị động kiểu Tây: "dữ liệu được xử lý bởi service" → "service xử lý dữ liệu"
- Dịch thuật ngữ đã quen: giữ nguyên *token, cache, race condition, deadlock*

**Bắt buộc:**
- Kể theo **dòng chảy dữ liệu**, không theo thứ tự file
- Nói cái quan trọng trước — đọc 3 câu đầu vẫn nắm được ý chính
- **Chỉ ra chỗ đáng ngờ** — giả định ngầm, nhánh không xử lý, chỗ dễ vỡ
- Ví dụ cụ thể thay vì mô tả trừu tượng
- Sơ đồ khi có từ 4 bước trở lên

## Vòng đời task

```
compass init <id> --type=<loại>     tạo spec skeleton
     ↓  bạn viết spec
compass spec <id>                   gate: spec hợp lệ?
     ↓  NGƯỜI DUYỆT ← dừng ở đây, chờ người nói tiếp
     ↓  bạn viết code + test
compass check <id>                  chạy mọi gate áp dụng
     ↓
compass done <id>                   cổng cuối
```

## Phân loại task

| Loại | Dùng khi | Test tối thiểu | Lớp bắt buộc |
|---|---|---|---|
| `fix` | typo, 1-2 dòng, không đổi hành vi | 2 | Happy |
| `bug` | sửa lỗi có nguyên nhân rõ | 6 | Happy, Validation, Error, Edge |
| `feature-s` | tính năng nhỏ, 1 module | 13 | + Security |
| `feature-m` | tính năng vừa, nhiều module | 21 | cả 6 lớp |
| `feature-l` | tính năng lớn, cross-repo | 30 | cả 6 lớp |

Sáu lớp: Happy · Validation · Error · Edge · Security · Performance

Nghi ngờ giữa hai loại → **chọn cái nặng hơn**.

## Bước 1 — Định hướng

Trước khi viết gì:

1. Đọc code thật của vùng sẽ sửa
2. Nếu dự án có `.knowledge/index.md` → đọc bản đồ, rồi chỉ nạp mảnh liên quan
3. Không nuốt cả thư mục docs vào context

*Knowledge base cho biết **ở đâu** và **tại sao**. Code cho biết **thực tế là gì**. Khi lệch nhau, code thắng về sự thật — nhưng phải báo người, không tự sửa docs.*

## Bước 2 — Spec

```
compass init <id> --type=<loại>
```

Điền vào `.compass/<id>/spec.md`. Mọi mục đều bắt buộc, đặc biệt **Rủi ro hồi quy** — nghĩ xem tính năng cũ nào có thể vỡ.

Test case phải có ID (`H1`, `V1`, `E1`, `EC1`, `S1`, `P1`), mô tả, và kỳ vọng **đo được**. "Hoạt động đúng" không phải kỳ vọng đo được.

```
compass spec <id>
```

Pass → **dừng lại, đưa người duyệt**. Đây là điểm dừng bắt buộc duy nhất. Không tự đi tiếp.

## Bước 3 — Implement

- Mỗi test case trong spec = một test function, **tên bắt đầu bằng ID**: `test_H1_filters_by_country`
- Viết test trước, chạy thấy nó đỏ, rồi mới implement
- KHÔNG test implementation detail: state nội bộ, snapshot lớn, mock chính mình
- FE: query bằng role/text người dùng thấy, không bằng test-id nội bộ
- Phát hiện task lớn hơn dự tính → sửa `Loại:` trong spec, chạy lại `compass spec`, xin duyệt lại

## Bước 4 — Verify

```
compass check <id>
```

Chạy các gate áp dụng, dừng ngay khi fail. Gate `test` không chỉ xem suite xanh — nó còn đối chiếu **mọi test ID trong spec đã thực sự chạy chưa**.

Fail → sửa → chạy lại. Không bỏ qua, không giải thích vòng vo.

## Bước 5 — Đóng task

```
compass done <id>
```

Exit 0 mới được báo hoàn thành. Dán output của lệnh này khi báo cáo.

## Giai đoạn hiện tại

GĐ 1 có gate `spec` và `test`. Các gate `convention`, `ui`, `visual`, `review` thuộc giai đoạn sau — `check` sẽ báo chúng là bỏ qua, không tính fail.

## Red Flags

| Bạn nghĩ | Thực tế |
|---|---|
| "Task nhỏ, bỏ spec cho nhanh" | Nhỏ = spec ngắn, không phải không có spec |
| "Test pass rồi, chắc compass cũng pass" | Chưa chạy thì chưa biết gì cả |
| "Docs lỗi thời chút không sao" | Docs lỗi thời = quyết định dựa trên thông tin sai |
| "Screenshot trông giống rồi" | Trông giống không phải bằng chứng. Đo số. |
| "Còn 1 test fail nhưng không liên quan" | Fail là fail |
| "Tôi sẽ sửa gate.json cho nhanh" | Chữ ký sẽ lộ. Và đó là gian lận. |
| "Người duyệt chắc sẽ đồng ý thôi" | Chờ họ nói. Đoán ý là bỏ qua checkpoint. |
```

- [ ] **Step 2: Viết README.md**

```markdown
# Compass

Quy trình phát triển có bằng chứng kiểm chứng được — cho AI có tool.

## Vấn đề

AI báo "xong" khi chưa xong. Không phải vì nói dối — vì nó thật sự tin thế.
Quy trình viết bằng tài liệu thì AI đọc rồi phớt lờ được. Quy trình viết bằng
exit code thì không.

## Cài

```bash
npm install -g .
```

Hoặc chạy trực tiếp: `node cli.mjs <lệnh>`

## Dùng

```bash
compass init T-001 --type=feature-s   # tạo spec skeleton
# điền .compass/T-001/spec.md
compass spec T-001                     # kiểm spec hợp lệ
# người duyệt → viết code + test
compass check T-001                    # chạy mọi gate
compass done T-001                     # cổng cuối
```

## Cấu hình

`.compass/config.json`:

```json
{
  "test": "npm test"
}
```

`test` là lệnh chạy test suite của dự án — Compass tự spawn nó, tự bắt exit code.

## Nguyên tắc

| | AI | Compass |
|---|---|---|
| Viết spec, code, test | ✅ | ❌ |
| Chạy test, đo, kiểm | ❌ | ✅ |
| Ghi bằng chứng | ❌ | ✅ |
| Phán pass/fail | ❌ | ✅ |

Gate record có chữ ký — sửa tay là lộ.

## Trạng thái

GĐ 1: gate `spec` và `test`.
GĐ 2-4: `convention`, `ui`, `visual`, `review`, knowledge base, điều tra, multi-repo.

Thiết kế đầy đủ: [docs/superpowers/specs/2026-09-05-compass-design.md](docs/superpowers/specs/2026-09-05-compass-design.md)
```

- [ ] **Step 3: Chạy toàn bộ test lần cuối**

Run: `npm test`
Expected: PASS — toàn bộ

- [ ] **Step 4: Commit**

```bash
git add SKILL.md README.md
git commit -m "docs: add SKILL.md and README"
```

---

## Task 17: Chạy thử trên task thật

**Files:**
- Không tạo file nguồn — đây là bước kiểm nghiệm thực tế

**Interfaces:**
- Consumes: toàn bộ CLI đã xây
- Produces: báo cáo quan sát để quyết định điều chỉnh GĐ 2

Spec §14 nêu 5 rủi ro chưa kiểm chứng. Task này đo chúng trên một task thật.

- [ ] **Step 1: Chọn một task nhỏ có thật ở dự án Nexus**

Chọn một `fix` hoặc `bug` nhỏ ở `nexus-app-backend`. Ghi lại: task là gì, ước lượng bao lâu nếu làm tay không có Compass.

- [ ] **Step 2: Cài Compass vào repo đó**

```bash
cd <đường-dẫn-tới-nexus-app-backend>
node <đường-dẫn-compass>/cli.mjs init NX-001 --type=bug
```

Sửa `.compass/config.json` cho khớp lệnh test thật của repo (ví dụ `yarn test`).

- [ ] **Step 3: Chạy trọn vòng đời**

Đi hết `spec` → duyệt → code + test → `check` → `done`. **Không bỏ qua bước nào**, kể cả khi thấy thừa.

- [ ] **Step 4: Ghi lại quan sát**

Tạo `docs/superpowers/notes/2026-09-XX-phase-1-trial.md` trả lời:

| Câu hỏi | Quan sát |
|---|---|
| Tổng thời gian so với ước lượng làm tay? | |
| Gate nào cản trở nhiều hơn giúp đỡ? | |
| Số test tối thiểu có hợp lý cho loại task này? | |
| Việc đối chiếu test ID có bắt được lỗi thật không? | |
| Chỗ nào trong SKILL.md gây hiểu nhầm? | |
| Có lúc nào muốn bỏ qua Compass? Vì sao? | |

- [ ] **Step 5: Commit ghi chú**

```bash
git add docs/superpowers/notes/
git commit -m "docs: record phase 1 trial observations"
```

- [ ] **Step 6: Quyết định điều chỉnh trước khi sang GĐ 2**

Dựa trên ghi chú, quyết định: giữ nguyên · nới số test tối thiểu · rút gọn bước cho loại `fix` · hoặc sửa cách diễn đạt trong SKILL.md.

---

## Kiểm tra bao phủ spec

| Spec § | Nội dung | Task |
|---|---|---|
| §3.1 | Phân vai AI / compass | 9, 13 (compass tự spawn, AI không truyền kết quả) |
| §3.2 | Cấu trúc thư mục `.compass/` | 1, 11 |
| §4.1 | Vòng đời BUILD | 11, 12, 13, 14 |
| §4.2 | Vòng đời INVESTIGATE | — GĐ 4 |
| §5 | Bảng loại task + số test tối thiểu | 3 |
| §5 | Nguyên tắc một chiều (`isUpgrade`) | 3 |
| §6.1 | Luật tối cao | 16 |
| §6.2 | Bước định hướng | 16 |
| §6.3 | Template spec + gate `spec` | 11, 12 |
| §6.4 | Luật implement | 16 |
| §6.5 | Quy tắc tiếng Việt | 16 |
| §6.6 | Red Flags | 16 |
| §7.1 | Lệnh CLI | 11, 12, 13, 14 |
| §7.2 | Gate record + chữ ký | 2, 7 |
| §7.2 | Bịt cửa lách (sửa gate.json, sửa spec) | 7, 14 |
| §7.3 | Gate `test` đối chiếu spec | 8, 13 |
| §7.4 | Gate `ui` | — GĐ 2 |
| §7.5 | Gate `review` | — GĐ 4 |
| §7.6 | `check` rẻ trước đắt sau, dừng khi fail | 14 |
| §8 | Knowledge base | — GĐ 3 |
| §9 | Thư viện script | — GĐ 4 |
| §10 | Multi-repo | — GĐ 4 |
| §14 | Kiểm chứng rủi ro | 17 |

Phần chưa phủ đều thuộc GĐ 2-4 theo lộ trình spec §13 — đúng phạm vi GĐ 1.

**Một sai lệch có chủ ý so với spec §7.2:** gate record GĐ 1 chưa có `sourceHash` và `configHash`.
Lý do: cả hai cần định nghĩa "cây nguồn" của dự án đích, mà điều đó phụ thuộc `.gitignore` và cấu
trúc repo — chưa giải quyết gọn được ở bộ xương. Cửa lách "chạy test rồi sửa code sau" tạm để mở ở
GĐ 1; `specHash` đã bịt được cửa nguy hiểm hơn là "sửa spec cho khớp cái đã làm". Ghi lại ở Task 17
để quyết định cách xử lý ở GĐ 2.
