# CP-110: claim check — false paths, commits and function names in changed docs make preflight red
Loại: feature-m
Gốc soi: b1d8271
Phạm vi: lib/claims.mjs (mới), lib/preflight.mjs, commands/preflight.mjs, lib/spec-parser.mjs, lib/spec-validator.mjs, skills/compass/SKILL.md, templates/AGENTS.md, AGENTS.md, README.md, docs/huong-dan.md, test/

## Mục tiêu

Issue #7, batch 3, item 8 of "Thay đổi trong Compass". The issue measured that 57% of documentation
findings (24 of 42: PR text, spec, comments) were things a script could catch, and cites Tan, Wagner and
Treude: over a quarter of 1,000 popular GitHub repos reference stale code in their docs.

Done means:

- **The `preflight` gate (CP-108) gets a third built-in step, the claim check**, after the migration check
  and before the declared commands. It runs whenever preflight runs, with or without anything declared.
- **What it reads.** Added lines (new side of the hunks) of Markdown files (`.md`, `.mdx`) in the task diff
  of that repo, and every line of the task's spec outside its `## Test cases` section (test cases describe
  fixtures, whose file names are made up). Fenced code blocks are skipped (they hold examples). Only inline
  code spans are claims; prose is never parsed.
- **Three kinds of claim**, each checked against the repo as it stands:
  1. **Path.** A span with no whitespace, no glob or placeholder character (`* ? [ ] { } < >`), not a URL,
     no `…`, not starting with `-`, that contains a `/` or ends in a file extension. It is checked only when its
     first segment exists at the top of the repo or of the Compass root (`lib/…`, `commands/…`,
     `db/…`); then the whole path must exist, as a file or directory, relative to the repo or to the
     Compass root. A trailing `:<line>` is removed before the check. A first segment that exists nowhere
     (`evidence/gate.json`, relative to some other folder) is not a claim the check can judge, and is
     skipped.
  2. **Commit.** A span of 7 to 40 hex characters with at least one digit and one letter. It must name a
     commit in the git holding that repo (`git cat-file -e <sha>^{commit}`).
  3. **Function.** A span `name()` or `name(…)` where `name` is an identifier (letters, digits, `_`, `$`,
     and `.` between parts). The last part must appear as a whole word in a tracked non-Markdown file of
     the repo, tracked or untracked but not ignored (one `git grep -w -F` call for all names of a repo).
- **A false claim makes preflight red.** The output names the file and line (the spec as
  `.compass/<id>/spec.md:<line>`), the span, and why: "không có file hay thư mục này", "không phải commit
  trong git này", "không thấy tên này trong code".
- **A human can exempt one claim** with a spec header line `Tuyên bố ngoài repo: <span> — <reason>`, for a
  path or name in a repo Compass does not see. The span is compared exactly. A reason is required; the spec
  gate rejects the line without one.
- The skill, `templates/AGENTS.md`, this repo's `AGENTS.md`, `README.md` and `docs/huong-dan.md` describe
  the claim check and the exemption line.

Design choices this spec makes, which the reviewer must approve:
1. **Only added lines of changed docs, plus the spec.** Checking whole files would make every task pay for
   old docs it never touched; the issue's point is docs that drift during the task.
2. **Paths are checked only when anchored.** Docs name paths relative to many folders. Requiring the first
   segment to exist at the top of the repo keeps false alarms down: a typo such as lib/preflght.mjs is
   caught, `evidence/gate.json` (relative to a task folder) is not judged.
3. **Test counts, `org/repo#n` and enum values are out of scope.** A count needs to know which suite and
   which reporter line the prose refers to; an issue reference needs the network; an enum needs a parser.
   Each would be guessed from text, and a guessed red blocks `done` for everyone.
4. **Part of preflight, not a new gate**, because it is a cheap machine check that must run before an agent
   reads the brief, which is what preflight is for. It also adds no record type `done` must learn.

Out of scope: mutation (CP-109), findings per lens and `compass pr` parity (CP-111), claims in commit
messages and PR text.

## Môi trường

Không áp dụng: Compass is a CLI with no deploy stages, no database and no migrations of its own.

## Ràng buộc

- Zero dependencies.
- No network access.
- Never prints file contents beyond the claimed span and its line number.
- Briefs and `compass pr` are unchanged.

## Rủi ro hồi quy

