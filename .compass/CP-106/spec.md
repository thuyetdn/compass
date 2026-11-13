# CP-106: review converges in one or two rounds: findings v2, a signed round ledger, verify-only rounds, a disposition rubric and a fix-chain budget
Loại: feature-l
Gốc soi: 8d9912b
Phạm vi: lib/findings.mjs, lib/review-ledger.mjs (mới), lib/review-rounds.mjs (mới), lib/review-brief.mjs, lib/spec-parser.mjs, commands/review.mjs, skills/compass/SKILL.md, templates/AGENTS.md, AGENTS.md, README.md, docs/huong-dan.md, test/
Vòng soi tối đa: 4 — gỡ cơ chế của R7 (chuỗi R1 → R6 → R7), người duyệt quyết ngày 2026-11-13

## Mục tiêu

Issue #7, first of three batches (items 1, 2, 3, 4 and 11 of the issue's "Thay đổi trong Compass").
A `feature-l` task needed about 45 self-review rounds plus 3 external ones, and every round still
produced findings. The issue measured why: 37% of findings came from the previous round's fix (81% in
round 21), 72% of those from fixing a Minor, and a fresh full LLM review returns a different set each
time, so "review until only Minor is left" settles at a floor instead of reaching zero.

Done means `compass review` runs a fixed process:

- **Round 1 is a full review** as today, with a rubric in the brief. Every Critical, Major and Minor
  finding carries an `id` and a `disposition` (`fix` or `kept` with a reason). The gate is red while any
  finding of the round is `fix`. A Minor marked `kept` never blocks. A Critical or Major marked `kept`
  blocks unless the spec header has `Chấp nhận <id>#<fingerprint>: <reason>`, written by a human. The gate prints
  that exact line. The fingerprint is six hex characters of a hash over the finding's severity, criterion, title
  and file, so the line accepts the finding the human read and no other finding that later reuses its id.
- **Compass records each evaluated round** in `.compass/<id>/evidence/review-ledger.json`, signed like
  `gate.json`: round number, kind, brief id, per-git head SHA and a snapshot tree of the reviewed state,
  every finding with its disposition, origin and `causedBy`, and the closures.
- **Round 2 onward is verify-only.** When the code changes after a recorded round, `compass review` no
  longer asks for a fresh full review. It writes a verify brief holding the spec, the diff from the last
  recorded snapshot to now (the fix diff), and the findings still waiting for a fix. The reviewer closes
  each one (`closures`, with the fix's `rung`: `revert`, `narrow`, `reuse` or `mechanism`) and may add new
  findings, each with an `origin`. A `fix-induced` finding must point at a line inside a hunk of the fix
  diff, checked by Compass. A `missed` finding must name the `lens` that should have caught it in round 1,
  and the gate prints it as a method error.
- **Fix-chain budget.** A `fix-induced` finding names the finding whose fix caused it (`causedBy`). When a
  chain reaches 3 links, the third link must be closed by removing the mechanism (`rung: revert`), unless
  the spec header has `Chấp nhận <id>#<fingerprint>: <reason>` for it.
- **Round limit.** Rounds 2 and 3 need nothing. Round 4 and later need `Vòng soi tối đa: <n> — <reason>`
  in the spec header, with n ≥ the round about to start.
- The skill, `templates/AGENTS.md`, this repo's `AGENTS.md`, `README.md` and `docs/huong-dan.md` describe
  the process: rubric, fix ladder, verify rounds, freezing scope during review.

Decisions the user took on the issue's "Điều cần quyết" (2026-11-13):
1. Minor `kept` lives in the ledger only. The spec carries a human line only for a Critical or Major kept,
   and for a third chain link that keeps its mechanism.
2. The third fix of a chain: the gate is red and defaults to removing the mechanism; a human acceptance
   line in the spec is the other way out.
3. Round 4 is allowed when the spec records the decision.
4. The matrix lens runs twice on every size; no third run for small PRs. This is process text in the skill
   only: Compass does not count lens runs in this batch.

Design choices this spec makes, which the reviewer must approve:
1. **The reviewer writes the disposition, not the author.** The author must not edit `evidence/`, and the
   issue's problem is over-fixing by the author. The brief carries the rubric, and the independent
   reviewer applies it.
2. **Snapshots are git trees**, written with a scratch index, never the real one. With `Soi đến`, the
   snapshot is the end commit's tree. The fix diff is `git diff <tree before> <tree now>` restricted to the
   union of both rounds' file lists, so `.compass/`, excluded directories and unrelated files stay out.
   Trees are unreachable objects, so `git gc` can prune them after its expiry (two weeks by default). Then
   Compass says so and starts again from a full round 1. Compass does not create refs in the user's repo.
3. **A requirement change restarts the ledger.** The spec text with the review-mechanics header lines
   removed (`Soi đến`, `Soi đến (<repo>)`, `Chấp nhận <id>`, `Vòng soi tối đa`, blank header lines) is hashed
   into the ledger.
   When that hash changes, the next review is a full round 1, and the output says the spec changed. This
   is the issue's "freeze scope during review": a new requirement belongs in its own task.
4. **A ledger that fails its signature is discarded**, with a printed line, and review starts at round 1.
   That covers evidence committed on another machine (each machine has its own salt). Discarding never
   makes review cheaper, since round 1 is the full review.
5. **Context-only changes reopen the same round**, as today (CP-38). Only a changed snapshot starts a new
   round.
6. **`compass pr` is unchanged** in this batch: its brief stays byte-identical and its findings need no
   disposition. Item 12 of the issue is batch 3.

Out of scope (batches 2 and 3): preflight, migration check, `## Môi trường`, claim check, mutation on
changed lines, findings per lens, `compass pr --since`. Of item 11, only `rung` is recorded; `redTest` and
`rerunBy` are not.

## Ràng buộc

- Zero dependencies. Hunk parsing and snapshots use git and plain string handling.
- The user's index, HEAD, branch and working tree are never touched. Snapshots go through a copy of the
  index in a temp directory, removed in `finally`, like `collectDiff`.
- A snapshot hashes only the files in the round's file list (plus the previous round's list for the fix
  diff). An untracked file outside that list, a `.env` above all, is never written to the object database.
