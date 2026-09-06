import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContract } from '../lib/design-contract.mjs';

const VALID = JSON.stringify({
  viewports: [
    { name: 'desktop', width: 1280 },
    { name: 'mobile', width: 375 },
  ],
  elements: [
    {
      name: 'Tiêu đề',
      selector: 'h1',
      properties: { color: '#111827', 'font-size': '32px' },
    },
  ],
});

test('CP-4-H1 parses a contract with one element', () => {
  const result = parseContract(VALID);
  assert.deepEqual(result.errors, []);
  assert.equal(result.contract.elements.length, 1);
  assert.equal(result.contract.elements[0].selector, 'h1');
  assert.deepEqual(Object.keys(result.contract.elements[0].properties), ['color', 'font-size']);
});

test('CP-4-H2 parses several viewports with names and widths', () => {
  const result = parseContract(VALID);
  assert.deepEqual(result.contract.viewports.map((v) => v.name), ['desktop', 'mobile']);
  assert.equal(result.contract.viewports[0].width, 1280);
});

test('CP-4-V1 invalid JSON is reported, not thrown', () => {
  const result = parseContract('{ not json');
  assert.equal(result.contract, null);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /JSON/);
});

test('CP-4-V2 a contract with no elements array is reported', () => {
  const result = parseContract(JSON.stringify({ viewports: [] }));
  assert.equal(result.contract, null);
  assert.match(result.errors[0], /elements/);
});

test('CP-4-V3 an element missing its selector is named in the error', () => {
  const source = JSON.stringify({
    elements: [{ name: 'Nút gửi', properties: { color: '#000' } }],
  });
  const result = parseContract(source);
  assert.equal(result.contract, null);
  assert.match(result.errors[0], /Nút gửi/);
  assert.match(result.errors[0], /selector/);
});

test('CP-4-V4 a viewport width that is not a number is reported', () => {
  const source = JSON.stringify({
    viewports: [{ name: 'desktop', width: 'wide' }],
    elements: [{ name: 'x', selector: 'h1', properties: { color: '#000' } }],
  });
  const result = parseContract(source);
  assert.equal(result.contract, null);
  assert.match(result.errors[0], /width/);
});

test('an element with no properties is reported', () => {
  const source = JSON.stringify({
    elements: [{ name: 'Trống', selector: 'h1', properties: {} }],
  });
  const result = parseContract(source);
  assert.equal(result.contract, null);
  assert.match(result.errors[0], /Trống/);
});

test('CP-4-EC4 an empty elements array parses and measures nothing', () => {
  const result = parseContract(JSON.stringify({ elements: [] }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.contract.elements, []);
});

test('a contract with no viewports gets one default desktop viewport', () => {
  const source = JSON.stringify({
    elements: [{ name: 'x', selector: 'h1', properties: { color: '#000' } }],
  });
  const result = parseContract(source);
  assert.equal(result.contract.viewports.length, 1);
  assert.equal(result.contract.viewports[0].width, 1280);
});

test('every error is collected, not just the first', () => {
  const source = JSON.stringify({
    elements: [
      { name: 'A', properties: { color: '#000' } },
      { name: 'B', selector: 'h2' },
    ],
  });
  const result = parseContract(source);
  assert.equal(result.errors.length, 2);
});

test('countProperties totals every measurement the contract asks for', () => {
  const source = JSON.stringify({
    viewports: [{ name: 'desktop', width: 1280 }, { name: 'mobile', width: 375 }],
    elements: [
      { name: 'A', selector: 'h1', properties: { color: '#000', 'font-size': '32px' } },
      { name: 'B', selector: 'p', properties: { color: '#333' } },
    ],
  });
  const { contract } = parseContract(source);
  // 3 properties across 2 viewports
  assert.equal(contract.totalMeasurements, 6);
});

test('CP-4-V7 a contract that parses to null is reported, not thrown', () => {
  // `JSON.parse("null")` hợp lệ và trả về null; `.elements` trên đó ném
  // TypeError ra ngoài hàm, thoát khỏi mọi try/catch của lệnh, và người dùng
  // nhận một stack trace thay vì câu báo lỗi.
  for (const raw of ['null', '123', '[]', 'true', '"chuỗi"']) {
    let r;
    assert.doesNotThrow(() => { r = parseContract(raw); }, `${raw} không được ném`);
    assert.ok(r.errors.length > 0, `${raw} phải báo lỗi`);
  }
});
