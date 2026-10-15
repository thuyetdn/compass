# CP-68: Clean the repo for a public release — drop generated artefacts, drop the limits section
Loại: fix
Phạm vi: README.md, docs/huong-dan.md, test/release-docs.test.mjs, .compass/.gitignore, docs/demo/
Gốc soi: a599385
Kiểm tra bằng: mắt

## Mục tiêu

The repo goes public tomorrow. Three kinds of weight come out, measured on a599385.

1. **3.0 MB of generated files are tracked.** 15 `review-brief.md` (2.6 MB) are intermediates: a
   brief exists to hand one agent a diff to review, and `compass review <id>` writes it again on
   demand. `test/package.test.mjs` already keeps them out of the npm package — "review-brief mang
   nguyên diff của repo" — but a public repo publishes the same diffs on GitHub. Four
   `docs/demo/still-*.png` (396 KB) were frames of the demo video; nothing embeds them, and
   `record.mjs` writes them again. The video itself (9.8 MB) went with them: it recorded a terminal
   session, which is not how anyone uses Compass.

2. **The limits section goes.** The owner decided it does not belong in a release. Removed from
   README and the guide, including the opening line that promised it ("biết chính xác một `done`
   xanh nói lên điều gì, không nói lên điều gì"). `SKILL.md` keeps "Gate xanh ≠ mục tiêu đạt" — that
   one is an instruction Claude follows after a green `done`, not a reader-facing claim.

3. **Two documentation facts are now false.** The guide still said no command builds a multi-repo
   config (CP-66 added `init --multi`), and the README still said 1310 tests (1312 after CP-66 and
   CP-67).

## Ràng buộc

- No source change under `lib/` or `commands/`: this is repository hygiene, not behaviour.
- `record.mjs` and `docs/demo/scenario/` stay. Ten tests in the deep suite drive the recorder, and
  the transcript is what proves the demo quotes real output.
- The ignore rule is `*/review-brief.md`, scoped under `.compass/`, so it covers a task folder and
  not `lib/review-brief.mjs`.
- CP-58-H4 keeps asserting the transcript holds a red gate, its fix, and a green `done`. Only the
  file-format half of that test goes, because the file is gone.

## Rủi ro hồi quy

- CP-58-H3 checks every relative link in the README, the guide and the todo README resolves. The
  video link broke exactly this way and was caught by the suite, not by reading.
- CP-58-H5 requires a fixed list of headings in the guide; removing a section changes that list, so
  the test moves with it or goes red for the wrong reason.
- CP-58-H1 requires the README to state the gate count and list that `lib/gates.mjs` implements, and
  CP-63-H5 requires the bare-test rule in README, guide and SKILL.md. Neither section may be lost in
  the edit.
- Deleting tracked files that a test reads would break the suite. Checked first: no test reads a
  committed brief or still; the brief tests all build their own under a temp dir.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `npm test` after every deletion and edit | 1312 pass, 0 fail | P0 |
| H2 | Happy | `git ls-files` for review-brief | only the three source files, no task brief | P0 |
| H3 | Happy | `git check-ignore .compass/CP-66/review-brief.md` | git reports it ignored by the new rule | P0 |
| H4 | Happy | `git check-ignore lib/review-brief.mjs` | not ignored — the rule does not reach source | P0 |
| V1 | Validation | Grep README and the guide for the limits headings | no match in either file | P0 |
| V2 | Validation | Grep SKILL.md for "Gate xanh ≠ mục tiêu đạt" | still present — the instruction stays | P0 |
| V3 | Validation | Grep every doc for "webm", "video", "still-" | no match | P0 |
| E1 | Error | CP-58-H3, the relative-link test | passes: no link points at a deleted file | P0 |
| E2 | Error | CP-58-H4 after the video is gone | passes, asserting the transcript rather than the file | P0 |
| EC1 | Edge | README gate count and gate list (CP-58-H1) | still matches `IMPLEMENTED_GATES` | P0 |
| EC2 | Edge | The bare-test rule in README, guide, SKILL.md (CP-63-H5) | all three still state it | P0 |
| EC3 | Edge | Guide claim about building a multi-repo config | names `compass init --multi` | P1 |
| EC4 | Edge | README test count | says 1312, matching the suite | P1 |
