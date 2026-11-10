# CP-103: each sub-repo is gated by its own approved convention, drafted from 12 criteria
Loại: feature-l
Phạm vi: lib/task-types.mjs, lib/repos.mjs, lib/gates.mjs, lib/rule-runner.mjs, lib/repo-conventions.mjs, lib/convention-draft.mjs, commands/convention.mjs, commands/check.mjs, commands/done.mjs, commands/status.mjs, commands/test.mjs, commands/init.mjs, cli.mjs, skills/compass/SKILL.md, docs/huong-dan.md, README.md, templates/AGENTS.md, test/
Gốc soi: e12e3f6

## Mục tiêu

Issue #6. In a multi-repo workspace a task touching sub-repos with no approved convention passes
every gate:

1. With no conventions file, gate `convention` passes ("chưa có luật nào").
2. `init` and the gate only look at the root `conventions.md`; the root has one, so no reminder shows.
3. For each repo in `Phạm vi` the gate runs the root rules (about `.compass/scripts`) on that repo's
   code and records a pass, while the review brief reads `conventions/<repo>.md`. Gate and brief
   disagree on where a repo's rules live.
4. A repo declared in `repos` but absent from disk stops `status` and `check`, even when the task
   does not touch it, so the reminders in `status` never show either.

Decisions taken with the user on 2026-11-10 (they reverse CP-98's "the pending item does not block"):

- A sub-repo in `Phạm vi` without `.knowledge/decided/conventions/<repo>.md` turns gate `convention`
  red, for every task type. There is no spec line to waive it. `fix` and `bug` therefore gain the
  `convention` gate.
- The root is never blocked for lacking `conventions.md`, in single-repo and multi-repo projects alike.
- In a multi-repo workspace the gate scanning repo `be` runs the rules of `conventions/be.md`. A root
  rule whose `scope` matches a file of `be` (as `be/src/**` or as `src/**`) no longer runs there; it
  turns the gate red, naming the rule and the file to move it to, so a rule never stops protecting
  code silently. Root rules matching no file of the repo are ignored for that repo.
- The draft for a repo (`compass convention --draft --repo=<repo>`) gains a section "Agent đọc và
  viết": 12 criteria the agent answers after reading the repo, each needing a file as evidence or an
  explicit "Không thấy trong repo" / "Không áp dụng: <lý do>". Mixed styles become `- [ ]` items for
  the person to decide.
- A new `compass convention --approve --repo=<repo>` copies the filled draft to
  `.knowledge/decided/conventions/<repo>.md`. It refuses while a criterion is unanswered, lacks
  evidence, or an item is still `- [ ]`. The skill makes the agent stop and ask the user before
  drafting, and run `--approve` only after the user confirms.
- A repo declared but missing on disk and outside `Phạm vi` is skipped with one `ℹ` line in `status`,
  `check`, `done` and `test`. Inside `Phạm vi` it still stops them, as today.

The 12 criteria: 1 Định dạng, 2 Đặt tên, 3 Cấu trúc thư mục, 4 Phụ thuộc giữa các lớp, 5 Import và
export, 6 Kiểu dữ liệu, 7 Lỗi và log, 8 Dữ liệu và API, 9 Theo framework, 10 Test, 11 Cấu hình và bí
mật, 12 Comment và tài liệu.

## Ràng buộc

- Single-repo projects (no `repos`): gate `convention` reads the root `conventions.md` exactly as
  today; missing still passes.
- The plain `compass convention --draft` (no `--repo`) keeps every byte (CP-98-EC7 compares it with
  v3.2.1).
- A hand-written `conventions/<repo>.md` without the "Agent đọc và viết" section is valid: the gate
  only checks criteria when the section exists. The user's existing per-repo files keep working.
- `--approve` never overwrites an existing approved file, writes only under
  `.knowledge/decided/conventions/`, and refuses a symlink or junction anywhere on that path.
- Evidence counts only a path that exists inside the repo, given in backticks (optionally `:line`);
  `..`, absolute paths and links leaving the repo do not count. Lines Compass generated
  ("Câu hỏi:", "Đọc thêm:") do not count as evidence.
- Evidence is checked by `--approve` only. On every run the gate checks that the repo's file has no
  `compass-fill` line, no `- [ ]` item and no missing criterion heading, so a later task renaming a
  cited file does not turn the gate red (review round 1). "Không áp dụng" counts only with a reason
  after a colon.
- `.env` files are never listed as samples nor opened; criterion 11 lists only `.env.example`-style
  files.
- No gate record format change; `fix`/`bug` tasks closed before the upgrade stay closed, open ones
  need `check` again because `done` now requires the convention record.

## Rủi ro hồi quy

- Every multi-repo test fixture whose task runs gate `convention` without a per-repo file turns red;
  those fixtures gain a `conventions/<repo>.md`, and the change is listed per test file.
- Tests counting the gates of a `fix` or `bug` task (e.g. "4 gate đã pass") change by one.
- CP-13 per-repo slots, CP-98 pending lines in `status`/`done`/`pr`, CP-98 brief blocks: unchanged.
- Root rules written "theo gốc" (`fe/src/**`, see `lib/rule-runner.mjs`) used to run on the repo;
  they now turn the gate red with a move instruction instead.
- `resolveRepos` keeps its default behaviour for every caller not listed in Phạm vi
  (`workspace-git` has its own resolution).
- CP-89 junction repos and CP-88 outside repos keep their handling.
- In a multi-repo workspace the plain `--draft` (no `--repo`) still proposes rules like
  `scope: **/*.js` for the root `conventions.md`; adopted there, they now turn the gate red with the
  move instruction. The plain draft keeps every byte (CP-98-EC7); the docs point to `--draft --repo=`.
- The plain draft in a workspace with a declared repo missing on disk now counts the repos that exist
  instead of falling back to the whole root.

Old tests changed by this task (the decisions above change what they expect):

- `test/helpers/conventions.mjs` (new): multi-repo fixtures write a hand-written, rule-free
  `conventions/<repo>.md` per declared repo and sync knowledge, since `.knowledge/` now exists.
- `test/multi-repo.test.mjs` (CP-13): fixture uses the helper; CP-13-S5 checks the hint with gate `ui`,
  because `convention` is now required for `fix` and its hint is `compass check`.
- `test/multi-repo-gates.test.mjs` (CP-56): rules move from the root file into each repo's own file;
  knowledge is synced after dev-server files are written.
- `test/check-done.test.mjs` (CP-16-H4, H5): the "gate outside the list" is `ui`, not `convention`.
- `test/spec-hint.test.mjs` (CP-64-H4): a `fix` task closes with 5 gates, not 4.
- `test/task-types.test.mjs`: `fix` and `bug` gate lists include `convention`.
- `test/status-config.test.mjs` (CP-22-E2): a missing repo no longer fails `status`; it is listed.
- `test/worktree-skip.test.mjs` (CP-60-V2, EC2): the rules sit in the repo's own file.
- `test/convention-stale.test.mjs` (CP-82-H10, EC14, EC15): repos get own files, and the adopted root
  draft drops its rule blocks, since these cases measure the source mark, not rules.
- `test/repo-conventions.test.mjs`: CP-98-H8 now closes with the root's pending line (a sub-repo
  without a convention can no longer reach a green `done`) and checks the `be` line after its file is
  deleted; CP-98-E3 expects one more "chưa chạy" line, for `convention`.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `conventions/be.md` forbids `console.log` in `src/**`; the task adds one to `be/src/a.ts` | gate `convention` red at `be`, naming `be/src/a.ts` and the rule id | P0 |
