# CP-109: mutation on changed lines — a mutation gate before review, survivors handed to the reviewer
Loại: feature-m
Gốc soi: f0e69f0
Phạm vi: lib/mutation.mjs (mới), commands/mutation.mjs (mới), lib/gates.mjs, lib/task-types.mjs, lib/findings.mjs, lib/review-brief.mjs, lib/preflight.mjs, commands/check.mjs, commands/done.mjs, commands/review.mjs, cli.mjs, skills/compass/SKILL.md, templates/AGENTS.md, AGENTS.md, README.md, docs/huong-dan.md, docs/index.html, test/

## Mục tiêu

Issue #7, batch 3, item 9 of "Thay đổi trong Compass". The issue measured that mutation first ran after
more than 40 rounds and only on a sample (about 1 mutant per 80–165 changed lines), while test gaps were
still 62% of the findings of the last round. Google's review-time mutation (ICSE-SEIP 2018) puts at most
one mutant on each changed line and shows survivors to the reviewer instead of gating on a score.

Done means:

- **A new gate, `mutation`**, runs in `compass check` after `test` and before `ui`, for `feature-s`,
  `feature-m` and `feature-l`. It is a per-repo gate (`mutation@<repo>` in a multi-repo project).
  - It runs only when `config.json` declares `"mutation"` for the repo (shared level or per repo, per-field
    merge): `{ "test": "<command>", "setup": "<command>", "max": 40, "timeout": 600 }`. `test` is required;
    the others are optional. `max` defaults to 40, `timeout` (seconds, for the whole gate) to 1200.
  - Nothing declared: the gate passes and says mutation is not declared.
- **Which lines.** Added or modified lines (new side of the hunks) of the task diff, in files that are not
  tests or docs. A file is a test when its path has a `test/`, `tests/`, `__tests__/` or `spec/` segment, or
  its name contains `.test.` or `.spec.`. Docs are `.md`, `.mdx`, `.txt`, `.json`, `.yml`, `.yaml`,
  `.lock`, `.html`, `.css` files. Lines that are blank or only a comment (`//`, `#`, `/*`, `*`, `<!--`)
  are skipped.
- **Which mutant.** At most one mutant per line: the first operator from a fixed list that applies to the
  line outside string literals, in this order: `===`→`!==`, `!==`→`===`, `==`→`!=`, `!=`→`==`, `&&`→`||`,
  `||`→`&&`, `>=`→`>`, `<=`→`<`, `>`→`>=`, `<`→`<=`, `true`→`false`, `false`→`true`, `return `→
  `return !` only when followed by an identifier or `(`, `+ 1`→`- 1`, `- 1`→`+ 1`. A line with no applicable
  operator gets no mutant. When there are more candidates than `max`, Compass takes `max` of them spread
  evenly over the candidate list in diff order, so the choice is the same on every run.
- **How it runs.** Compass snapshots the working tree (tracked and untracked, not ignored) into a git tree
  with a temporary index, as review snapshots are made (CP-106), checks it out into a temporary worktree
  with hooks off (the `withWorktree` helper of `compass pr`), runs `setup` there once if declared, then the
  test command once unmutated. That baseline must pass; if it fails the gate is red and says so. Then,
  one mutant at a time, Compass edits the file in the worktree, runs the test command, and restores the
  file. A mutant is killed when the command exits non-zero, survives when it exits 0, and counts as
  "not run" when the time budget is used up. The worktree is removed in `finally`. The user's working tree,
  index, HEAD and branch are never touched.
- **The record.** The gate writes `evidence/mutants.json` (per repo in a multi-repo project): each mutant
  with an id (`M1`, `M2`… in diff order), file, line, operator, original line, mutated line and result.
  The gate record carries counts, `sourceHash`, `configHash` and `specHash`. The gate is green when the
  baseline passed and every mutant ran or was cut by the budget; survivors do not make the gate red.
  "Not run" mutants are listed in the output with the reason.
