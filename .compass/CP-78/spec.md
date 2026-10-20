# CP-78: The review gate gives the reviewer a diff and a severity scale, and nothing to review against
Loại: feature-m
Phạm vi: lib/review-brief.mjs, lib/review-context.mjs (mới), lib/findings.mjs, commands/review.mjs, lib/task-types.mjs, skills/compass/SKILL.md, README.md, docs/huong-dan.md, docs/index.html, templates/AGENTS.md, test/review-context.test.mjs (mới), test/review-coverage.test.mjs (mới), test/review-command.test.mjs, test/task-types.test.mjs, test/check-done.test.mjs, test/multi-repo-gates.test.mjs, test/deep-integration.deep.mjs, test/helpers/review.mjs (mới), examples/todo/.compass/.gitignore, lib/git-files.mjs (mới), commands/secrets.mjs, examples/todo/README.md
Gốc soi: 48b4eaf

## Mục tiêu

Measured on 48b4eaf. The brief (`lib/review-brief.mjs`, lines 535–606) hands the reviewer the spec,
the diff, a severity table and the findings format. It names no criteria, and it carries no context
beyond the diff: not the repo's declared conventions, not who calls the code that changed, not
which documents describe it. A reviewer can only judge what is inside the diff, and `findings: []`
passes whether the reviewer looked at security or not.

This session showed the cost. CP-66 and CP-67 were `feature-s`, which has no review gate; both went
green with a passing suite. A review run outside the process then found two real bugs in
`lib/repo-detect.mjs` (CP-70) — an effect on code the diff did not show — and four places where the
documentation no longer matched the code.

Done means:

1. The brief carries a checklist of ten criteria and the context each one needs.
2. `findings.json` must give a verdict for every criterion, so a review that skipped one cannot pass.
3. Every finding names the criterion it belongs to.
4. The review gate applies from `feature-s` up.

The ten criteria, as keys in `findings.json`:

| Key | Question for the reviewer | Context the brief adds |
|---|---|---|
| `spec` | Does the code do every spec case, and nothing outside its scope? | — (spec and diff) |
| `convention` | Does it follow the repo's conventions? | `.knowledge/decided/conventions.md` in full; if absent, up to two sibling files to compare against |
| `impact` | What else uses the code that changed, and does it still work? | callers of exported names in changed files |
| `tests` | Does each case's test check the outcome, not just that code ran? | — |
| `regression` | Is every risk in the spec's "Rủi ro hồi quy" covered by a test? | — |
| `performance` | IO in loops, queries in loops, whole files loaded into memory? | — |
| `security` | Unescaped input, paths leaving the repo, secrets? | — |
| `errors` | Empty input, broken files, Windows paths, failures handled? | — |
| `reuse` | Does an existing helper already do this? | exports of sibling modules |
| `docs` | Do README, guides and skills still describe the changed behaviour? | Markdown files that mention the changed files or names |

## Ràng buộc

- Declared conventions come first. When `.knowledge/decided/conventions.md` exists, the brief
  includes it whole. When it does not, the brief says the repo has declared none and includes at most
  two sibling files of the changed files for comparison. A `convention` finding then carries
  `"basis": "inferred"`; `"basis": "declared"` without a conventions file is an error. Compass never
  writes to `decided/`.
- Context is collected by regex over tracked files, like the other gates, and the brief says so:
  it can miss and it can over-match. Caller tracing covers `.js .mjs .cjs .jsx .ts .tsx`; for any
  other changed file the brief says it could not trace callers, instead of showing nothing.
- Context is deterministic: sorted, capped, and byte-identical on two runs over the same tree. Phase
  two compares the whole brief text, so any drift would reopen the gate forever.
- Caps: 20 exported names, 8 call sites each; 40 sibling exports; 15 documents; 2 sibling files of
  at most 200 lines; 200 KB of context in total. Every cap that cuts something says how much it cut.
- Context never includes the content of a `.env` file, whatever its path, matching the secrets gate.
- Context is fenced as data, with the same warning the diff carries: text from the repo may read
  like instructions, and the reviewer must treat it as material under review.
