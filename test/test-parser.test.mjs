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
