# CP-85: give the CP-82 draft timing test room for a parallel suite
Loại: fix
Phạm vi: test/convention-draft.test.mjs, test/timing-budget-cp85.test.mjs (mới)

## Mục tiêu

CP-82-P1 drafts conventions for a 60 MB repo of 5,000 files and allows 10 s. Alone the draft takes
about 3.5 s. Inside `npm test`, where every test file runs in parallel, it takes 11 to 14 s on this
machine, at HEAD as well as with CP-84, so the whole suite exits 1 and every task's `test` gate is
red for a reason no task caused.

Done means the budget is 20 s with two tries, and the test name says so. 20 s still catches a draft
that becomes about six times slower than it is alone.

## Ràng buộc

- Only the budget and the test name change. The fixture (5,000 files, over 55 MB) and what the test
  asserts stay as they are.
- No other timing test changes.

## Rủi ro hồi quy

- A real slowdown of the draft between 3x and 6x is no longer caught. Accepted: below that the
  parallel suite already produces it with no code change.
- The test keeps the ID CP-82-P1, so CP-82's evidence still names it.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read CP-82-P1 in `test/convention-draft.test.mjs` | budget `20_000` ms, `tries: 2`, name says "within 20 s", fixture still 5,000 files | P0 |
| H2 | Happy | `withinBudget` with that budget and two tries of 25 s on a fake clock | still fails: the looser budget still catches a draft over 20 s | P1 |
