import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewCommand } from '../commands/review.mjs';
import { buildBrief, secretsPublicSection, briefSecretsPublic } from '../lib/review-brief.mjs';
import { parseSecretsPublic } from '../lib/secrets-scan.mjs';
import { playReviewer } from './helpers/review.mjs';

// CP-95 — brief cũ mà spec và diff còn y nguyên thì `review` chọn giữa hai câu: "danh
// sách secretsPublic đã đổi" hay "ngữ cảnh repo đã đổi". Nó chọn bằng cách đọc lại mục
// secretsPublic của brief cũ. Spec trích dòng `## Các file đã đổi`, hay brief cũ không
// đọc ra được mục đó, từng làm nó nói danh sách đổi trong khi không.

function put(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
function commit(dir, msg) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

// Spec trích nguyên mục "Các file đã đổi" của một brief, kèm dòng `---` sau nó.
const QUOTE = '\n\n## Các file đã đổi\n\n- x.js\n\n---\n\nhết trích dẫn';

const SPEC = (base, quote) => `# T-1: việc nhỏ
Loại: feature-s
Gốc soi: ${base}
Phạm vi: src/a.js

## Mục tiêu
Đổi a.${quote ? QUOTE : ''}

## Ràng buộc
Không.

## Rủi ro hồi quy
Không.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
`;

const config = (secretsPublic) => JSON.stringify(secretsPublic === undefined ? { test: 'true' } : { test: 'true', secretsPublic });

function repo({ secretsPublic, quote = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp95-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 'T']);
  git(root, ['config', 'core.autocrlf', 'false']);
  put(root, 'src/a.js', 'export const a = 1\n');
  put(root, '.compass/config.json', config(secretsPublic));
  const sha = commit(root, 'base');
  put(root, '.compass/T-1/spec.md', SPEC(sha, quote));
  put(root, 'src/a.js', 'export const a = 2\n');
  return root;
}

const review = (root) => reviewCommand({ cwd: root, taskId: 'T-1' });
const briefFile = (root) => path.join(root, '.compass', 'T-1', 'review-brief.md');

// Sửa brief đã lưu ở chỗ không phải spec, diff hay mục secretsPublic: đứng thay cho
// một mẫu brief Compass đã đổi, hay ngữ cảnh repo đã khác.
function editStoredBrief(root, from, to) {
  const text = readFileSync(briefFile(root), 'utf8');
  assert.ok(text.includes(from), `brief thiếu đoạn để sửa: ${from}`);
  writeFileSync(briefFile(root), text.replace(from, to));
}
const touchContext = (root) => editStoredBrief(root, 'Máy dò bằng regex', 'Máy dò (mẫu cũ) bằng regex');

function saysContextOnly(r) {
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /ngữ cảnh repo/);
  assert.doesNotMatch(r.output, /secretsPublic/);
}

test('CP-95-H1 phase two: a spec quoting the files heading does not make a context change read as a list change', () => {
  const root = repo({ secretsPublic: ['be/.env'] });
  assert.equal(playReviewer(root, 'T-1').exitCode, 0);
  touchContext(root);
  saysContextOnly(review(root));
});

test('CP-95-H2 phase one: a spec quoting the files heading does not make a context change read as a list change', () => {
  const root = repo({ secretsPublic: ['be/.env'] });
  assert.equal(review(root).exitCode, 1);
  touchContext(root);
  saysContextOnly(review(root));
});

test('CP-95-V1 the section is read after the spec block, not from a copy quoted inside it', () => {
  const real = secretsPublicSection(parseSecretsPublic(['real/.env']), { ok: true, paths: [] });
  const spec = `# T-1\n\n## Các file đã đổi\n\n- x.js\n\n---\n\n## File .env gate secrets không quét\n\n- \`fake/.env\` — **mới**\n\n---\n\nhết`;
  const text = buildBrief({ taskId: 'T-1', spec, diff: 'diff --git a/x b/x\n', files: ['x.js'], briefId: 'b', secretsPublic: real });
  const read = briefSecretsPublic(text);
  assert.equal(read, real);
  assert.doesNotMatch(read, /fake\/\.env/);
});

test('CP-95-E1 an old brief whose section cannot be read does not claim the list changed', () => {
  const root = repo({ quote: false });
  assert.equal(review(root).exitCode, 1);
  editStoredBrief(root, '\n## Các file đã đổi\n', '\n## Danh sách file\n');
  saysContextOnly(review(root));
});

test('CP-95-EC1 a real list change is still named when the spec quotes the files heading', () => {
  const root = repo({ secretsPublic: ['be/.env'] });
  assert.equal(playReviewer(root, 'T-1').exitCode, 0);
  put(root, '.compass/config.json', config(['be/.env', 'be/.env.alpha']));
  const r = review(root);
  assert.equal(r.exitCode, 1, r.output);
  assert.match(r.output, /secretsPublic[^\n]*đã đổi/);

  // Pha một cũng vậy.
  rmSync(path.join(root, '.compass', 'T-1', 'evidence', 'findings.json'));
  put(root, '.compass/config.json', config(['be/.env']));
  assert.match(review(root).output, /secretsPublic[^\n]*đã đổi — brief cũ/);
});

test('CP-95-EC2 a brief with no spec block has no readable section', () => {
  assert.equal(briefSecretsPublic('# brief\n\n## Các file đã đổi\n\n- a.js\n\n---\n\n## Ngữ cảnh do máy dò\n'), null);
});