- **Survivors go to the reviewer.** The round-1 brief gets a section `## Mutant sống` with each survivor
  (id, file:line, original and mutated line, in a fence) and the rule: each survivor needs, in
  `findings.json`, either a finding with `"mutant": "<id>"` (criterion `tests`, disposition per the
  rubric), or an entry in a new top-level list `"mutants": [{ "id": "M3", "verdict": "equivalent",
  "reason": "…" }]` when the mutant cannot change behaviour. The review gate exits 2 when a survivor has
  neither, or has both, or when an entry names an id that is not a survivor. Verify rounds carry no
  `## Mutant sống` section: the mutation set belongs to round 1.
- **Review refuses to write a brief** while `mutation` is declared for a repo in scope and that repo's
  record is missing, red, or older than the code or config (same rule as preflight, CP-108).
- `compass mutation <id>` runs the gate alone. The skill, `templates/AGENTS.md`, this repo's `AGENTS.md`,
  `README.md`, `docs/huong-dan.md` and `docs/index.html` describe it.

Design choices this spec makes, which the reviewer must approve:
1. **Survivors do not gate by themselves; the reviewer disposes of them.** The issue says "mutant sống chưa
   được xử lý thì đỏ". The author must not judge their own mutants (the same reason the reviewer writes
   dispositions, CP-106), so "xử lý" happens in findings, through the rubric that already exists.
2. **A separate mutation test command.** Running the full suite once per mutant is too slow (this repo's
   suite takes about 6 minutes; 40 mutants would take 4 hours). The project declares a fast command, and
   is responsible for it covering the changed code.
3. **A text mutator, no parser.** Zero dependencies rule out an AST. The operators work on the common
   syntax of JS, TS, PHP, Python, Java and C#. Operators inside string literals are skipped by a simple
   quote scan on the line; a multi-line string can still be mutated, which at worst yields an equivalent
   mutant the reviewer marks `equivalent`.
