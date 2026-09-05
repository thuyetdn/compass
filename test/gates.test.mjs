import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPLEMENTED_GATES, GATE_ORDER, isImplemented } from '../lib/gates.mjs';
import { TASK_TYPES, rulesFor } from '../lib/task-types.mjs';

test('every implemented gate appears in the run order', () => {
  for (const gate of IMPLEMENTED_GATES) {
    assert.ok(GATE_ORDER.includes(gate), `${gate} thiếu trong GATE_ORDER`);
  }
});

// The bug this module exists to prevent: a gate a task type asks for that the
// order never runs, so it silently never fires.
test('every gate any task type requires appears in the run order', () => {
  for (const type of TASK_TYPES) {
    for (const gate of rulesFor(type).gates) {
      assert.ok(GATE_ORDER.includes(gate), `${type} cần gate ${gate}, thiếu trong GATE_ORDER`);
    }
  }
});

test('the run order puts spec before test', () => {
  assert.ok(GATE_ORDER.indexOf('spec') < GATE_ORDER.indexOf('test'));
});

test('the run order puts convention before test — cheap gates run first', () => {
  assert.ok(GATE_ORDER.indexOf('convention') < GATE_ORDER.indexOf('test'));
});

test('the run order puts review last — it costs the most', () => {
  assert.equal(GATE_ORDER[GATE_ORDER.length - 1], 'review');
});

test('every gate in the run order is built — nothing is declared but missing', () => {
  for (const gate of GATE_ORDER) {
    assert.ok(isImplemented(gate), gate + ' nằm trong thứ tự chạy nhưng chưa cài');
  }
});

test('isImplemented says no to a gate that does not exist', () => {
  assert.equal(isImplemented('test'), true);
  assert.equal(isImplemented('khong-co-that'), false);
});

test('every gate that reads code is listed as source-dependent', async () => {
  const { SOURCE_DEPENDENT_GATES } = await import('../lib/gates.mjs');
  // spec and review judge documents, not the tree; everything else reads code.
  // Forgetting one lets done close a task on evidence about older code — this
  // has already shipped once, when knowledge was added.
  const readsCode = IMPLEMENTED_GATES.filter((g) => g !== 'spec' && g !== 'review');
  for (const gate of readsCode) {
    assert.ok(SOURCE_DEPENDENT_GATES.includes(gate),
      `${gate} đọc code nhưng không nằm trong SOURCE_DEPENDENT_GATES`);
  }
});

test('no gate is source-dependent without being implemented', async () => {
  const { SOURCE_DEPENDENT_GATES } = await import('../lib/gates.mjs');
  for (const gate of SOURCE_DEPENDENT_GATES) {
    assert.ok(IMPLEMENTED_GATES.includes(gate), `${gate} chưa cài mà đã bị đòi sourceHash`);
  }
});
