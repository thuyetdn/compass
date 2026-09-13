# CP-36: A task whose work sits mid-history cannot be reviewed
Loại: feature-s
Phạm vi: lib/spec-parser.mjs, lib/review-brief.mjs, commands/review.mjs, test/spec-parser.test.mjs, test/review-command.test.mjs, SKILL.md
Gốc soi: 283b712

## Mục tiêu
CP-34 let a task name where its work starts. That is not enough for a task whose work also
*ends* before HEAD. The gate always diffs `<base>..HEAD`, so a task from the middle of the
branch is reviewed together with every commit that followed it.

Measured in this repo. CP-6's code landed at `a509f50`, 22 commits back; declaring the
commit before it produces a brief of 78 files instead of the 13 the task touched. CP-4 is
the same shape at `0b2cdc6`.

Worse, three tasks share one commit. `8dce192` carries CP-10, CP-11 and CP-13 together, so
no range alone separates them — but their declared scopes do not overlap:

- CP-10: `lib/knowledge-scan.mjs`, `lib/manifest.mjs`, `commands/knowledge.mjs`
- CP-11: `templates/investigation.md`, `lib/investigation-parser.mjs`, `commands/investigate.mjs`, `commands/scripts.mjs`
- CP-13: `commands/check.mjs`, `commands/done.mjs`, `lib/gate-store.mjs`, and the other gate commands

So two things are needed, and each is useless alone. A spec may name an end commit
(`Soi đến:`), and the diff may be narrowed to the paths the spec already declares in
`Phạm vi:`.

Neither is a way to review less. A brief holding another task's work makes the reviewer
read past what they were asked to judge; a brief spanning 78 files gets skimmed. Both end
the same way — a green gate over code nobody read.

## Ràng buộc
- `Soi đến:` follows the declared-line shape already in `lib/spec-parser.mjs`: header region
  only (above the first `##`), first occurrence wins, empty value ignored.
- Left unset, the end is HEAD — today's behaviour, unchanged.
- The end commit must be a descendant of the base, or the range is empty or reversed. Say
  so and refuse; a reversed diff reads as the task deleting code it never touched.
- Path narrowing derives from `Phạm vi:`, never from a new field. A second place to declare
  scope is a second place for it to drift from the truth.
- Narrowing applies only when `Soi đến:` is declared. A task at the tip of the branch is
  reviewed whole, so that a file it touched but forgot to declare still reaches the
  reviewer — that is how an unreviewed change gets caught today.
- A scope entry may name a file or a directory prefix. `Phạm vi:` entries are written for
  people (`lib/x.mjs (mới)`, `commands/`), so parsing must tolerate a trailing note in
  parentheses and both slash directions.
- If narrowing leaves no files, refuse. An empty brief that reads as a clean review is the
  failure this task exists to remove, the same as CP-34's empty-range case.
- The brief must state the range and the narrowing, so a reviewer can see the boundaries
  of what they were handed rather than assuming they saw everything.
- Zero runtime dependency: `node:*` and relative imports only.
- Split lines with `/\r?\n/`.

## Rủi ro hồi quy
- Every task closed so far reviewed `<base>..HEAD` with no narrowing. Specs that declare
  neither field must produce a byte-identical brief, or their `review` records go stale
  and closed tasks reopen.
- `parseSpec` feeds every gate. A second declared line must not shift `Loại:`, `Phạm vi:`,
  `Lệnh test:`, `Kiểm bằng:`, `Gốc soi:`, or the test-case table.
- `specHash` covers the spec file, so adding a line to an existing spec staleens that
  task's evidence. This task must not touch specs it is not changing.
- The scratch-index machinery in `collectDiff` stages untracked files, and `EXCLUDED`
  already carries a pathspec. Adding scope pathspecs must not drop that exclusion — a
  brief that includes `.compass/**` reopens every gate record it contains.
- Phase two compares `diffHash`. Narrowing changes the diff, so a verdict recorded against
  the wide diff must be rejected, not accepted because the range moved.
- `git diff A..B` with an end commit ignores the working tree. A task still being written
  must keep seeing its uncommitted work, so the end field must not silently hide it.

## Test cases

The dangerous direction is a brief that looks complete but is not, so E- and S-cases carry
the weight. The parser, the path filter, and the command are tested separately: a value one
function produces and another consumes is the seam CP-15 was about.

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | A spec declaring `Soi đến: <sha>` | `parseSpec` returns that ref | P0 |
| H2 | Happy | `review` on a task declaring both ends | The brief covers exactly that range, and no commit after it | P0 |
| H3 | Happy | A spec declaring neither field | Diffs to HEAD with no narrowing — today's behaviour, byte-identical | P0 |
| H4 | Happy | Two tasks sharing one commit, with non-overlapping scopes | Each brief holds only its own task's files | P0 |
| H5 | Happy | The brief states the range and whether paths were narrowed | A reviewer can see the boundary of what they were given | P0 |
| H6 | Happy | A `Phạm vi:` entry naming a directory | Every file under it is included | P1 |
| V1 | Validation | `Soi đến:` empty | Ignored; the end stays HEAD | P0 |
| V2 | Validation | The line appears twice | First wins, matching the other declared lines | P1 |
| V3 | Validation | A `Phạm vi:` entry carrying a trailing note — `lib/x.mjs (mới)` | The note is stripped; the path still matches | P0 |
| V4 | Validation | A `Phạm vi:` entry written with backslashes | Matched the same as forward slashes | P1 |
| E1 | Error | `Soi đến:` names no commit | Exit non-zero naming the ref and the spec as its source | P0 |
| E2 | Error | The end is not a descendant of the base | Refused, naming both — a reversed diff reads as deletions the task never made | P0 |
| E3 | Error | Narrowing leaves zero files | Refused. An empty brief that reads as a clean review is the failure this task removes | P0 |
| E4 | Error | The end is declared but the base is not | Still works: the base falls back as today, and the range simply ends earlier | P1 |
| EC1 | Edge | The end equals the base | Empty range, reported as such rather than as a clean review | P0 |
| EC2 | Edge | The end is HEAD, written literally | Same as not declaring it, and the brief says the range ends at HEAD | P1 |
| EC3 | Edge | CRLF spec | The declared ref carries no trailing `\r` | P0 |
| EC4 | Edge | A scope entry that is a prefix of another path — `lib/gate` against `lib/gate-store.mjs` | Only a path-segment boundary counts; a partial name must not pull in a file the task never declared | P0 |
| EC5 | Edge | The end declared inside a fenced block below a heading | Not read — the header-region rule from CP-34 still governs | P1 |
| EC6 | Edge | A scope entry naming a file that no longer exists | Skipped without error; the rest of the scope still applies | P1 |
| S1 | Security | A scope entry containing `..` or an absolute path | Rejected before reaching git; a pathspec is not a path to walk | P0 |
| S2 | Security | A scope entry starting with `-` | Not treated as a git option, the same guard the base ref already has | P0 |
| S3 | Security | Narrowing never drops the `.compass` exclusion | No gate record reaches any brief | P0 |
| S4 | Security | A verdict recorded before narrowing, replayed after | Rejected as stale; a narrowed diff is a different diff | P0 |
| S5 | Security | Narrowing is off unless `Soi đến:` is declared | A tip-of-branch task still shows a file it touched but forgot to declare — that is how an unreviewed change is caught | P0 |
