# CP-108: preflight gate before review: declared commands, a check for edited applied migrations, and environment facts in the spec and brief
Loại: feature-m
Gốc soi: f6e12f5
Phạm vi: lib/preflight.mjs (mới), lib/task-diff.mjs (mới), commands/preflight.mjs (mới), lib/gates.mjs, lib/task-types.mjs, lib/config.mjs, lib/spec-parser.mjs, lib/spec-validator.mjs, lib/review-brief.mjs, commands/check.mjs, commands/done.mjs, commands/review.mjs, commands/init.mjs, commands/status.mjs, cli.mjs, lib/review-rounds.mjs, lib/test-parser.mjs, templates/spec.md, docs/index.html, skills/compass/SKILL.md, templates/AGENTS.md, AGENTS.md, README.md, docs/huong-dan.md, test/

## Mục tiêu

Issue #7, batch 2: items 5, 6 and 7 of the issue's "Thay đổi trong Compass". The issue measured that 8 of
10 Majors needed facts outside the diff (which migration already ran on which stage, another team's PR,
the deploy pipeline), and that each kind surfaced only in the first round whose brief carried it. It also
lists machine checks (lint, typecheck, "an applied migration was edited") that should fail before any
agent reads the code.

Done means:

- **A new gate, `preflight`**, runs in `compass check` after `convention` and before `test`, for every task
  type. In each repo in scope it runs, in order, the migration check, then each command declared in
  `config.json` under `"preflight"`, and stops at the first red one.
  - `"preflight"` is a list of non-empty shell commands, declared at the shared level or per repo (per
    field merge, like `devUrl`).
  - Two placeholders are replaced before the command runs. `{changed}` becomes the task's added and
    modified files in that repo, relative to the repo directory, each in double quotes, separated by
    spaces. `{base}` becomes the full SHA of the review base of the git holding that repo. Other braces are
    left as they are.
  - A command using `{changed}` when the repo has no changed file is skipped, with an `ℹ` line.
  - A red command makes the gate red. The output names the command, its exit code and the last 40 lines
    of its output; the full output goes to `evidence/preflight.log` (per repo in a multi-repo project).
  - With nothing declared (no `preflight`, no `migrations`), the gate passes and says nothing is declared.
  - The record carries `sourceHash`, `configHash` and `specHash`, so `done` treats it like `test`: code,
    config or spec changed after the gate ran means run `check` again.
  - In a multi-repo project it is a per-repo gate: one slot `preflight@<repo>` per repo in scope, like
    `convention`.
  - `compass preflight <id>` runs it alone.
- **The migration check.** `"migrations"` in config is a list of globs (same syntax as a convention rule's
  `scope`: `**`, `*`, `?`), relative to the repo directory, shared or per repo. A file matching a glob that
  exists at the review base and is modified, deleted or renamed away in the task's diff makes the gate red.
  The output names each file and the base commit, and prints the line to add. An added migration file is
  fine. The spec header line `Ngoại lệ migration: <path> — <reason>` (path as the output prints it,
  relative to the Compass root) exempts that one file. A reason is required.
- **`compass review` refuses to write a brief** while preflight is not green on the current code: when the
  config declares `preflight` or `migrations` for a repo in scope and that repo's `preflight` record is
  missing, red, or has a `sourceHash` or `configHash` that no longer matches. It writes a red `review`
  record and says to run `compass check <id>`. With nothing declared, review behaves as today.
- **`## Môi trường` in the spec.** For `feature-m` and `feature-l` the section is required; for the other
  types it is optional, and validated the same way when present. It holds either a table
  `| Sự thật | Nguồn | Ngày |` with at least one row, where every row has a fact, a source and a date
  `YYYY-MM-DD` that exists in the calendar, or one line `Không áp dụng: <reason>`. `templates/spec.md` gets
  the section, with a row the spec gate rejects until it is filled.
- **The brief puts the environment right above the diff.** When the spec has `## Môi trường`, or the task's
  diff touches a file matching `migrations`, the round-1 brief and every verify brief get a section
  `## Môi trường (đọc trước diff)` placed right before the diff. It holds the spec's table or
  `Không áp dụng` line verbatim, then a list of migration files in the diff, each marked added, modified
  or deleted. The section is part of the brief id. A task with neither gets a byte-identical brief.
- **Upstream lag** goes into the `preflight` output as an `ℹ` line per git: commits behind and ahead of the
  branch's upstream, read from local refs, with the date of the last fetch (`FETCH_HEAD`), or "no upstream".
  It never makes the gate red.
- The skill, `templates/AGENTS.md`, this repo's `AGENTS.md`, `README.md` and `docs/huong-dan.md` describe
  preflight, `migrations`, `Ngoại lệ migration` and `## Môi trường`.

