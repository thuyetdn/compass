import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CP-86 — ba chỗ chữ CP-84 để lại: một comment bị dán nhầm dòng code vào giữa, và
// hai lời tả `secrets` thiếu điều kiện "ngoài Phạm vi".

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('CP-86-H1 the comment above the rename prefix holds no code and names $1 and $&', () => {
  const lines = read('lib/review-brief.mjs').split('\n');
  const at = lines.findIndex((l) => /^\s*const diff = collected\.diff\.replace\(\/\^\(rename\|copy\)/.test(l));
  assert.ok(at > 0, 'không thấy dòng gắn tiền tố cho rename');
  const comments = [];
  for (let i = at - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i -= 1) comments.unshift(lines[i]);
  assert.ok(comments.length > 0);
  for (const c of comments) assert.doesNotMatch(c, /collected\.diff\.replace/, c);
  assert.ok(comments.some((c) => c.includes('`$1`') && c.includes('`$&`')), comments.join('\n'));
});

test('CP-86-H2 SKILL.md and secrets.mjs limit the uncommitted-only rule to repos outside Phạm vi', () => {
  const row = read('skills/compass/SKILL.md').split('\n').find((l) => l.startsWith('| `secrets` | Quét index'));
  assert.ok(row, 'không thấy dòng secrets trong bảng repo con');
  assert.match(row, /ngoài `Phạm vi`[^|]*chỉ góp thay đổi chưa commit/);
  const src = read('commands/secrets.mjs');
  assert.match(src, /Repo con ngoài Phạm vi mà không ai khai gốc soi chỉ góp thay/);
});