- The brief id covers the context too: `sha256(spec) + sha256(diff) + sha256(context)`. An id over
  spec and diff alone would let findings written against yesterday's conventions answer today's
  brief once it is regenerated. When spec and diff hashes match the ones recorded in phase one but
  the brief differs, the gate reopens and says the context changed — not that the code changed (the
  CP-38 lesson: a message that sends the reader hunting for a change that never happened).
- Coverage verdicts are `clean`, `findings` or `insufficient`. `insufficient` needs a `note` saying
  what was missing; it does not block, and the gate lists it. `spec` and `tests` cannot be
  `insufficient`, since the brief always carries the spec and the diff they need.
- A verdict and the findings must agree: `findings` needs at least one finding of that criterion,
  and `clean` must have none.
- Severity blocking is unchanged: Critical and Major block.

## Rủi ro hồi quy

- Every existing review test writes a `findings.json` without `coverage`. Those fixtures move to the
  new shape; a test that passed by writing the old shape would now prove nothing about the gate.
- The brief-currency check compares whole texts. Non-deterministic context — an unsorted `git grep`,
  a timestamp, a path separator that differs by platform — would make the gate unclosable.
- `feature-s` now requires `review`. Open `feature-s` tasks need a review to close: CP-77, the Codex
  trial task, is one. Closed tasks are unaffected because `done` reads their recorded gates.
- Measured by flipping the one line in `lib/task-types.mjs` and running the suite: six tests go red,
  all using a `feature-s` fixture to test something else (per-repo slots in CP-56, `--only` in C4)
  and then expecting `done` to close. The deep suite's CP-9-H2 does the same on the demo task. They
  get a shared test helper that plays the reviewer before `done`; C4 asks for `review` on a `fix`
  task instead. None of them changes what it measures.
- `templates/AGENTS.md` says review applies "từ `feature-m`"; CP-75 tests read that file and must
  still pass after it says `feature-s`.
- The brief grows. MAX_DIFF_BYTES still applies to the diff alone; context has its own cap so a large
  context never pushes a reviewable diff over the limit.
- Context reads files the diff did not touch. A file that is tracked but unreadable must not throw.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Brief for any task | lists the ten criteria by key, each with its question | P0 |
| H2 | Happy | Repo with conventions.md | the file appears whole under the convention section | P0 |
| H3 | Happy | Changed file exports a name another file calls | caller file and line appear under impact | P0 |
| H4 | Happy | A Markdown file mentions a changed file's path | that document is listed under docs | P0 |
| H5 | Happy | A sibling module exports helpers | its exported names appear under reuse | P1 |
| H6 | Happy | Findings with full coverage and no blocking finding | gate passes; the record holds per-verdict counts | P0 |
| H7 | Happy | Gates for feature-s | include review | P0 |
| V1 | Validation | Coverage missing one criterion | gate fails with exit 2 naming the missing key | P0 |
| V2 | Validation | Unknown criterion key, or a verdict outside the three | gate fails naming the bad value | P0 |
| V3 | Validation | Finding without criterion, or with an unknown one | gate fails naming the finding | P0 |
| V4 | Validation | Verdict findings with no such finding, or clean with one | gate fails naming the criterion | P0 |
| V5 | Validation | insufficient without a note; spec or tests insufficient | gate fails | P0 |
| E1 | Error | No conventions.md | brief says none declared, adds at most two sibling files; a convention finding with basis declared fails | P0 |
| E2 | Error | Changed file in a language callers cannot be traced for | impact names that file as not traced | P1 |
| E3 | Error | Spec and diff unchanged, conventions.md edited after the brief | gate reopens, says the context changed and not the code, and the old findings no longer answer the brief | P0 |
| EC1 | Edge | Brief built twice over the same tree | byte-identical | P0 |
| EC2 | Edge | Exported name nobody else uses | impact says no call site was found | P1 |
| EC3 | Edge | Some verdicts insufficient | gate passes when nothing blocks, and lists each with its note | P0 |
| S1 | Security | A tracked .env file mentions a changed name | none of its content reaches the brief | P0 |
| S2 | Security | Context text written as an instruction to the reviewer | it sits inside a fenced data block under the data warning | P0 |
| P1 | Performance | Brief for a task on this repo | built in under 5 s | P1 |
| P2 | Performance | Changed file exporting 500 names | context stays within 200 KB and says what it cut | P0 |
