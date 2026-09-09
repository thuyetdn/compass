# CP-34: `reviewBase` is one project-wide value, so an older task reviews the wrong diff
Loại: bug
Phạm vi: lib/spec-parser.mjs, commands/review.mjs, lib/review-brief.mjs, test/spec-parser.test.mjs, test/review-command.test.mjs, SKILL.md
Gốc soi: 59c0b75

## Mục tiêu
`reviewBase` lives in `.compass/config.json`, so every task on the branch shares one
starting point. On a branch carrying many tasks, that value can only be right for one of
them. For the rest the `review` gate builds a brief from the wrong range — and the
failure is silent: an agent reviews whatever the diff contains, files findings, and the
gate turns green on evidence about code the task never touched.

Reproduced in this repo. `reviewBase` is `9fd11a8`, the second-newest commit. CP-6's code
landed at `a509f50`, 21 commits earlier; CP-10 and CP-11 at `d98a9d9`. `git diff 9fd11a8
HEAD` covers 28 files belonging to CP-30 through CP-33 and contains none of the five
older tasks' work. Running `compass review CP-6` today would hand a reviewer that diff
and accept the verdict as CP-6's.

The fix: a task declares its own starting point in its spec, the way it already declares
`Lệnh test:` and `Kiểm bằng:`. Config keeps `reviewBase` as the project default for tasks
that declare nothing.

Working around it by editing config between tasks is not a fix: `configHash` changes with
every edit, so closing one task staleens the evidence of every task already closed.

## Ràng buộc
- The spec line follows the existing declared-line shape in `lib/spec-parser.mjs`
  (`Lệnh test:`, `Kiểm bằng:`): first occurrence wins, an empty value is ignored.
- The line counts only in the header region — above the first `##` heading, where
  `Loại:` and `Phạm vi:` already sit. Documentation and examples live under headings, so
  none of them can reach it. Four attempts at reading markdown fences instead all failed,
  the worst of them letting a line inside a documentation example decide the review range.
  Position is measurable; "is this line an example?" is not.
- Precedence is spec over config. A task that declares nothing behaves exactly as today,
  including the walk back to the branch point when config declares nothing either.
- A declared ref that git cannot resolve must fail loudly, naming the ref and where it was
  declared. `lib/review-brief.mjs:47` already refuses an invalid config ref; a spec ref
  gets the same treatment, because a silently-ignored base is the very failure this task
  exists to remove.
- The declared value is part of the spec, so it is covered by `specHash`. Changing it
  changes the spec, which needs re-approval — that is correct, not a nuisance to route
  around.
- Zero runtime dependency: `node:*` and relative imports only.
- `lib/` returns values, never calls `process.exit` or `console.log`.
- Split lines with `/\r?\n/`. The CRLF pitfall has recurred in four files.

## Rủi ro hồi quy
- `parseSpec` feeds every gate. A new field must not shift or shadow `Loại:`, `Phạm vi:`,
  `Lệnh test:`, `Kiểm bằng:`, or the test-case table, and specs that omit it must parse
  byte-identically to today.
- `specHash` covers the spec file, so adding a line to any existing spec staleens that
  task's evidence. This task must not add the line to specs it is not changing.
- The 2MB diff refusal in `lib/review-brief.mjs:176` names `reviewBase` in its advice.
  With a per-task base available, that advice must point at the spec line too, or it sends
  the reader to the one knob that cannot fix their case.
- Phase two compares `diffHash` against the recorded one. A changed base changes the diff
  and so the hash — a stale verdict must still be rejected, not accepted because the
  range moved.
- `compass status` reads config. Adding a spec-level field must not make it report the
  config value as authoritative for a task that overrides it.

## Test cases

The dangerous direction is a base that resolves to the wrong range without complaint, so
E- and S-cases carry the weight. The parser and the command are tested separately: a field
one function produces and another consumes is where CP-15's mismatch lived.

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | A spec declaring `Gốc soi: <sha>` | `parseSpec` returns that ref | P0 |
| H2 | Happy | `review` on a task whose spec declares a base | The brief covers the range from that ref, not the config one | P0 |
| H3 | Happy | A spec declaring nothing, config declaring `reviewBase` | Config value is used — today's behaviour, unchanged | P0 |
| H4 | Happy | Neither declares anything | Walks back to the branch point, exactly as today, and the brief says no base was declared rather than naming config.json — which holds no such line | P0 |
| H5 | Happy | The brief states which base it used and where that came from | Reviewer can tell the range was deliberate, not a default that happened to apply | P1 |
| V1 | Validation | The declared value is empty (`Gốc soi:` alone) | Ignored, same as an empty `Lệnh test:`; falls back to config | P0 |
| V2 | Validation | The line appears twice with different refs | First wins, matching `Lệnh test:` | P1 |
| V3 | Validation | The value has surrounding whitespace | Trimmed before use | P2 |
| E1 | Error | The declared ref is not a valid commit | Exit non-zero naming the ref AND saying it came from the spec, not config | P0 |
| E2 | Error | The declared ref is valid but not an ancestor of HEAD | Reported rather than silently producing a reversed or empty diff | P0 |
| E3 | Error | Config's `reviewBase` is invalid while the spec's is valid | The spec value wins, so the gate runs — an unused config value must not block | P1 |
| EC1 | Edge | The ref is a branch name or tag, not a sha | Resolved through git like any other ref | P1 |
| EC2 | Edge | Spec uses CRLF line endings | The declared ref carries no trailing `\r` | P0 |
| EC3 | Edge | The declared ref is `HEAD` itself | Produces an empty diff, and the gate says the range is empty rather than reporting a clean review | P0 |
| EC4 | Edge | Example declarations under headings, appearing BEFORE any header-region line | Ignored. Putting the real one first would let first-wins alone decide, which tests nothing about position | P0 |
| EC6 | Edge | A declaration that appears only below the first `##` heading | Not read: it is documentation, not a declaration. Falls back to config | P0 |
| EC7 | Edge | A section whose text contains a fenced block | Section text is untouched, fence lines included — an earlier version deleted them and changed how three live specs parse | P0 |
| EC11 | Edge | A base that IS an ancestor but whose diff is empty (work committed then reverted) | Reported as an empty range without claiming the base equals HEAD — a different branch from EC3, and one no case anchored | P1 |
| EC5 | Edge | The 2MB refusal message on a task that declares its own base | Advises the spec line, not only config's `reviewBase` | P1 |
| E5 | Error | Config declares a falsy `reviewBase` (`0`, `""`, `false`) | `resolveBase` ignores it, so the brief must say nobody declared a base — claiming "khai ở config.json" would attribute the range to a value never used | P1 |
| E4 | Error | Config declares a non-string `reviewBase` (e.g. `123`) | Refused with a message naming the type — never a thrown TypeError, whose stack skips every ledger write and leaves a stale green review record behind | P0 |
| S1 | Security | The declared value contains shell metacharacters (`; rm -rf /`, backticks, `$(…)`) | Never reaches a shell; rejected or passed as a single argument | P0 |
| S2 | Security | The declared value starts with `-` (`--upload-pack=…`) | Not treated as a git option — an argument that turns into a flag runs someone else's command | P0 |
| S3 | Security | Phase two with a recorded `diffHash` from a different base | Verdict rejected as stale; a moved range never launders an old pass | P0 |
| S4 | Security | A spec declaring a base that excludes the task's own changes | The gate reports an empty or unrelated range instead of accepting a green review — the exact failure CP-6 hit | P0 |
