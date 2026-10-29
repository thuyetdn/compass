# CP-95: review says the secretsPublic list changed when only the brief context did
Loại: bug
Gốc soi: 26f175c
Phạm vi: lib/review-brief.mjs, commands/review.mjs, test/review-secrets-public-reread.test.mjs (mới), skills/compass/SKILL.md

## Mục tiêu

Open Minor from CP-93's second review. When a brief is stale but its spec and diff are unchanged,
`review` picks one of two messages by comparing the `secretsPublic` section of the old brief with the
one it would write now (`briefSecretsPublic(old) !== publicOf(current)`). Two inputs make that
comparison true when the list did not change, so the gate says "Danh sách secretsPublic trong
config.json đã đổi" while the change was the repo context or the brief template:

1. The spec quotes the line `## Các file đã đổi`. `briefSecretsPublic` searches the whole brief for
   the first such line, finds the one inside the spec block, and reads the wrong place.
2. The old brief has no readable section structure (hand-edited, or an older template).
   `briefSecretsPublic` returns `null`, and `null !== ''` reads as "the list changed", even in a
   project that declares no `secretsPublic`.

The gate still reopens in both cases (the brief id changes, old findings do not pass); only the
reason it prints is wrong, and it sends the reader to look for a config change that does not exist.

Done means:
- `briefSecretsPublic` searches for `## Các file đã đổi` only after the spec block ends, located by
  the same fence `briefSubject` uses;
- when it cannot read the old section (`null`), `review` does not claim the list changed and prints
  the context message;
- a real change to the list is still reported as one, also when the spec quotes the heading;
- SKILL.md's "Hai giới hạn còn lại" says the review brief marks the `secretsPublic` lines a task added
  (CP-93), so the reader knows the reviewer sees them, not only the person approving the config.

## Ràng buộc

- Briefs do not change by a byte: only how an old brief is read back changes. Brief ids stay the same.
- The reopen logic itself (`briefIsCurrent`, `answersThisBrief`) is not touched.
- Both phases use one helper, so they cannot disagree again.

## Rủi ro hồi quy

- CP-93-H4 and H5 (a real list change, phases one and two) must still print the list message.
- CP-93-EC6 (a spec quoting the section heading) must still return `''`.
- CP-38 and CP-79 tests (`review-hardening.test.mjs`): the context message and the "Code hoặc spec đã
  đổi" message keep their conditions; `briefSubject` keeps returning the same spec and diff.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Config declares `be/.env` at base and now; spec quotes `## Các file đã đổi` followed by a `---` line; review passed; the stored brief's context prose is edited (stands in for a template change); phase two runs | exit 1; output has "ngữ cảnh repo"; no line mentions `secretsPublic` | P0 |
| H2 | Happy | Same setup, no findings submitted (phase one) | exit 1; output has "ngữ cảnh repo"; no line mentions `secretsPublic` | P0 |
| V1 | Validation | `briefSecretsPublic` on a brief built by `buildBrief` whose spec quotes `## Các file đã đổi`, a `---` line and a fake `## File .env gate secrets không quét` section listing `` `fake/.env` `` | returns exactly the section passed to `buildBrief`; the result does not contain `fake/.env` | P0 |
| E1 | Error | No `secretsPublic` anywhere; the stored brief has its `## Các file đã đổi` heading removed; phase one runs | exit 1; output has "ngữ cảnh repo"; no line mentions `secretsPublic` | P0 |
| EC1 | Edge | Spec quotes `## Các file đã đổi` followed by a `---` line; the config adds `be/.env.alpha` after a passed review; phase two runs | exit 1; output matches `secretsPublic[^\n]*đã đổi` | P0 |
| EC2 | Edge | `briefSecretsPublic` on a brief with no spec block | returns `null` | P1 |