- `findings.json` keeps its path. A verify round overwrites it; the previous round's content is already in
  the ledger.
- Every exit of phase two writes a gate record (current rule), and every evaluation of a round rewrites
  that round in the ledger. Re-running on the same findings is idempotent.
- `Chấp nhận` and `Vòng soi tối đa` count only in the spec header (above the first `##`), like `Gốc soi`.
  They are human decisions taken after a round, so they stay out of the spec text shown in the brief and hashed
  into the brief id: adding one re-scores the findings already filed instead of asking for a new review.
- The verify brief lists every finding id used in earlier rounds, kept findings included, so a reviewer does not
  reuse one.
- Finding ids match `^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$` and are unique across the whole ledger.
- Messages in Vietnamese, code comments match the surrounding files.

## Rủi ro hồi quy

- Existing review tests write findings without `id` or `disposition`. Their helpers must gain defaults
  (`fix` for Critical/Major, `kept` with a reason for Minor) so they keep measuring what they measured.
  No assertion may be loosened to make room for this task.
- Brief-reopen messages (CP-38, CP-79, CP-95): code-only, context-only and `secretsPublic`-only changes
  must still be told apart. Before any round is recorded, the behaviour is exactly today's.
- The brief id and brief bytes for `compass pr` (CP-81) must not change.
- `check` stops at a red `review`; `done` reads the `review` record. Neither command changes, so the record
  shape (exitCode, diffHash, specHash, briefHash, findingsHash) must stay.
- Multi-repo review (CP-84, CP-88): prefixes, nested repos, skipped outside repos, case folding must hold
  in the verify brief too.
