# CP-107: CP-106 leftovers: a red test behind every fix, the earlier rung on relisted chain links, hunk parsing of `+++` content lines, verify rounds across sub-repos
Loại: feature-s
Gốc soi: 5e05358
Phạm vi: lib/findings.mjs, lib/review-rounds.mjs, lib/review-brief.mjs, commands/review.mjs, skills/compass/SKILL.md, templates/AGENTS.md, AGENTS.md, README.md, docs/huong-dan.md, test/

## Mục tiêu

Close what CP-106 (issue #7, batch 1) left open, so batch 2 starts on a finished round mechanism.

Done means:

- **Item 11 of the issue, the rest of `fixReview`.** A closure with `status: "closed"` also records
  `redTest` and, optionally, `rerunBy`:
  - `redTest` is the exact title of a test that covers the fix. It is required when `rung` is `narrow`,
    `reuse` or `mechanism`, since those rungs add or change code. With `rung: "revert"` it is optional,
    because removing a mechanism needs no new test.
  - `"redTest": null` is allowed when the fix has no test to show, such as a documentation fix. It then
    needs a non-empty `note` saying why.
  - When `redTest` is a string, Compass checks it against the log of this task's `test` gate. The record
    must be green, signed, and match the current code (`sourceHash`), and the log must still hash to the
    record's `outputHash`. The title must appear on a passing line of that log, compared as a whole title.
  - `rerunBy` names the lens that re-ran on the fix diff. When present it must be a non-empty string. It
    is recorded, not checked.
  - Both fields go into the ledger closure. The gate output counts fixes closed with `redTest: null`.
- **R8.** When a third chain link closed with a rung other than `revert` comes back to the open list, the
  verify brief says so on that finding: the round it was closed in, the rung it used, and that the third
  link must close with `revert` or a human acceptance line.
- **R4.** `parseHunks` keeps file attribution when a hunk body has an added line whose content starts with
  `++ ` (diff line `+++ …`) or a deleted line whose content starts with `-- ` (diff line `--- …`). Only a
  `+++ ` line outside a hunk body is a file header.
- **R3/F5.** Verify rounds have tests for the two workspace layouts CP-84 supports and CP-106 never tested
  in a verify round: a sub-repo with its own git nested under the root, and a sub-repo declared through a
  junction (a directory symlink on POSIX) to a git repository elsewhere inside the root. A junction to a git
  outside the root stays skipped, as decided in CP-88 (issue #2). If a test exposes a bug,
  this task fixes it.
- The verify brief, the skill, `templates/AGENTS.md`, this repo's `AGENTS.md`, `README.md` and
  `docs/huong-dan.md` describe `redTest` and `rerunBy`.

Design choices this spec makes, which the reviewer must approve:
1. **Compass checks that the test exists and passes now. It does not check that it was red before the
   fix.** Proving "red before" means running the old code's tests, which is mutation-style work for
   batch 3. The brief says the "red before" part is the reviewer's word.
2. **Whole-title match on a passing line.** A substring match would let `"redTest": "a"` pass against any
   log. Passing lines are the ones the test parser already treats as passing: `ok N - <title>` (TAP),
   `✔ <title>`, `✓ <title>` and `√ <title>`, with a trailing duration such as `(12ms)` or `(3 ms)`
   removed. A title that appears only on a failing line does not count.
3. **The log is trusted only through the signed record.** A hand-edited `test.log` no longer hashes to
   `outputHash`, and Compass rejects it.

Out of scope: proving red-before (batch 3, mutation), and the issue's items 5 to 10 and 12 (batches 2
and 3). F6 (duplicated test helpers) stays kept.

## Ràng buộc

- Zero dependencies.
- `compass pr` is unchanged: its brief stays byte-identical and its findings need no closures.
- Ledgers written by CP-106 still read: old closures without `redTest` are valid history. The new rule
  applies only to closures in findings submitted from now on.
- The `test` gate's record and log format do not change.

## Rủi ro hồi quy

- **Verify rounds in flight.** A reviewer who closes a finding with `narrow`, `reuse` or `mechanism` and no
  `redTest` now gets a rubric error (exit 2). The brief's closure example and the error text both show the
  field.
- **Brief text.** The verify brief's closure section and the relisted-finding line change, so verify briefs
  written before the upgrade reopen once (the "mẫu brief của Compass đã khác" message).
- **`compass review` run alone.** It now reads the `test` gate's record when a closure names a `redTest`.
  If that record is missing, red or stale, review exits 2 and says to run `compass check` first. `check`
  already runs `test` before `review`.
- **`parseHunks`.** Fix-induced findings that were accepted before must still be accepted. CP-106's hunk
  tests (V3, EC2, EC3 of CP-106) stay green.
- **Multi-repo test log.** `test` writes one bare slot whose log joins every repo's output with
  `# repo <name>` headers. The title search runs over the whole joined log.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Round 2 closes F1 with `rung: "narrow"`, `redTest` set to the title of a test that passed in the current green `test` gate log, and `rerunBy: "matrix"` | Gate exit 0. Ledger round 2 closure for F1 has `redTest` and `rerunBy` equal to the submitted values | P0 |
| H2 | Happy | Round 2 closes F1 with `rung: "revert"` and no `redTest` key | Gate exit 0; ledger closure has `redTest: null` | P0 |
| H3 | Happy | Round 2 closes F1 with `rung: "reuse"`, `"redTest": null` and `note: "docs-only fix"` | Gate exit 0; output contains "1 bản sửa không có test đỏ trước" | P1 |
| H4 | Happy | A third chain link (created in round 3, the earliest a chain can reach 3) closed with `rung: "narrow"` in round 4 comes back to the open list of round 5 | Round 5 brief, under that finding, has a line naming round 4, rung `narrow`, and saying the third link must close with `revert` or an acceptance line | P0 |
| H5 | Happy | `parseHunks` on a diff whose hunk adds a line with content `++ x` (diff line `+++ x`) followed by more added lines in the same file | Map has only the real file; its hunk ranges are unchanged; no key `x` | P0 |
| H6 | Happy | Workspace with a nested sub-repo `be` that has its own git; round 1 records a Major `fix` in `be/a.js`; the author edits `be/a.js`; reviewer submits round 2 with a `fix-induced` finding on a changed line of `be/a.js` | Round 2 brief's fix diff names `be/a.js`; gate accepts the fix-induced finding (no "không nằm trong bản sửa" error) | P0 |
| H7 | Happy | Same as H6, but the declared `be` directory is a junction (directory symlink on POSIX) to `real/be`, a git repository inside the root | Fix diff names the file under the git's real prefix `real/be/`; gate accepts a fix-induced finding there | P0 |
| V1 | Validation | Round 2 closes F1 with `rung: "narrow"` and no `redTest` key | Exit 2; error names closure F1 and says `redTest` (a test title, or null with a note) is required for rung narrow | P0 |
| V2 | Validation | Round 2 closes F1 with `rung: "mechanism"`, `"redTest": null` and no `note` | Exit 2; error says `redTest: null` needs a `note` | P0 |
| V3 | Validation | `redTest` is `42`, or an empty string | Exit 2; error says `redTest` must be a test title or null | P1 |
| V4 | Validation | `rerunBy` is `""` or `{}` | Exit 2; error says `rerunBy` must be a non-empty string | P1 |
| E1 | Error | `redTest` names a title that is not in the test log | Exit 2; error quotes the title and points at `.compass/<id>/evidence/test.log` | P0 |
| E2 | Error | `redTest` is a string but the `test` gate has no record, a red record, or a record whose `sourceHash` differs from the current code | Exit 2; error says to run `compass check <id>` first; no ledger round is written | P0 |
| EC1 | Edge | `parseHunks` on a hunk with a deleted line whose content is `-- y` (diff line `--- y`) directly followed by an added line with content `++ y` (diff line `+++ y`) | Map has only the real file and the right ranges | P0 |
| EC2 | Edge | `redTest` is a prefix of a passing title (`CP-9-H1` when the log has `CP-9-H1 adds an item`) | Exit 2, not found: titles compare whole | P0 |
| EC3 | Edge | Multi-repo log (`# repo be` and `# repo fe` sections); `redTest` passed in the `fe` section | Accepted | P1 |
| EC4 | Edge | The log line is `✔ <title> (12.5ms)`, `ok 3 - <title>` or `✓ <title> (3 ms)` | Each is accepted for `<title>` | P1 |
| S1 | Security | `redTest` title appears only on a failing line (`✖ <title>`, `not ok 2 - <title>`) | Exit 2, not found | P0 |
| S2 | Security | `redTest` is `.*` or contains regex metacharacters | Treated literally: not found against a log without that literal title; no exception | P0 |
| S3 | Security | `test.log` edited after the `test` gate ran so that it contains the title | Exit 2; error says the log no longer matches the signed record | P0 |