- **Every task now runs the claim check in preflight**, including tasks with nothing declared. A task in
  flight whose spec or changed docs hold a false claim turns red on the next `check`. The output names
  each claim and the exemption line.
- **Specs name files they will create** (`lib/x.mjs (mới)`). At `check` time the file exists; before the code
  is written, preflight is not run, so this is not a regression. A spec naming a file the task later
  dropped turns red, which is the point.
- **This repo's own docs and specs** must pass the check on the next tasks; their added lines are what is
  checked, not existing text.
- **Time**: one `git grep` for all function names of a repo, one `git cat-file --batch-check` for all SHAs.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Changed `README.md` adds a line naming `` `lib/a.js` ``, which exists | Preflight green | P0 |
| H2 | Happy | Added doc line names the base commit SHA in backticks | Green | P0 |
| H3 | Happy | Added doc line names `` `parseThing()` `` and `lib/a.js` defines `parseThing` | Green | P0 |
| H4 | Happy | Spec header has `Tuyên bố ngoài repo: lib/other.js — lives in the payments repo` and a doc names `` `lib/other.js` `` | Green; output has an `ℹ` line naming the exempted span | P0 |
| H5 | Happy | Multi-repo: `be/README.md` adds `` `src/b.js` ``, which exists under `be/` | Green for `preflight@be` | P1 |
| H6 | Happy | Path with a line suffix `` `lib/a.js:12` `` | Checked as `lib/a.js`; green | P1 |
| V1 | Validation | `Tuyên bố ngoài repo: lib/x.js` with no reason, or with no span | Spec gate red naming the line number | P0 |
| V2 | Validation | `Tuyên bố ngoài repo:` placed below the first `##` heading | Not honoured: the claim stays red | P0 |
| E1 | Error | Added doc line names `` `lib/preflght.mjs` `` (typo; `lib/` exists) | Preflight red: file and line of the doc, the span, "không có file hay thư mục này" | P0 |
| E2 | Error | Added doc line names `` `deadbeef1` ``, not a commit | Red: "không phải commit trong git này" | P0 |
| E3 | Error | Added doc line names `` `parseTing()` `` that appears nowhere in code | Red: "không thấy tên này trong code" | P0 |
| E4 | Error | The spec's `## Mục tiêu` names `` `lib/missing.js` `` | Red, located as `.compass/<id>/spec.md:<line>` | P0 |
| E5 | Error | Claim check red, then `compass review <id>` | Review exit 1, no brief (preflight not green, CP-108 rule) | P1 |
| EC1 | Edge | The false path sits inside a fenced code block of an added doc section | Not checked; green | P0 |
| EC2 | Edge | False claim in a doc line the task did not add (unchanged context) | Not checked; green | P0 |
| EC3 | Edge | Spans `` `evidence/gate.json` ``, `` `src/*.js` ``, `` `<id>/spec.md` ``, `` `https://x.y/a.js` ``, `` `--force` `` | None is judged; green | P0 |
| EC4 | Edge | `` `a1b2c3d` `` that is 7 hex chars but all of one class (`aaaaaaa`, `1234567`) | `aaaaaaa` and `1234567` are not treated as SHAs | P1 |
| EC6 | Edge | The spec's `## Test cases` table names a made-up fixture path under an existing top folder | Not checked; green | P0 |
| EC7 | Edge | A span holding `…` such as a path ending in an ellipsis under an existing top folder | Not judged; green | P1 |
| EC5 | Edge | `` `obj.method()` `` where only `method` is defined | Green: the last part is what is looked up | P1 |
| S1 | Security | A span holding `$(touch pwned)` or `; rm -rf x` shaped like a path | Never reaches a shell: git is called with an argument array; no file `pwned` is created | P0 |
| S2 | Security | A span starting with `-` such as `` `--output=x` `` or a SHA-shaped `-abc1234` | Never passed to git as a flag | P0 |
| S3 | Security | A claim in a `.env` file or a file whose content holds a secret | Output names path, line and span only; no other content of the line | P1 |
| P1 | Performance | 500 added doc lines with 300 claims, 50 distinct function names | Within the `withinBudget` limit; one `git grep` call for the 50 names | P1 |
| P2 | Performance | 200 distinct SHA claims | Within the `withinBudget` limit using one `git cat-file --batch-check` call | P1 |
