import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withinBudget } from './helpers/timing.mjs';

// CP-85 — CP-82-P1 có ngân sách 20 giây thay vì 10: chạy riêng bản nháp mất chừng
// 3,5 giây, nhưng trong `npm test` song song nó lên 11–14 giây và làm đỏ gate `test`
// của mọi task. Hai test này giữ con số đó, và chứng minh nó vẫn bắt được bản chậm.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function p1Block() {
  const text = readFileSync(path.join(ROOT, 'test', 'convention-draft.test.mjs'), 'utf8');
  const start = text.indexOf("test('CP-82-P1");
  assert.ok(start >= 0, 'không thấy CP-82-P1');
  return text.slice(start, text.indexOf('\n});', start));
}

test('CP-85-H1 CP-82-P1 allows 20 s over two tries, on the same fixture', () => {
  const block = p1Block();
  assert.match(block, /^test\('CP-82-P1 [^']*within 20 s'/);
  assert.match(block, /budgetMs: 20_000, tries: 2/);
  assert.match(block, /manyFiles\(5000, big\)/);
  assert.match(block, /> 55_000_000/);
});

test('CP-85-H2 a draft that takes 25 s on both tries is still red', () => {
  let clock = 0;
  const now = () => clock;
  assert.throws(
    () => withinBudget({ run: () => { clock += 25_000; }, budgetMs: 20_000, tries: 2, now, label: 'draft' }),
    /vượt ngân sách 20000 ms ở cả 2 lần thử/,
  );
});