Design choices this spec makes, which the reviewer must approve:
1. **Upstream lag is not in the brief.** The issue asks Compass to add it to the brief. But the brief text
   is the brief's identity: a `git fetch` would change it and reopen a finished round for a full re-review.
   The lag goes into preflight output instead, where the author sees it before round 1 (the issue's
   "rebase once before round 1").
2. **Preflight applies to every task type**, like `secrets` and `convention` since CP-103: a one-line fix can
   edit an applied migration as easily as a feature. With nothing declared it costs one git call.
3. **The migration check reads the same diff as `review`**: same base (`Gốc soi`, `reviewBase`, or the
   branch point), same `Soi đến`, same sub-repos with their own git. A second notion of "the task's diff"
   would let the two gates disagree. That diff logic moves from `commands/review.mjs` into
   `lib/task-diff.mjs`, used by both, without changing what review sees.
4. **File names that cannot be quoted safely are refused, not escaped.** A changed file whose name holds
   `"`, `$`, `` ` ``, `%`, `\`, a newline or a carriage return makes a `{changed}` command red with the file
   named. Escaping rules differ between `cmd.exe` and `sh`, and a wrong guess runs part of a file name as
   a command.
5. **`Ngoại lệ migration` is a requirement line**, not a review-mechanics line: it changes what the code may
   do, so it stays in the spec text the review ledger hashes. Added during review, it restarts at round 1.
6. **Review checks preflight only when something is declared.** `done` cannot read config to decide (a
   rule since CP-33), so `done` always asks for a green, fresh `preflight` record.

Out of scope: claim check, mutation on changed lines, findings per lens, `compass pr --preflight` and
`--since` (batch 3). A timeout for preflight commands (the `test` gate has none either).

## Môi trường

Không áp dụng: Compass is a CLI with no deploy stages, no database and no migrations of its own.

## Ràng buộc

- Zero dependencies. Commands run through the existing `runCommand` of `lib/test-runner.mjs`.
- `compass pr` is unchanged; its brief stays byte-identical.
- Briefs of tasks without `## Môi trường` and without a migration file in the diff stay byte-identical, so
  reviews in flight are not reopened by the upgrade.
- `done` never reads config to decide whether a gate passed (CP-33).
- Preflight never writes into the user's repo; it only runs the declared commands.

## Rủi ro hồi quy

- **Tasks in flight.** `done` now asks for a `preflight` record, so a task whose gates all ran before the
  upgrade must run `compass check` once more. With nothing declared that takes one git call.
- **Approved `feature-m`/`feature-l` specs without `## Môi trường`** fail the spec gate after the upgrade.
  Adding the section changes the spec, so it needs approval again, and a review in flight restarts at
  round 1. The spec gate error says what to add.
- **Review tests and multi-repo tests** that build their own gate records for `done` must add a
  `preflight` record. The order of gates in `check` output gains one line.
- **Moving the diff logic out of `review.mjs`** could change the review diff. Every existing review test
  (review-command, review-rounds, multi-repo, review-brief-*) must stay green unchanged.
- **`status`** lists gates per task; it must list `preflight` and its slots.
- **Shell differences.** `{changed}` uses double quotes, which both `cmd.exe` and `sh` read as one
  argument for the allowed characters. A command written for one shell still fails on the other, as
  `test` commands do today.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Config `"preflight": ["node -e \"process.exit(0)\""]`, one repo, task with one changed file; `compass check` | Preflight passes and runs between `convention` and `test`; `gate.json` has a green `preflight` record with `sourceHash`, `configHash`, `specHash` | P0 |