4. **Importing a Stryker or Infection report is out of scope.** Neither report proves it was produced from
   the current code (Infection's JSON carries no source), so Compass could not tie it to the evidence.
5. **The worktree comes from a snapshot, not from HEAD**, so uncommitted work is mutated too, and the
   user's files are never edited in place.
6. **Applies from `feature-s`**, where review exists. `fix` and `bug` have no review to hand survivors to.

Out of scope: claim check (CP-110), findings per lens and `compass pr` parity (CP-111), detecting tests
that only read source with a regex (left to the `tests` criterion of review).

## Môi trường

Không áp dụng: Compass is a CLI with no deploy stages, no database and no migrations of its own.

## Ràng buộc

- Zero dependencies.
- The user's working tree, index, HEAD, branches and refs are never changed; temporary worktrees are
  removed, and their registration pruned, even when a test command throws or the budget runs out.
- `compass pr` is unchanged; its brief stays byte-identical.
- Briefs of tasks without `mutation` declared stay byte-identical, so reviews in flight are not reopened.
- `done` never reads config to decide whether a gate passed (CP-33).

## Rủi ro hồi quy

- **Tasks in flight of type feature-s and up**: `done` now asks for a `mutation` record. With nothing
  declared, `check` writes a green one in milliseconds.
- **Review**: the findings parser accepts a new top-level `mutants` list and a `mutant` field on a finding.
  Findings without them behave as before; CP-106 and CP-107 rubric tests must stay green unchanged.
- **Leftover worktrees** from a killed run: the same sweep `compass pr` uses removes them on the next run.
- **Multi-repo**: one `mutation@<repo>` slot per repo; `status` lists them (CP-108 fix).
- **Docs and gate counts**: README and `docs/index.html` state the number of gates (CP-58, CP-72 tests).

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | feature-s task, `mutation.test` declared, a changed line `if (a > b) return 1;` covered by a test that fails when it changes | Gate green; `mutants.json` has M1 with operator `>`→`>=`, result `killed` | P0 |
| H2 | Happy | A changed line whose mutant no test catches | Gate green; M1 `survived`; round-1 brief has `## Mutant sống` with M1, file:line and both lines | P0 |
| H3 | Happy | Reviewer submits a finding with `"mutant": "M1"`, criterion `tests`, disposition `fix` | Review red with that finding in "Cần sửa", like any fix finding | P0 |
| H4 | Happy | Reviewer submits `"mutants": [{ "id": "M1", "verdict": "equivalent", "reason": "…" }]` and no finding for it | Review green; ledger round 1 records the mutant verdict | P0 |
| H5 | Happy | `setup` declared (writes a marker file the test command needs) | setup runs once in the worktree before the baseline; gate green | P1 |
| H6 | Happy | Multi-repo, `mutation` declared only for `be` | `mutation@be` ran mutants, `mutation@fe` green "chưa khai"; `done` and `status` read both slots | P0 |
| H7 | Happy | `compass mutation <id>` run alone | Same record and `mutants.json` as through `check` | P1 |
| V1 | Validation | `"mutation": "npm test"`, `{}` (no test), `{ "test": "" }`, `{ "test": "x", "max": 0 }`, `{ "test": "x", "timeout": -1 }` | Gate exit 2 naming the field; nothing runs | P0 |
| V2 | Validation | A survivor M2 with neither a finding nor a `mutants` entry | Review exit 2 naming M2 and both ways to answer it | P0 |
| V3 | Validation | A `mutants` entry for an id that is not a survivor, a verdict other than `equivalent`, an empty reason, or M1 answered both ways | Review exit 2, one error each | P0 |
| E1 | Error | The unmutated baseline fails in the worktree | Gate red: baseline failed, last 40 lines of its output; no mutant runs | P0 |
| E2 | Error | `setup` exits non-zero | Gate red naming setup and its exit code; no baseline, no mutant | P0 |
| E3 | Error | `mutation` declared, record missing or older than the code, then `compass review` | Review exit 1, no brief, says to run `compass check <id>` | P0 |
| E4 | Error | The time budget runs out after two mutants | Gate green; the rest are `not-run`, listed with "hết thời gian"; worktree removed | P1 |
| EC1 | Edge | 100 candidate lines, `max: 10` | Exactly 10 mutants, the same 10 on a second run, spread over the list (first and last candidate regions both present) | P0 |
| EC2 | Edge | Changed lines only in `test/x.test.js`, `README.md` and a comment line | No mutant; gate green saying no line to mutate | P0 |
| EC3 | Edge | `if (s === "a > b")` — the only operator outside the string is `===` | Mutant is `===`→`!==`; the `>` inside the string is untouched | P0 |
| EC4 | Edge | An uncommitted changed line (not in HEAD) | It is mutated: the worktree comes from the snapshot, not HEAD | P0 |
| EC5 | Edge | Task with `mutation` not declared | Review brief byte-identical to the brief built by the code at Gốc soi | P0 |
| EC6 | Edge | Verify round after round 1 had survivors | Verify brief has no `## Mutant sống`; findings of round 2 need no `mutants` entries | P1 |
| S1 | Security | A test command that edits a tracked file and creates a branch in the worktree | User's working tree, index, HEAD and branch list unchanged after the gate; no `compass-*` worktree left registered | P0 |
| S2 | Security | `mutants.json` edited by hand after the gate | Review rejects it: the record's hash of `mutants.json` no longer matches | P0 |
| S3 | Security | A survivor's original line holds a run of backticks and `## ` text | It stays inside its fence in the brief | P0 |
| S4 | Security | Mutation record copied from another task | `done` rejects it; review treats mutation as not green | P1 |
| P1 | Performance | 2,000 changed lines, `max: 40` | Choosing the 40 mutants takes under the `withinBudget` limit (no per-line git call) | P1 |
| P2 | Performance | 40 mutants with a test command that takes about 0 s | Gate finishes within the `withinBudget` limit; one worktree for all mutants, not one per mutant | P1 |
