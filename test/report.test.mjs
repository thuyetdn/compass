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