| H2 | Happy | Root `conventions.md` holds a rule with `scope: be/src/**`; `be` has its own file | gate red naming the root rule id and `.knowledge/decided/conventions/be.md` as where to move it; the rule is not run on `be` | P0 |
| H3 | Happy | Root rules only cover `.compass/scripts/**`; `be` in `Phạm vi` lacks `conventions/be.md`; task `feature-m` | gate red naming `be`, `compass convention --draft --repo=be` and `--approve` | P0 |
| H4 | Happy | Same workspace, task `fix` | `check` runs gate `convention` and it is red the same way | P0 |
| H5 | Happy | `init` in a workspace where `be` and `fe` lack own files and `ops` has one | one line each for `be` and `fe` with the draft command, none for `ops` | P0 |
| H6 | Happy | `--draft --repo=be` | draft has "## Agent đọc và viết" with criteria 1 to 12 in order, each with a `compass-fill` line, and a sample list of files that exist in `be` | P0 |
| H7 | Happy | Draft filled with evidence, no `- [ ]`; `--approve --repo=be` | exit 0, `.knowledge/decided/conventions/be.md` equals the draft; next gate run is green with `be`'s rules | P0 |
| H8 | Happy | `repos` declares `x` with no directory; task only touches `be` | `status <id>` and `check` run to the end and print an `ℹ` line naming `x` | P0 |
| H9 | Happy | Single-repo project without `conventions.md`, tasks `fix` and `feature-s` | gate `convention` passes ("chưa có luật nào") for both | P0 |
| H10 | Happy | Hand-written `conventions/be.md` with rules but no "Agent đọc và viết" section | gate runs its rules and is green when nothing violates them | P0 |
| V1 | Validation | `--approve` while criteria 3 and 7 still carry `compass-fill` | exit 1 naming criteria 3 and 7; no approved file written | P0 |
| V2 | Validation | `--approve` while a `- [ ]` item remains | exit 1 quoting the item; no file written | P0 |
| V3 | Validation | Criterion answered but citing only a path that does not exist | exit 1 naming the criterion as lacking evidence; a criterion saying "Không thấy trong repo" passes | P0 |
| V4 | Validation | `--approve` without `--repo`, with an undeclared repo, with `--repo=../x` | exit 2 each; the undeclared case lists declared repos; nothing written | P1 |
| V5 | Validation | Approved file copied by hand with a `compass-fill` left in it | gate red at that repo naming the unanswered criterion | P0 |
| V6 | Validation | `conventions/be.md` has a broken rule block | gate red naming `.knowledge/decided/conventions/be.md` and the error | P1 |
| V7 | Validation | A draft made before the 12 criteria (no "Agent đọc và viết") | `--approve` exits 1 telling to redraft with `--force`; nothing written | P1 |
| E1 | Error | `--approve --repo=be` with no draft | exit 2 telling to run `compass convention --draft --repo=be` | P1 |
| E2 | Error | `--approve` when `conventions/be.md` already exists | exit 2, the existing file is byte-identical afterwards | P0 |
| E3 | Error | Missing repo `x` is in `Phạm vi` | `check` exits 2 with "không tìm thấy thư mục" as today | P0 |
| E4 | Error | Root `conventions.md` has a broken rule, multi-repo task | gate red naming the root file | P1 |
| E5 | Error | `conventions/be.md` is a directory | gate red treating it as missing, no crash | P1 |
| EC1 | Edge | Repo named `tools/live-translator` | gate reads `conventions/tools/live-translator.md`; draft and approve use that path, creating folders | P1 |
| EC2 | Edge | `Phạm vi` has `fe` (own file) and `be` (none) | gate red for `be` only; `fe`'s rules ran | P1 |
| EC3 | Edge | Root rule `scope: src/**`, a file `be/src/x.ts` exists | gate red naming that rule (matched as repo-relative), not silently dropped | P1 |
| EC4 | Edge | `status` without task id, missing repo `x` | exit 0; `x` listed as not on this machine | P1 |
| EC5 | Edge | Root rule `scope: .compass/scripts/**`, `be` has its own file | that rule causes nothing for `be`; gate green | P1 |
| EC6 | Edge | Evidence written as `` `src/a.ts:12` `` passes; `` `../outside.txt` `` does not | approve accepts the first, names the criterion for the second | P1 |
| EC7 | Edge | Items ticked `- [x]` with a decision | approve accepts them | P1 |
| EC8 | Edge | A `fix` task whose evidence has every old gate but no convention record | `done` is red naming gate `convention` | P1 |
| S1 | Security | Repo holds `.env` and `.env.example` | draft samples never list `.env`; criterion 11 lists `.env.example`; `.env` content never appears | P0 |
| S2 | Security | `conventions/be.md` is a symlink or junction to an outside file | gate treats it as missing; outside content not used | P0 |
| S3 | Security | `.knowledge/decided/conventions` is a junction to an outside folder | `--approve` refuses, nothing written outside | P0 |
| S4 | Security | The draft file is a symlink or junction to an outside file | `--approve` refuses to read it | P1 |
| P1 | Performance | Root-rule matching against a repo of growing size | time grows linearly with file count (growth helper) | P2 |
| P2 | Performance | `--draft --repo=be` on 2000 tracked files in 200 folders | sample list holds at most 20 files from at most 10 folders | P2 |
