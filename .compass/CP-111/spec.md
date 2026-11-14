# CP-111: findings per lens, and compass pr parity — --preflight and --since
Loại: feature-m
Gốc soi: a7771cc
Vòng soi tối đa: 4 — F14 là lỗi vòng 1 bỏ sót (missed), sửa hẹp trong vòng lặp gộp file lens
Phạm vi: lib/findings.mjs, lib/review-brief.mjs, commands/review.mjs, commands/pr.mjs, lib/pr-source.mjs, lib/preflight.mjs, cli.mjs, skills/compass/SKILL.md, templates/AGENTS.md, AGENTS.md, README.md, docs/huong-dan.md, test/

## Mục tiêu

Issue #7, batch 3, items 10 and 12 of "Thay đổi trong Compass", the last of the issue. The issue ran 4–6
agents per round, one per lens (matrix of real cases, deploy and operations, hostile user and a11y,
permissions, mutation, docs vs code), and found that 84% of missed defects were coverage gaps: the technique
existed but was not applied to that place. SWR-Bench 2025 measured that merging independent LLM reviews
raises F1 by up to 43.67%.

Done means:

- **Findings per lens.** Besides `evidence/findings.json`, the review gate accepts a folder
  `evidence/findings/` with one file per lens, `<lens>.json`, each in the same format and answering the same
  brief id. Compass merges them: findings are concatenated (ids must be unique across files), closures too
  (one closure per id across files), `mutants` entries too (CP-109), and coverage is merged per criterion:
  `findings` when any file says `findings`, else `insufficient` when any says so, else `clean`; a criterion
  must have a verdict in at least one file. Each merged finding records its `lens` (the file name) in the
  ledger. Lens names are `[a-z0-9-]{1,32}`.
- **Required lenses.** `config.json` may declare `"reviewLenses": { "feature-m": ["matrix", "matrix-2",
  "deploy"], … }` per task type. When the task's type has a list, each named lens must have its file, or
  the gate exits 1 naming the missing ones. No list: the folder is optional, and `findings.json` works as
  today.
- **One source at a time.** `findings.json` and `findings/` both present is an error (exit 2): Compass does
  not guess which one is current.
- **The brief says how.** When lenses are declared for the task type, the brief's "Cách nộp kết quả"
  section names the lens files to write. Otherwise the brief is byte-identical to today.
- **`compass pr --preflight`** runs the reviewer's preflight commands (from the config committed on the base
  branch, as `--run-tests` reads its test command) in the PR's temporary worktree, after the same warning
  that PR code will run on this machine. A red preflight writes no brief and puts the red command in the
  report.
- **`compass pr --since=<sha>`** reviews only what changed since `<sha>`: the brief's diff is `<sha>..<PR head>`
  and the brief lists the findings of the previous report for that PR (read from its state folder) as data
  to check, under "Findings lần trước". `<sha>` must be an ancestor of the PR head, else exit 2.
- The skill, `templates/AGENTS.md`, this repo's `AGENTS.md`, `README.md` and `docs/huong-dan.md` describe
  both.

Design choices this spec makes, which the reviewer must approve:
1. **Lenses are declared by the project, not built into Compass.** Which lenses a team runs depends on the
   code (a CLI has no a11y lens). Compass enforces the declared set; the skill suggests a default set.
2. **Coverage merges toward the worst verdict**, so a lens that saw a problem is never hidden by another
   that saw none.
3. **`--since` has no closure ledger.** `compass pr` reviews someone else's PR, whose findings carry no
   dispositions (CP-106 kept `compass pr` unchanged); listing the previous findings gives the reviewer the
   verify-round context without importing the rubric into PR review.
4. **`--preflight` reads commands from the base branch's committed config**, never from the PR's, for the
   same reason as `--run-tests` (CP-81): a PR can rewrite its own config.

Out of scope: counting how many times a lens ran, a third matrix run, claims in PR text.

## Môi trường

