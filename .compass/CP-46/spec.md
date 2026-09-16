# CP-46: A file that is `git add`-ed but not committed is missing from the review brief
Loại: bug
Phạm vi: lib/review-brief.mjs, test/review-brief-staged.test.mjs (mới)
Gốc soi: 871dcaa

## Mục tiêu

`collectDiff` builds a scratch index and seeds it with `read-tree HEAD` — from the last commit,
not from the real index. It then registers untracked paths with `add -N`, taken from
`ls-files --others`. A file that has been `git add`-ed is neither: it is not in `HEAD`, so
`read-tree` does not bring it in, and it is no longer "other", so nothing adds it. It vanishes.

Measured on HEAD (871dcaa) in a fresh repo holding all three kinds of change:

| Change | In the diff |
|---|---|
| `base.js` — tracked, edited, not staged | yes |
| `untracked.js` — new, never added | yes |
| `staged.js` — new, `git add`-ed | **no** |

The comment above the call states the opposite of what the code does: "read-tree seeds the
scratch index from the real index so tracked edits are visible". It seeds from `HEAD`.

The consequence lands where the gate is supposed to be strongest. The brief still generates,
the reviewer reads what it was given, finds nothing wrong with it, and `review` goes green over
a file nobody read. A reviewer cannot report what a brief does not show.

Done means: all three kinds of change reach the diff. The scratch index is copied from the real
index, and `add -N` covers both untracked paths and paths staged as additions that the base does
not have.

## Ràng buộc

- The scratch index stays a scratch index: `GIT_INDEX_FILE` still points into a temp directory,
  and the repository's own `.git/index` is never written. A test asserting the real index is
  byte-identical afterwards is mandatory — an earlier manual check in this session corrupted a
  probe repo by letting a `GIT_INDEX_FILE` command fall back to the real one.
- `EXCLUDED` filtering, the `ADD_BATCH_CHARS` batching, the pathspec in `scope`, and the
  `Soi đến`/`scopePaths` narrowing are untouched. This task changes how the index is seeded and
  what gets `add -N`-ed, nothing else.
- No new dependency. Git is already the only tool this function uses.
- `collectDiff(root, {...})` keeps its signature and return shape.
- A repository with no commits at all must keep returning what it returns today, rather than
  failing on a copy step — the fallback path exists and E2 measures it.

## Rủi ro hồi quy

- **A committed task's diff could go empty.** The current comment warns that seeding from `base`
  makes `diff base` compare base with itself. Seeding from the real index must not reintroduce
  that: H3 measures a task whose work is fully committed and asserts its files are still there.
- **Untracked files could stop appearing**, since `add -N` now takes a second source. H2 keeps
  the untracked case, and EC1 keeps the many-files batching path alive.
- **A deleted file.** `git rm` stages a deletion, which is a staged path that is not an addition.
  EC2 pins that it still shows as a deletion rather than being re-added by `add -N`.
- **Compass's own `.compass/` writes.** `EXCLUDED` keeps gate records out of the diff; a change
  to what is added could let them back in and reopen a review the gate just recorded. EC3
  measures that a staged file under `.compass/` stays out.
- **Every other review test.** `test/review-command.test.mjs` covers the surrounding flow and
  must stay green.

- **The commit-to-commit path is a different branch of the same function.** When `Soi đến` is
  given, `collectDiff` diffs two commits and builds no scratch index at all, so this fix cannot
  reach it. EC4 pins that it still behaves as it does today — including that narrowing switches
  off when `Soi đến` points at HEAD, which is deliberate.


## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | A repo with one commit, then a new file `git add`-ed | `staged.js` is in `files` and in the diff text | P0 |
| H2 | Happy | Same repo: a tracked edit, an untracked file, and a staged file together | all three are in `files` | P0 |
| H3 | Happy | A task whose work is entirely committed after the base | the committed files are in `files` — the diff does not go empty | P0 |
| V1 | Validation | A staged file whose content is empty | appears in `files`; no throw | P1 |
| V2 | Validation | A staged file with a space in its name | appears in `files` with the name intact | P1 |
| E1 | Error | The real `.git/index` is byte-identical before and after `collectDiff` | unchanged — the scratch index never writes through | P0 |
| E2 | Error | A repo with no commits at all | returns the same shape it returns on HEAD today; no throw | P0 |
| EC1 | Edge | 60 untracked files plus 3 staged ones, exceeding one `add -N` batch | all 63 are in `files` | P1 |
| EC2 | Edge | A tracked file removed with `git rm` (staged deletion) | shows as a deletion in the diff; not resurrected | P0 |
| EC3 | Edge | A staged file under `.compass/CP-46/evidence/` | absent from `files` — `EXCLUDED` still holds | P0 |
| EC4 | Edge | `scopePaths` narrowing with `Soi đến` naming a commit behind HEAD | the out-of-scope file is filtered out — this path never builds a scratch index, so it must stay untouched | P1 |
| S1 | Security | A staged path containing `..` in a subdirectory name | handled as a path, not traversal; no write outside the repo | P1 |
| P1 | Performance | 200 staged files | `collectDiff` returns in under 5 s | P2 |
