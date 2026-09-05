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

test('extractRanIds finds ids on pass lines only', () => {
  const result = extractRanIds(TAP_OUTPUT, ['H1', 'H2', 'V1', 'V2']);
  assert.deepEqual(result.ran.sort(), ['H1', 'H2']);
  assert.deepEqual(result.seenOnNonPassLines, ['V1']);
});

test('extractRanIds omits ids that never appear', () => {
  const result = extractRanIds(TAP_OUTPUT, ['H1', 'S1']);
  assert.ok(!result.ran.includes('S1'));
  assert.ok(!result.seenOnNonPassLines.includes('S1'));
  assert.ok(!result.seenOnUnknownLines.includes('S1'));
});

test('extractRanIds respects word boundaries', () => {
  const output = 'ok 1 - test_H10_something';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, []);
});

test('extractRanIds returns each id once even on multiple pass lines', () => {
  const output = 'ok 1 - test_H1_a\nok 2 - test_H1_b';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, ['H1']);
});

test('extractRanIds: TAP ok line counts as ran', () => {
  const output = 'ok 1 - test_H1_a\nok 2 - test_H2_b';
  const result = extractRanIds(output, ['H1', 'H2']);
  assert.deepEqual(result.ran, ['H1', 'H2']);
  assert.deepEqual(result.seenOnNonPassLines, []);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: not ok line does NOT count as ran', () => {
  const output = 'not ok 2 - test_H2_b';
  const result = extractRanIds(output, ['H2']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, ['H2']);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: line with SKIP does NOT count as ran', () => {
  const output = 'ok 1 - test_H1_a # SKIP';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, ['H1']);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: ID in error message does NOT count as ran', () => {
  const output = 'Error in spec H2: cannot read file';
  const result = extractRanIds(output, ['H2']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, ['H2']);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: bare ID on unknown line does NOT count as ran', () => {
  const output = 'H1 H2';
  const result = extractRanIds(output, ['H1', 'H2']);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.seenOnNonPassLines, []);
  assert.deepEqual(result.seenOnUnknownLines, ['H1', 'H2']);
});

test('extractRanIds: checkmark marker counts as pass', () => {
  const output = '✔ test_H1_a\n✓ test_H2_b';
  const result = extractRanIds(output, ['H1', 'H2']);
  assert.deepEqual(result.ran, ['H1', 'H2']);
  assert.deepEqual(result.seenOnNonPassLines, []);
  assert.deepEqual(result.seenOnUnknownLines, []);
});

test('extractRanIds: ID on both pass and fail counts as ran', () => {
  const output = 'ok 1 - test_H1_a\nnot ok 1 - test_H1_a (retry)';
  const result = extractRanIds(output, ['H1']);
  assert.deepEqual(result.ran, ['H1']);
  assert.deepEqual(result.seenOnNonPassLines, ['H1']);
  assert.deepEqual(result.seenOnUnknownLines, []);
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
