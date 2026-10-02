# CP-48: The review brief drops code that lives under `.compass/`, even when the task declares it
Loại: bug
Phạm vi: lib/review-brief.mjs, commands/review.mjs, test/review-compass-scope.test.mjs (mới)

## Mục tiêu

`collectDiff` excludes `.compass/**` from every review diff, because Compass's own files (specs,
gate records, briefs) are not the work under review, and a gate writing its record would otherwise
change the diff and reopen the review it just recorded.

But `.compass/scripts/` is where SKILL.md tells people to keep tools they build, and a task can be
about exactly that code. Found 02/10/2026: task LOGTIME-2 (feature-m) built a local app in
`.compass/scripts/` and declared those files in `Phạm vi:`. The review gate said "Gốc soi … cho ra
0 file — không có gì để soi" forever, so the task could not close, even though the code had been
reviewed by hand.

Done means: a path under `.compass/` that the task's own spec **declares in `Phạm vi:`** is
reviewed like any other path. That holds with or without `Soi đến:`, tracked or untracked. Every
other `.compass/` path stays excluded. A declared path is still refused when it is inside an
`evidence/` or `review/` directory, is a `review-brief.md` (gate records, findings and briefs), or
is the signing salt `.salt`. Those
are Compass's own state, and including them brings back the reopen loop or leaks the key.

## Ràng buộc

- Opt-in through `Phạm vi:` only. No new config key, nothing changes for a task that does not name
  a `.compass/` path.
- The undeclared-`.compass` exclusion and its reason stay exactly as they are.
- `Phạm vi` paths go through the existing `parseScopePaths` (rejects `-`, `:`, absolute, `..`).
- The scratch index stays scratch: the real `.git/index` is never touched (CP-46 rule).

## Rủi ro hồi quy

- **Review reopening itself**: if a gate record could enter the diff, every gate write would change
  `diffHash`. V2 covers this.
- **Leaking the salt** into a brief that goes to another agent. V2 covers this.
- **Briefs of existing tasks**: a task that names no `.compass/` path gets a byte-identical diff.
  EC2 covers this, and the whole review suite runs unchanged.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | A committed change to `.compass/scripts/tool.mjs` after the base; `compassPaths` names it | The file is in `files` and its change is in `diff` | P0 |
| H2 | Happy | An untracked new `.compass/scripts/new.mjs`, declared | It reaches the diff (scratch index `add -N`); the real index is unchanged | P0 |
| H3 | Happy | `reviewCommand` on a task whose `Phạm vi:` is `.compass/scripts/tool.mjs (mới)` and whose only change is that file | Phase one writes a brief naming that file instead of failing with "0 file" | P0 |
| V1 | Validation | `.compass/scripts/other.mjs` changed but not declared | Not in the diff | P0 |
| V2 | Validation | Declared paths `.compass/T-1/evidence/gate.json`, `.compass/T-1/review/round1.json`, `.compass/T-1/review-brief.md` and `.compass/.salt`, all changed | None of them is in the diff | P0 |
| E1 | Error | Declared `.compass/scripts/missing.mjs` that does not exist | No error; the diff is the same as without it | P1 |
| EC1 | Edge | `Soi đến` range (commit to commit) with a declared `.compass/` file changed inside the range | The file is in the diff | P1 |
| EC2 | Edge | No `.compass/` path declared | `diff` and `files` byte-identical to the result without the new option | P0 |
