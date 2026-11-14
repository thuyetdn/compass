# CP-113: four leftovers of issue #7 — claims about removed files, task id in preflight and mutation, --since before the fork, unknown lens types
Loại: bug
Gốc soi: c94f5ab
Phạm vi: lib/claims.mjs, commands/preflight.mjs, commands/mutation.mjs, commands/pr.mjs, lib/findings.mjs, skills/compass/SKILL.md, test/

## Mục tiêu

Four defects reviewers kept as Minor in CP-108, CP-110 and CP-111, each with a known cause:

1. **Claim check judges files the task removed.** A spec or doc that names a file the task deletes or
   renames away (`git mv`) is red with "không có file hay thư mục này", though the file existed at the
   review base and its removal is the task's own work. Seen on CP-112's spec. Cause: the check only
   asks whether the path exists now.
2. **`compass preflight <id>` and `compass mutation <id>` do not validate the task id** (CP-108 F7). Every
   other task command calls `validateTaskId`; these two take `../x` and write evidence outside
   `.compass/`.
3. **`compass pr --since=<sha>` accepts a commit older than the fork point** (CP-111 F5). The SHA is an
   ancestor of the PR head, so it passes, and the brief's diff then holds commits of the base branch.
4. **`reviewLenses` keys are not checked against the task types** (CP-111 F7). A typo such as `feature_m`
   turns the lens requirement off with no message.

Done means:

- A path claim whose file the task diff deletes or renames away (compared with `--no-renames` against
  the review base of the git holding the repo) is not judged; a path that never existed is still red.
- `compass preflight` and `compass mutation` reject an invalid task id with exit 2 before reading or
  writing anything, with the same message as the other commands.
- `--since=<sha>` must also have the fork point as an ancestor (the SHA is the fork point or a commit of
  the PR); otherwise exit 2 naming the SHA and the fork point.
- A `reviewLenses` key that is not a task type is exit 2 naming the key and the valid types.
- The skill states the `--since` rule and the `reviewLenses` key rule.

## Ràng buộc

- Zero dependencies.
- Briefs, reports and gate records of tasks that hit none of the four cases stay byte-identical.

## Rủi ro hồi quy

- Claim check: one more `git diff` per repo on every preflight run; a path that exists keeps being judged
  as before.
- `--since=<fork point>` keeps working: it is the whole PR.
- Configs with valid `reviewLenses` keys behave as before.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Spec names `` `lib/old.js` ``; the task deletes `lib/old.js`, and in a second case renames it with `git mv` | Preflight green in both cases | P0 |
| H2 | Happy | `reviewLenses` with key `feature-s` and valid names | Review behaves as before: brief names the lens files | P0 |
| V1 | Validation | `reviewLenses` with key `feature_m` | Exit 2 naming `feature_m` and the valid task types | P0 |
| V2 | Validation | `compass preflight ../x` and `compass mutation ../x` | Exit 2 with the task id message; nothing written outside `.compass/` | P0 |
| E1 | Error | `compass pr feature --since=<commit on main before the fork>` | Exit 2 naming the SHA and the fork point; no brief | P0 |
| E2 | Error | Spec names `` `lib/never.js` `` while the task deletes another file | Still red: "không có file hay thư mục này" | P0 |
| EC1 | Edge | `--since=<fork point>` | Accepted; brief diff is the whole PR | P1 |
| EC2 | Edge | Task deletes `lib/old.js` and the spec names `` `lib/old.js:12` `` | Not judged; green | P1 |