Không áp dụng: Compass is a CLI with no deploy stages, no database and no migrations of its own.

## Ràng buộc

- Zero dependencies.
- Reviews in flight that use `findings.json` and declare no lenses behave exactly as today; briefs stay
  byte-identical.
- `compass pr` without the new flags produces byte-identical briefs and reports.
- `--preflight` never runs without the warning, like `--run-tests`.

## Rủi ro hồi quy

- **Review phase two** reads findings from a new place; the pending-round logic (CP-106) compares the brief
  id of the findings with the previous rounds and must do so for lens files too.
- **Ledger**: findings gain a `lens` field when they come from a lens file; older ledgers still read.
- **`compass pr` state folder**: `--since` reads the previous report; a missing or unreadable one makes the
  section say so instead of failing.
- **Config**: a new optional field `reviewLenses`; `status` prints it when declared.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Two lens files `matrix.json` and `deploy.json`, same brief, one Major `fix` in deploy | Review red listing that finding; ledger finding has `lens: "deploy"` | P0 |
| H2 | Happy | Coverage: matrix says `security: clean`, deploy says `security: findings` with a finding | Merged verdict `findings`; gate accepts | P0 |
| H3 | Happy | `reviewLenses` for feature-m lists `matrix`, `deploy`; both files present, no blocking finding | Review green | P0 |
| H4 | Happy | Lenses declared: the brief names `findings/matrix.json` and `findings/deploy.json` | Brief text lists both paths | P0 |
| H5 | Happy | Verify round with lens files: closures for F1 in `matrix.json` only | Accepted; F1 closed | P1 |
| H6 | Happy | `compass pr <ref> --preflight` with a green preflight command in the base config | Brief written; report says preflight green | P0 |
| H7 | Happy | `compass pr <ref> --since=<sha>` | Brief diff is `<sha>..head` only; "Findings lần trước" lists the previous report's findings | P0 |
| V1 | Validation | Same finding id in two lens files | Exit 2 naming the id and both files | P0 |
| V2 | Validation | Lens file named `Bad Lens.json`, or a lens file whose brief id differs | Exit 2 naming the file | P0 |
| V3 | Validation | `findings.json` and `findings/` both present | Exit 2 saying to keep one | P0 |
| V4 | Validation | `reviewLenses` not an object of string arrays, or a lens name that breaks the name rule | Exit 2 naming the field | P1 |
| E1 | Error | Lenses declared, `deploy.json` missing | Exit 1 naming `deploy` | P0 |
| E2 | Error | A criterion has no verdict in any lens file | Exit 2 naming the criterion (as with one file) | P0 |
| E3 | Error | `--preflight` command red in the PR worktree | No brief; report and output name the command and exit code | P0 |
| E4 | Error | `--since` with a SHA that is not an ancestor of the PR head, or not a commit | Exit 2 naming the SHA | P0 |
| EC1 | Edge | No lenses declared, only `findings.json` | Behaviour and brief byte-identical to the code at Gốc soi | P0 |
| EC2 | Edge | `--since` when no previous report exists | Section says no previous report; brief still written | P1 |
| EC3 | Edge | `compass pr` with neither flag | Brief and report byte-identical to the code at Gốc soi | P0 |
| S1 | Security | A lens file name `../x.json` or a symlinked lens file pointing outside `evidence/` | Rejected; never read through the link | P0 |
| S2 | Security | `--preflight` when the PR changes `.compass/config.json` to add a command | The PR's command does not run; only the base branch's config is used | P0 |
| S3 | Security | `--preflight` without the warning having been shown | Never runs (same guard as `--run-tests`) | P0 |
| S4 | Security | Previous findings listed under `--since` holding fence-breaking text | Stay inside their fence | P1 |
| P1 | Performance | 20 lens files with 50 findings each | Merge within the `withinBudget` limit | P1 |
| P2 | Performance | `--since` on a PR with 2,000 commits since base | Diff is computed once over `<sha>..head`, within the `withinBudget` limit | P1 |