- Linked directories (issue #5): untracked files behind a junction never reach the brief, so they must not
  reach the fix diff or the snapshot either.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Round 1 findings: one Major `fix`, two Minor `kept` with reasons | Exit 1; output names the Major as to-fix and says the next round only checks the fix; ledger has round 1 with 3 findings and their dispositions | P0 |
| H2 | Happy | Round 1 findings: one Minor `kept`, one Info without disposition | Exit 0; ledger round 1 verdict `pass` | P0 |
| H3 | Happy | After H1, change the fixed line and run review | Exit 1; brief says round 2 (verify); its diff holds the changed line and not the round-1 lines left untouched; it lists the open Major by id | P0 |
| H4 | Happy | Round 2 findings close the Major with `rung: narrow`, no new findings | Exit 0; ledger has rounds 1 and 2, the Major's closure recorded | P0 |
| H5 | Happy | Ledger content after H4 | Each round carries round, kind, brief id, head SHA and snapshot tree per git; the signature verifies with the task's salt | P0 |
| H6 | Happy | Sub-repo `be` with its own git; round 1 Major `fix` in `be/x.js`, then fix it | Verify brief diff carries `be/x.js` with the `be/` prefix and only the fixed hunk | P0 |
| H7 | Happy | Rounds 2 and 3 with no spec decision; round 4 with `Vòng soi tối đa: 4 — lý do` in the header | Rounds 2 and 3 get verify briefs; round 4 gets a verify brief | P1 |
| H8 | Happy | Round 1 Major `kept` and spec header `Chấp nhận F1#<fingerprint of that finding>: lý do` | Exit 0; output prints the accepted Major | P0 |
| H9 | Happy | Round 1 brief | Contains the disposition rubric (three conditions for fixing a Minor), the severity table and the `id`/`disposition` fields in the example | P1 |
| H10 | Happy | Chain F1 → F2 → F3 (`causedBy`), F3 closed next round with `rung: revert` | Exit 0 | P1 |
| V1 | Validation | Round 1 Minor without `disposition` | Exit 2; names the finding and says a Minor needs a disposition | P0 |
| V2 | Validation | `kept` without reason; action other than `fix`/`kept` | Exit 2 each, naming the finding and the field | P0 |
| V3 | Validation | Finding id missing, malformed, duplicated in the file, or reusing a round-1 id in round 2 | Exit 2 each, naming the id | P0 |
| V4 | Validation | Verify round: an open `fix` finding without a closure; a closure for an unknown id | Exit 2 each, naming the id | P0 |
| V5 | Validation | Verify round: finding without `origin`, with `original`, or with an unknown value | Exit 2 each | P0 |
| V6 | Validation | `fix-induced` without `causedBy`, or `causedBy` naming a finding that was not `fix` in an earlier round | Exit 2 each | P0 |
| V7 | Validation | `missed` without `lens` | Exit 2 | P1 |
| V8 | Validation | Closure `closed` without a `rung`, or with a rung outside the four | Exit 2 | P0 |
| V9 | Validation | `Vòng soi tối đa: 3`, `Vòng soi tối đa: abc`, or no reason | Exit 2 naming the line | P1 |
| E1 | Error | Round 1 Major `kept`, no acceptance line; then the printed line added; then a different Major filed under the same id | Exit 1 naming the Major and the exact line (with fingerprint); after adding it, exit 0 with the same findings and an unchanged brief; the different finding under the same id blocks again | P0 |
| E2 | Error | Round 2 `fix-induced` finding at a line outside every hunk of the fix diff | Exit 2; says the finding is not in the fix | P0 |
| E3 | Error | Chain reaches 3 links: F3 `fix-induced` caused by F2, F2 caused by F1, F3 `fix` | Exit 1; names the chain F1 → F2 → F3 and asks to remove the mechanism or add `Chấp nhận F3#<fingerprint>:` | P0 |
| E4 | Error | F3 (third link) closed next round with `rung: narrow`, no acceptance | Exit 1, naming F3; with `Chấp nhận F3#<fingerprint>: lý do` the same findings pass | P0 |
| E5 | Error | Code changes after round 3, no `Vòng soi tối đa` | Exit 1; no verify brief written; names the line to add | P0 |
| E6 | Error | Ledger edited by hand (one disposition changed) | Review prints that the ledger failed its signature, discards it, writes a full round-1 brief | P0 |
| E7 | Error | Snapshot tree of the last round missing from the object database | Review prints that the snapshot is gone and writes a full round-1 brief; no crash | P1 |
| E8 | Error | Verify round closure `open` | Exit 1; names the finding still open | P0 |
| EC1 | Edge | After a recorded round, only context changes (conventions file), code unchanged | Same round reopens with today's context message; no new round in the ledger | P0 |
| EC2 | Edge | Spec section text changes after round 1 | Next review is a full round 1, output says the spec changed; changing only `Chấp nhận`, `Vòng soi tối đa` or `Soi đến` lines keeps the ledger | P0 |
| EC3 | Edge | Round 1 passed, then code changes | Verify round over the delta only, not a full review | P0 |
| EC4 | Edge | Info finding without disposition | Accepted, never blocks | P1 |
| EC5 | Edge | `Soi đến` task: round 1 at commit A, fix committed as B, `Soi đến` moved to B | Verify brief diff is A..B for the scoped files; ledger kept | P1 |
| EC6 | Edge | Hunk check: pure-deletion hunk `+c,0` accepts line c; finding path written `./x.js` or `x\\y.js` matches | Accepted | P1 |
| EC7 | Edge | Round-1 `findings.json` still present when the round-2 brief is written | Output says round 2 waits for findings; the old file is not judged against the new brief and no hint asks to delete it | P0 |
| EC8 | Edge | `compass pr` brief and findings | Brief byte-identical to before; findings without disposition still accepted | P0 |
| S1 | Security | Prior finding title with a heading line and a run of backticks, shown in the verify brief | Rendered inside a fence longer than any backtick run; no heading leaks out | P0 |
| S2 | Security | Review with snapshots on a repo with a staged change | Real index bytes, HEAD and branch unchanged after phase one and phase two | P0 |
| S3 | Security | Untracked unignored `.env` next to the changed files, not in the file list | Its blob is not in the object database after the snapshot (`git cat-file -e` fails) | P0 |
| S4 | Security | Ledger copied from another task | Rejected as another task's ledger, discarded, full round 1 | P1 |
| S5 | Security | `Chấp nhận F1#<fingerprint>:` written inside a `##` section | Not counted: the kept Major still blocks | P0 |
| P1 | Performance | Round 1 over 300 changed files, then a one-file fix | Verify brief diff holds one file; phase one finishes within 20 s | P1 |
| P2 | Performance | Hunk parsing of a fix diff with 5,000 hunks | Under 1 s | P2 |
