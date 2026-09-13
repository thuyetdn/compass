# CP-41: Two contract elements sharing a selector make the first one report false drift
Loại: bug
Phạm vi: commands/ui.mjs, lib/browser.mjs, test/browser.test.mjs
Gốc soi: 5fda628

## Mục tiêu

`buildMeasureScript` returns one result per contract element, in element order. `commands/ui.mjs`
then re-indexes those results into a `Map` keyed by selector. Two elements that name the same
selector with different property sets — `.btn` for `color` in one entry, `.btn` for `padding` in
another — collapse to the last result, so the first element's properties read back `undefined`
and the gate reports "không đo được giá trị" on a page that matches the design.

After the fix, each element is paired with its own result by position. Reusing a selector across
elements is allowed and each element is compared against the values it asked for.

## Ràng buộc

- Pairing lives in `lib/browser.mjs` as a pure function so it can be tested without a browser;
  `commands/ui.mjs` calls it instead of building the `Map`.
- A result list shorter than the element list, or a missing entry, is reported per element as
  "không đo được" with the element name — never a thrown `TypeError`.
- `buildMeasureScript` keeps emitting one entry per element in order, including when selectors
  repeat. It does not deduplicate.
- No change to the drift record shape, tolerance rules, or the gate record.
- Zero runtime dependency; `node:*` and relative imports only.

## Rủi ro hồi quy

- The no-contract pass path and the missing-Playwright exit-2 path in `ui.mjs` are untouched;
  `CP-4-*` tests in `test/ui-command.test.mjs` must still pass unchanged.
- A selector that is genuinely absent must still produce the existing "không tìm thấy selector"
  reason, not the new "không đo được" one.
- Element order in the contract is the contract's order; sorting or filtering elements anywhere
  before pairing would silently misalign results again.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Two elements share a selector, each with different properties | Each element is paired with its own result; both property sets are read | P0 |
| H2 | Happy | Elements with distinct selectors | Pairing is identical to before — element i gets result i | P0 |
| V1 | Validation | `buildMeasureScript` with a repeated selector | Emits one entry per element, in order, no deduplication | P0 |
| E1 | Error | Result list shorter than the element list | Missing elements are reported as not measured, naming the element; no exception | P0 |
| E2 | Error | Results is `null` or not an array | Every element is reported as not measured; no exception | P1 |
| EC1 | Edge | Same selector and the same property in two elements | Both are compared independently against their own design values | P1 |
| EC2 | Edge | A selector absent from the page | The result carries `found: false` and the pairing preserves it, so the existing "không tìm thấy" reason still applies | P0 |
