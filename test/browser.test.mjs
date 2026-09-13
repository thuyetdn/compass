import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findPlaywright, buildMeasureScript, pairResults } from '../lib/browser.mjs';

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

// ---- CP-41: hai element chung selector, mỗi cái nhận đúng kết quả của mình ----

function runScript(script, node, values) {
  // Chạy script như trình duyệt: document trả node (hoặc null), getComputedStyle trả values.
  return new Function('document', 'getComputedStyle', `return ${script}`)(
    { querySelector: () => node },
    () => ({ getPropertyValue: (p) => values[p] ?? '' }),
  );
}

test('CP-41-H1 two elements sharing a selector each keep their own result', () => {
  const elements = [
    { name: 'Nút màu', selector: '.btn', properties: { color: '#fff' } },
    { name: 'Nút đệm', selector: '.btn', properties: { 'padding-left': '20px' } },
  ];
  const results = [
    { selector: '.btn', found: true, values: { color: 'rgb(255, 255, 255)' } },
    { selector: '.btn', found: true, values: { 'padding-left': '20px' } },
  ];
  const pairs = pairResults(elements, results);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].element.name, 'Nút màu');
  assert.equal(pairs[0].result.values.color, 'rgb(255, 255, 255)');
  assert.equal(pairs[1].element.name, 'Nút đệm');
  assert.equal(pairs[1].result.values['padding-left'], '20px');
});

test('CP-41-H2 distinct selectors pair element i with result i', () => {
  const elements = [
    { name: 'A', selector: '.a', properties: { color: '#000' } },
    { name: 'B', selector: '.b', properties: { color: '#111' } },
  ];
  const results = [
    { selector: '.a', found: true, values: { color: 'a' } },
    { selector: '.b', found: true, values: { color: 'b' } },
  ];
  const pairs = pairResults(elements, results);
  assert.equal(pairs[0].result.values.color, 'a');
  assert.equal(pairs[1].result.values.color, 'b');
});

test('CP-41-V1 the measure script emits one entry per element even when selectors repeat', () => {
  const script = buildMeasureScript([
    { selector: '.btn', properties: { color: '#fff' } },
    { selector: '.btn', properties: { 'padding-left': '20px' } },
  ]);
  const results = runScript(script, {}, { color: 'white', 'padding-left': '20px' });
  assert.equal(results.length, 2, 'không được gộp selector trùng');
  assert.deepEqual(Object.keys(results[0].values), ['color']);
  assert.deepEqual(Object.keys(results[1].values), ['padding-left']);
});

test('CP-41-E1 a result list shorter than the elements marks the rest as unmeasured, without throwing', () => {
  const elements = [
    { name: 'A', selector: '.a', properties: { color: '#000' } },
    { name: 'B', selector: '.b', properties: { color: '#111' } },
  ];
  const pairs = pairResults(elements, [{ selector: '.a', found: true, values: { color: 'a' } }]);
  assert.equal(pairs[0].result.values.color, 'a');
  assert.equal(pairs[1].result, null);
  assert.equal(pairs[1].element.name, 'B');
});

test('CP-41-E2 a results value that is not an array marks every element as unmeasured', () => {
  const elements = [{ name: 'A', selector: '.a', properties: { color: '#000' } }];
  for (const bad of [null, undefined, 'oops', { selector: '.a' }]) {
    const pairs = pairResults(elements, bad);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].result, null, `results=${JSON.stringify(bad)}`);
  }
});

test('CP-41-EC1 the same selector and the same property in two elements are compared independently', () => {
  const elements = [
    { name: 'Nút chính', selector: '.btn', properties: { color: '#fff' } },
    { name: 'Nút phụ', selector: '.btn', properties: { color: '#000' } },
  ];
  const results = [
    { selector: '.btn', found: true, values: { color: 'first' } },
    { selector: '.btn', found: true, values: { color: 'second' } },
  ];
  const pairs = pairResults(elements, results);
  assert.equal(pairs[0].result.values.color, 'first');
  assert.equal(pairs[1].result.values.color, 'second');
  assert.equal(pairs[0].element.properties.color, '#fff');
  assert.equal(pairs[1].element.properties.color, '#000');
});

test('CP-41-EC2 a selector absent from the page keeps found:false through pairing', () => {
  const elements = [{ name: 'Ma', selector: '.khong-co', properties: { color: '#000' } }];
  const script = buildMeasureScript(elements);
  const results = runScript(script, null, {});
  const pairs = pairResults(elements, results);
  assert.notEqual(pairs[0].result, null, 'có kết quả, chỉ là không tìm thấy');
  assert.equal(pairs[0].result.found, false);
});
