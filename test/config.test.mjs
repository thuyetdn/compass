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

test('CP-23-H1 loadConfig không thêm testReporter vào config trả về', () => {
  const root = makeRoot('{"test": "npm test"}');
  const result = loadConfig(root);
  assert.equal(result.ok, true);
  // Trường không có trong file thì không được xuất hiện trong config trả về.
  // Compass tự bịa ra nó là cách trường chết sống lại.
  assert.ok(!('testReporter' in result.config), 'config trả về vẫn có testReporter');
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

test('CP-23-V1 config còn khai testReporter vẫn chạy được', () => {
  const root = makeRoot('{"test": "npm test", "testReporter": "tap"}');
  const result = loadConfig(root);
  // Bỏ một trường là thay đổi phá vỡ. Người đang dùng không được chặn giữa
  // chừng chỉ vì Compass dọn nhà.
  assert.equal(result.ok, true);
  assert.equal(result.config.test, 'npm test');
});

test('CP-23-E1 giá trị testReporter trước đây bị chặn giờ được lờ đi', () => {
  const root = makeRoot('{"test": "npm test", "testReporter": "xml"}');
  const result = loadConfig(root);
  assert.equal(result.ok, true);
  assert.ok(!result.errors, 'không được báo lỗi cho trường đã bỏ');
});

test('CP-23-E2 testReporter sai kiểu cũng không làm loadConfig ném', () => {
  for (const gt of ['[1,2]', '5', 'null', '{"a":1}']) {
    const root = makeRoot(`{"test": "npm test", "testReporter": ${gt}}`);
    const result = loadConfig(root);
    assert.equal(result.ok, true, `kiểu ${gt} làm loadConfig đỏ`);
  }
});

test('DEFAULT_CONFIG carries a test command', () => {
  assert.equal(typeof DEFAULT_CONFIG.test, 'string');
});
