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
