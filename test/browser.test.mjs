import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findPlaywright, buildMeasureScript } from '../lib/browser.mjs';

test('CP-8-E1 a project without playwright is told how to install it', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-pw-'));
  const result = await findPlaywright(root);
  assert.equal(result.ok, false);
  assert.match(result.reason, /playwright/i);
  assert.match(result.reason, /npm install/);
});

test('findPlaywright locates a playwright installed in the target project', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-pw-'));
  const dir = path.join(root, 'node_modules', 'playwright');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'playwright', version: '1.0.0', main: 'index.js',
  }));
  writeFileSync(path.join(dir, 'index.js'), 'module.exports = { chromium: {} };\n');

  const result = await findPlaywright(root);
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.module);
});

test('findPlaywright also accepts playwright-core', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-pw-'));
  const dir = path.join(root, 'node_modules', 'playwright-core');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'playwright-core', version: '1.0.0', main: 'index.js',
  }));
  writeFileSync(path.join(dir, 'index.js'), 'module.exports = { chromium: {} };\n');

  const result = await findPlaywright(root);
  assert.equal(result.ok, true, result.reason);
});

test('CP-4-P1 the measure script reads one selector once for every property', () => {
  const script = buildMeasureScript([
    { selector: 'h1', properties: { color: '#000', 'font-size': '32px' } },
  ]);
  // querySelector appears once per element, not once per property.
  const calls = script.match(/querySelector\(/g) ?? [];
  assert.equal(calls.length, 1);
});

test('CP-4-S1 a selector is embedded as data, never as code', () => {
  const nasty = `h1"); alert("pwned`;
  const script = buildMeasureScript([{ selector: nasty, properties: { color: '#000' } }]);
  // The selector must survive as a JSON string, so the quotes are escaped.
  assert.ok(script.includes(JSON.stringify(nasty)));
  assert.ok(!script.includes('alert("pwned")'));
});

test('the measure script asks for every property named in the contract', () => {
  const script = buildMeasureScript([
    { selector: 'h1', properties: { color: '#000', 'font-size': '32px' } },
  ]);
  assert.match(script, /"color"/);
  assert.match(script, /"font-size"/);
});

test('the measure script reports a missing element rather than throwing', () => {
  const script = buildMeasureScript([{ selector: '.nope', properties: { color: '#000' } }]);
  assert.match(script, /found/);
});
