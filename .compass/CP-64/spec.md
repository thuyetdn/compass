# CP-64: `check` tells the developer to get the spec reviewed in the middle of a gate run
Loại: fix
Phạm vi: commands/spec.mjs, commands/check.mjs, docs/demo/, test/spec-hint.test.mjs (mới)
Gốc soi: 4aba541

## Mục tiêu

`specCommand` always ends a passing run with the hint "→ Đưa spec cho người duyệt. Duyệt xong mới
bắt đầu code." (`commands/spec.mjs`, line 49). `checkCommand` runs the spec gate by calling that
same function from its `IMPLEMENTED` table and pushes its whole output. So the hint lands in the
middle of every `check`, long after the spec was approved and the code was written.

Measured on HEAD (4aba541) in a scratch `fix` project with a two-case spec and a passing suite:

```
$ compass check X-1
✓ Gate spec PASSED

→ Đưa spec cho người duyệt. Duyệt xong mới bắt đầu code.
✓ Gate knowledge PASSED — dự án chưa dùng .knowledge
...
✓ Gate test PASSED — 2/2 test cases đã chạy
```

`compass check X-1 --only=spec` prints the same three lines. `compass done X-1` does not print the
hint. `done` never calls `specCommand`. The repo's own demo shows the problem: both
`compass check TD-002` steps in `docs/demo/transcript.json` carry the hint, and so do
`still-check-red.png`, `still-check-green.png` and the video. A developer watching a gate run is
told to stop and get a review, which makes no sense at that point.

The hint belongs to the standalone `compass spec <id>`, which is the moment it describes. Done
means: `compass spec` prints exactly what it prints today. `check`, with or without `--only=spec`,
prints `✓ Gate spec PASSED` with no hint and no blank line after it, so the next gate's line follows
directly. The demo is re-recorded so the published transcript, stills and video show the new
output.

## Ràng buộc

- `compass spec <id>` output stays byte-identical, pass and fail alike.
- The choice belongs to the caller. `specCommand` takes an option that drops the pass hint, its
  default keeps the hint, and `check` passes the option. `check` does not filter the hint out of
  the text afterwards. That would couple two files through a Vietnamese sentence, and the next edit
  to the wording would silently bring the hint back.
- Only the pass hint changes. When the spec gate fails inside `check`, the output stays as it is
  today, including "→ Sửa spec rồi chạy lại: compass spec <id>". That advice is still correct after
  a failure: fix the spec, then validate it. The knowledge gate's own hint ("Muốn có tài liệu máy
  sinh thì tạo .knowledge/ …") also stays. It describes the current state of the project, not a
  step of the workflow that is already over.
- The spec gate record is unchanged. `writeGate` gets the same fields whichever caller ran it, so
  `done` sees no difference.
- The demo is re-recorded as part of this task with `node docs/demo/record.mjs`, which refreshes
  `transcript.json`, the four stills and `compass-demo.webm`. Without that, the repo's own front
  page keeps showing the output this task removes. CP-58-H4 reads the transcript, and H5 below pins
  that it no longer contains the hint. The recorder needs Playwright and Chromium in the temp copy
  of `examples/todo` (the recorder says how). Per CP-58-S2 it leaves the repo copy untouched.
- No new dependency.

## Rủi ro hồi quy

- **Other callers of `specCommand`.** `cli.mjs` calls it with `{ cwd, taskId }` and must keep the
  hint without passing anything new. E1 calls it exactly that way.
- **`check`'s line layout.** Removing the hint also removes the empty line in front of it. If only
  the arrow line goes, a stray blank line is left between the spec and knowledge lines. H2 asserts
  the two lines are adjacent.
- **Existing tests that read `check` output.** `test/check-done.test.mjs`,
  `test/integration.test.mjs` and `test/deep-integration.deep.mjs` match on gate lines. None of them
  is known to assert the hint (a grep for "Duyệt xong" in `test/` finds nothing), but any that
  counts lines or blank lines must stay green.
- **The demo.** Re-recording changes `transcript.json` (`compassCommit`, `recordedAt`, durations,
  and the two lines removed from each `check` step), the stills and the webm. CP-58-H4 (red then
  green, ends on a green `done`), CP-58-S1 (no local path or email in the transcript) and CP-58-S2
  (examples/todo untouched) must all stay green on the new recording.
- **`done`.** It never printed the hint and must not start to. H4 pins it.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `compass spec X-1` on a valid `fix` spec, through `cli.mjs` | exit 0; output is exactly `✓ Gate spec PASSED`, an empty line, then `→ Đưa spec cho người duyệt. Duyệt xong mới bắt đầu code.` | P0 |
| H2 | Happy | `compass check X-1` on the same project with a passing suite | exit 0; output has no "Duyệt xong mới bắt đầu code"; the line right after `✓ Gate spec PASSED` starts with `✓ Gate knowledge PASSED` | P0 |
| H3 | Happy | `compass check X-1 --only=spec` | exit 0; output is exactly `✓ Gate spec PASSED` | P0 |
| H4 | Happy | `compass done X-1` after H2 | exit 0, "4 gate đã pass"; output has no "Duyệt xong" | P1 |
| H5 | Happy | `docs/demo/transcript.json` after re-recording | every `compass check` step's stdout lacks "Duyệt xong mới bắt đầu code"; the `compass spec TD-002` step still has it; `compassCommit` is not `c50b51b` | P0 |
| H6 | Happy | The spec record in `gate.json`, written once by `compass spec` and once by `compass check` | same keys, same `exitCode` 0, same `specHash`, `errorCount` 0 | P1 |
| E1 | Error | Spec with too few test cases, run through `compass check X-1` | exit 1; output has "✗ Gate spec FAILED" and "Sửa spec rồi chạy lại: compass spec X-1", the same as on HEAD | P1 |
| EC1 | Edge | `specCommand({ cwd, taskId })` called directly with no option, as `cli.mjs` does | output still ends with the review hint | P1 |
