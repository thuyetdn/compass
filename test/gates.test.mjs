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

test('isImplemented answers for both a built and an unbuilt gate', () => {
  assert.equal(isImplemented('test'), true);
  assert.equal(isImplemented('review'), false);
});