| H2 | Happy | Command `node print-args.js {changed}` where the script prints its arguments; task changed `src/a.js` and `src/b c.js` and deleted `src/d.js` | Script receives exactly `src/a.js` and `src/b c.js` as two arguments; no `src/d.js` | P0 |
| H3 | Happy | Command `node print-args.js {base}` | Script receives the full 40-character SHA of the review base declared in `Gốc soi` | P0 |
| H4 | Happy | `"migrations": ["db/migrations/*.sql"]`; task adds `db/migrations/002.sql` | Preflight passes | P0 |
| H5 | Happy | Task modifies `db/migrations/001.sql`, which exists at the base; spec header has `Ngoại lệ migration: db/migrations/001.sql — fixes a typo in a comment, not yet applied anywhere` | Preflight passes; output names the exempted file | P0 |
| H6 | Happy | Multi-repo config (`be`, `fe`), `preflight` declared only for `be`; Phạm vi covers both | Slots `preflight@be` (ran the command) and `preflight@fe` (nothing declared) are both green; `done` accepts them | P0 |
| H7 | Happy | Spec `feature-m` with `## Môi trường` table of two valid rows | Spec gate passes | P0 |
| H8 | Happy | Same spec, task diff adds `db/migrations/002.sql` (globs declared) | Round-1 brief has `## Môi trường (đọc trước diff)` right before the diff section, holding the spec table verbatim and `db/migrations/002.sql` marked added | P0 |
| H9 | Happy | Branch with an upstream that is 2 commits ahead of local | Preflight output has an `ℹ` line saying 2 commits behind upstream; gate green | P1 |
| H10 | Happy | `compass preflight <id>` run alone | Same record as through `check`; exit 0 | P1 |
| V1 | Validation | `"preflight": "npm run lint"` (a string), `[""]`, or `[42]` | Gate exit 2; error names the field and what it must be; no command runs | P0 |
| V2 | Validation | `"migrations": "db/*.sql"` or `["../outside/*.sql"]` or `["/abs/*.sql"]` | Gate exit 2; error names the bad entry | P0 |
| V3 | Validation | Spec header `Ngoại lệ migration: db/migrations/001.sql` with no reason, or with no path | Spec gate red; error names the line number and what is missing | P0 |
| V4 | Validation | `feature-m` spec without `## Môi trường` | Spec gate red; error says the section is required for feature-m and shows both accepted forms | P0 |
| V5 | Validation | `## Môi trường` row with date `2026-02-30`, `13/11/2026`, empty source, or empty fact | Spec gate red, one error per bad row naming the row | P0 |
| V6 | Validation | `## Môi trường` is `Không áp dụng:` with no reason, or empty | Spec gate red | P1 |
| E1 | Error | A preflight command exits 3 after printing 100 lines | Gate exit 1; output names the command, exit code 3 and the last 40 lines; `evidence/preflight.log` has all 100; later commands do not run | P0 |
| E2 | Error | Task modifies `db/migrations/001.sql` that exists at the base, no exception line | Gate exit 1; output names the file and the base SHA (7 chars) and prints `Ngoại lệ migration: db/migrations/001.sql — <lý do>` | P0 |
| E3 | Error | Task deletes `db/migrations/001.sql`; separately, task renames it to `db/migrations/001b.sql` | Both red, naming `db/migrations/001.sql` | P0 |
| E4 | Error | Preflight declared, record missing or red, then `compass review <id>` | Exit 1; no brief written; red `review` record; output says preflight is not green and to run `compass check <id>` | P0 |
| E5 | Error | Preflight green, then code edited, then `compass review <id>` | Same as E4 (record stale by `sourceHash`) | P0 |
| E6 | Error | Preflight green, then `done` after editing `config.json` | `done` red: config changed after `preflight` ran | P0 |
| EC1 | Edge | Command uses `{changed}`, repo has no changed file (diff touches only another repo) | Command skipped with an `ℹ` line; gate green | P0 |
| EC2 | Edge | Nothing declared, single repo, `fix` task | Gate green with a line saying no preflight or migrations is declared; `done` accepts the record | P0 |
| EC3 | Edge | Spec without `## Môi trường` (feature-s) and no migration in the diff | Brief byte-identical to the brief before this change (compared against the brief built by the code at `Gốc soi`) | P0 |
| EC4 | Edge | Sub-repo `be` with its own git and its own `Gốc soi (be)`; task edits `be/db/migrations/001.sql` that exists at be's base | Gate red naming `be/db/migrations/001.sql` and be's base SHA | P0 |
| EC5 | Edge | `## Môi trường` in a `bug` spec with an invalid date | Spec gate red (optional section still validated) | P1 |
| EC6 | Edge | Command contains other braces, e.g. `node -e "console.log({a:1})"` | Braces passed through unchanged | P1 |
| S1 | Security | Changed file named `src/$(touch pwned).js` (POSIX) or `src/%PATH%.js`, command uses `{changed}` | Gate exit 1 naming the file; the command does not run; no file `pwned` is created | P0 |
| S2 | Security | `Ngoại lệ migration:` line placed below the first `##` heading (inside a section) | Not honoured: E2's red result stands | P0 |
| S3 | Security | `preflight` record copied from another task, or hand-edited to exit 0 | `done` rejects it (signature/task check), and `review` treats preflight as not green | P0 |
| S4 | Security | Task edits `db/migrations/001.sql` whose content holds the line `password=hunter2`; migration check red | Gate output and `preflight.log` name the path and base SHA only; `hunter2` appears in neither | P1 |
| P1 | Performance | Nothing declared, repo with 300 changed files | Preflight finishes within the `withinBudget` limit used by other gate tests | P1 |
| P2 | Performance | `migrations` declared, 300 changed files of which 200 match the glob and exist at the base | Gate red listing 200 files, within the `withinBudget` limit; the edited files come from one `git diff --no-renames` call per git (a file modified or deleted against the base exists at the base), not one call per file | P1 |
