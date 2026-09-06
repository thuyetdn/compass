import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareValue, normaliseColour, toleranceFor } from '../lib/tolerance.mjs';

test('CP-4-H3 an exact colour match reports no drift', () => {
  const result = compareValue('color', '#111827', 'rgb(17, 24, 39)');
  assert.equal(result.ok, true);
});

test('CP-4-EC3 the same colour in rgb and hex is one colour', () => {
  assert.equal(normaliseColour('#ff0000'), 'rgb(255, 0, 0)');
  assert.equal(normaliseColour('rgb(255, 0, 0)'), 'rgb(255, 0, 0)');
  assert.equal(normaliseColour('#F00'), 'rgb(255, 0, 0)');
});

test('a colour that differs at all fails — no tolerance on colour', () => {
  const result = compareValue('color', '#111827', 'rgb(51, 51, 51)');
  assert.equal(result.ok, false);
  assert.match(result.reason, /tuyệt đối/);
});

test('CP-4-H4 padding off by 1px sits inside the 2px tolerance', () => {
  const result = compareValue('padding-right', '20px', '19px');
  assert.equal(result.ok, true);
  assert.equal(result.drift, 1);
});

test('CP-4-EC1 padding off by exactly 2px is still inside tolerance', () => {
  const result = compareValue('padding-right', '20px', '18px');
  assert.equal(result.ok, true);
});

test('CP-4-EC2 padding off by 2.5px breaks tolerance', () => {
  const result = compareValue('padding-right', '20px', '17.5px');
  assert.equal(result.ok, false);
  assert.equal(result.drift, 2.5);
});

test('border-radius holds a tighter 1px tolerance', () => {
  assert.equal(compareValue('border-radius', '8px', '7px').ok, true);
  assert.equal(compareValue('border-radius', '8px', '6px').ok, false);
});

test('line-height holds the same 1px tolerance', () => {
  assert.equal(compareValue('line-height', '24px', '23px').ok, true);
  assert.equal(compareValue('line-height', '24px', '22px').ok, false);
});

test('font-size must match exactly', () => {
  assert.equal(compareValue('font-size', '16px', '16px').ok, true);
  assert.equal(compareValue('font-size', '16px', '15px').ok, false);
});

test('font-weight must match exactly', () => {
  assert.equal(compareValue('font-weight', '600', '600').ok, true);
  assert.equal(compareValue('font-weight', '600', '500').ok, false);
});

test('a property with no known tolerance is compared as text', () => {
  assert.equal(compareValue('display', 'flex', 'flex').ok, true);
  assert.equal(compareValue('display', 'flex', 'block').ok, false);
});

test('toleranceFor reports the pixel budget per property', () => {
  assert.equal(toleranceFor('padding-top'), 2);
  assert.equal(toleranceFor('gap'), 2);
  assert.equal(toleranceFor('border-radius'), 1);
  assert.equal(toleranceFor('color'), 0);
});

test('a missing measured value is a failure, not a pass', () => {
  const result = compareValue('padding-top', '20px', undefined);
  assert.equal(result.ok, false);
});

test('rgba keeps its alpha channel when normalised', () => {
  assert.equal(normaliseColour('rgba(255, 0, 0, 0.5)'), 'rgba(255, 0, 0, 0.5)');
});

test('a non-colour string passed to normaliseColour comes back unchanged', () => {
  assert.equal(normaliseColour('inherit'), 'inherit');
});

test('CP-4-P4 longhand properties inherit the shorthand budget', () => {
  // Tên CSS ghép bằng dấu gạch, và phần quyết định có thể ở bất kỳ đoạn nào.
  // Chỉ so tiền tố thì `row-gap` rơi về dung sai 0px, và `12px` vs `12.5px` bị
  // báo drift dù spec cho ±2px.
  const mong = {
    'gap': 2, 'row-gap': 2, 'column-gap': 2,
    'width': 2, 'min-width': 2, 'max-height': 2,
    'padding-top': 2, 'margin-inline-start': 2,
    'border-radius': 1, 'border-top-left-radius': 1,
    'border-width': 1, 'border-top-width': 1,
    'color': 0, 'background-color': 0, 'font-size': 0,
  };
  for (const [prop, budget] of Object.entries(mong)) {
    assert.equal(toleranceFor(prop), budget, `${prop} phải có dung sai ${budget}px`);
  }
});

test('CP-4-P5 the most specific name wins, not the first one listed', () => {
  // `border-top-left-radius` khớp cả `border-width` (2 đoạn) lẫn `border-radius`
  // (2 đoạn) lẫn `width`. Duyệt theo thứ tự khai báo thì kết quả tuỳ ai đứng
  // trước — một lần sắp xếp lại danh sách là đổi hành vi.
  assert.equal(toleranceFor('border-top-left-radius'), 1, 'radius thắng width');
  assert.equal(toleranceFor('border-bottom-width'), 1, 'border-width thắng width');
});
