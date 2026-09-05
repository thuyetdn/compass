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

test('mutating rulesFor result does not affect later calls', () => {
  const result1 = rulesFor('bug');
  result1.minTests = 999;
  const result2 = rulesFor('bug');
  assert.equal(result2.minTests, 6);
});

test('mutating requiredLayers does not affect later calls or LAYERS constant', () => {
  const result = rulesFor('feature-m');
  result.requiredLayers.push('Corrupted');

  const result2 = rulesFor('feature-m');
  assert.equal(result2.requiredLayers.length, 6);
  assert.deepEqual(result2.requiredLayers, LAYERS);

  assert.equal(LAYERS.length, 6);
  assert.deepEqual(LAYERS, ['Happy', 'Validation', 'Error', 'Edge', 'Security', 'Performance']);
});

test('successive calls to rulesFor return different object and array references', () => {
  const result1 = rulesFor('feature-m');
  const result2 = rulesFor('feature-m');

  assert.ok(result1 !== result2);
  assert.ok(result1.requiredLayers !== result2.requiredLayers);
  assert.deepEqual(result1.requiredLayers, result2.requiredLayers);
});
