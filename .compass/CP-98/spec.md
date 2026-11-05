# CP-98: review / pr show each touched repo's own conventions, or what Compass infers when it has none
Loại: feature-m
Gốc soi: bf56e53
Phạm vi: lib/review-context.mjs, lib/convention-draft.mjs, lib/repo-conventions.mjs (mới), commands/review.mjs, commands/pr.mjs, commands/convention.mjs, commands/status.mjs, commands/done.mjs, cli.mjs, test/repo-conventions.test.mjs (mới), test/review-context.test.mjs, test/pr.test.mjs, test/workspace-git.test.mjs, skills/compass/SKILL.md, docs/huong-dan.md, README.md, templates/AGENTS.md

## Mục tiêu

Issue #4. In a multi-repo workspace, a PR added a Yii2 migration using `up()`/`down()` where 438/443
migrations in the same folder use `safeUp()`/`safeDown()`. Neither review path showed the reviewer
the repo's real convention:

- Gate `review` at the workspace root saw `.knowledge/decided/conventions.md` (two rules, both about
  `.compass/scripts`), put the whole file in the brief as "the rules", and dropped the sample files.
- `compass pr` inside the sub-repo found no conventions file in the sub-repo worktree, so it gave one
  sample: the first file by name, from 2022.

Root cause: "a `conventions.md` exists" is read as "this repo declared its conventions", without
asking whether the file is about the repo being reviewed.

Done means:

1. **Per-repo conventions.** When `config.json` declares `repos`, each changed file belongs to the
   repo whose directory contains it (longest match); files outside every repo belong to the root.
   A repo's own approved conventions live at `.knowledge/decided/conventions/<repo key>.md` in the
   workspace root (decided with the user on 2026-11-05: not inside the sub-repo, so it never lands
   in the team's PRs). The root keeps `.knowledge/decided/conventions.md`. Without `repos`, the
   only unit is the root, as today.
2. **Brief, per unit.** The brief's `### convention` section has one block per unit that has changed
   files (only one unit → no extra heading, so single-repo briefs keep their shape):
   - Unit has its own file → it is shown as declared, as today.
   - Unit has none → the block says so by path, says findings are `"basis": "inferred"`, and shows
     (a) a per-directory count of the function/method names declared in the sibling files and
     (b) sample files.
   - Unit has its own file with at least one `rule` block, and no rule's `scope` matches a changed
     file → that file's directory still gets samples. A file with prose only counts as covering
     everything (Compass cannot tell what prose is about), so its brief is byte-identical to today.
3. **Per-directory count.** For each directory holding a changed file, Compass reads the sibling files
   with the same extension (not the changed ones), collects the names each file declares with
   `function`, `def` or `func` (regex on line start, after modifiers like `public static`), and
   reports each name declared by ≥ 90 % of the files when there are ≥ 20 files — the thresholds
   `convention --draft` already uses — as "`safeUp` 438/443 file". Fewer than 20 files → "n file,
   chưa đủ mẫu". At most 1,000 files per directory are read, evenly by name order, and the brief
   says when it sampled.
4. **Samples = newest by commit.** Up to 2 sample files per directory, at most 4 per unit block (a
   shared budget let the root block starve the repo block — review round 1), and folders cut by
   that budget are counted in a note: the files most recently added or modified according to
   `git log` of that directory, same extension, still present, not changed by the task. Fewer than 2
   in the log (shallow clone, no history) → filled in by name order. A folder with at most 2
   candidates takes both in name order without asking git. This replaces "first file by name, one
   per directory" for every brief.
5. **`compass convention --draft --repo=<key>`** writes `.compass/conventions-draft/<key>.md`: the
   existing draft restricted to that repo (its files, root configs plus its own configs, rule trials
   on its files), plus a section "Theo thư mục" listing every directory of the repo that meets the
   20-file / 90 % bar. Its header says to move it to `.knowledge/decided/conventions/<key>.md`.
   Plain `--draft` is unchanged.
6. **Pending item, computed not stored.** "Repo X has no approved conventions" is recomputed each time
   from whether the file exists, so it disappears exactly when the reviewer moves the draft in.
   It is printed by `compass status` (every declared repo, plus the root), by `compass done` (units
   in the task's `Phạm vi`, the root included when an entry lies outside every repo) and in
   `compass pr`'s output and `report.md` (the PR's repo). A single-repo project without
   `conventions.md` gets the root line too. It never changes an exit code (decided with the user:
   print only, do not block `done`). Repo name and command sit in code spans, so a hostile key from a
   PR's own config cannot become HTML in `report.md`.
7. **`compass pr` inside a sub-repo** reads that repo's conventions from the workspace root
   (`.knowledge/decided/conventions/<key>.md`), not from the PR's worktree.

## Ràng buộc

- Zero runtime dependencies; `lib/` never exits the process.
- Rule 5 stays: Compass only drafts. It never writes under `.knowledge/decided/`.
- The brief stays deterministic: every list sorted or in `git log` order of a fixed HEAD, no time.
- A `.env` file is never read, sampled or counted (same `isEnvFile` filter as today). Symlinks are not
  followed, for the per-repo conventions file too.
- A repo key goes into a file path only after it is checked against `repos` in `config.json` and the
  same name rules `ui`/`visual` use (no empty segment, `.`, `..`, `\`, `:`, leading `/`).
- The 200 KB context limit and its cut note still apply.
- Decided limits (said in SKILL.md): names are found by regex, not parsed — a class method written
  without a keyword (JS `foo() {}`, Java, C#) is not counted; staleness tracking (`conventionStatus`)
  stays for the root `conventions.md` only, a per-repo file gets no "có thể đã cũ" note; the
  per-directory names are not written into the draft's source mark; "newest" looks at the last 200
  commits touching the folder or its subfolders, so a folder whose subfolders take most commits can
  fall back to name order; any symlink or junction on the path to a conventions file (including
  `.knowledge` itself) makes the brief treat that file as missing, while gate `convention` still
  reads the root file through it.

## Rủi ro hồi quy

- **Every brief for a repo without declared conventions changes** (sample choice and the new count),
  so in-flight `review`/`pr` runs reopen once after upgrading, with the existing "ngữ cảnh đổi"
  message. Tests pinning first-by-name samples in `test/review-context.test.mjs` and
  `test/pr.test.mjs` move to the new rule; no other assertion there may change.
- Single-repo brief with a declared prose-only `conventions.md`, or with rules whose scope matches
  the changed files, must stay byte-identical (EC1).
- `conventionsDeclared` / `basis: declared` check: must stay true when any unit shows a declared file,
  false when none does (V3).
- Multi-repo workspaces where only a root `conventions.md` exists used to show it as the rules for
  every repo; now a repo file shows the inferred block. The root file is still shown for root files.
- Gate `convention` (rule enforcement) is not touched: root `conventions.md` rules keep applying to
  every repo exactly as today. Only the review brief and the draft command change.
- `compass pr` in a nested repo: the context reader is the git-object reader of the worktree; the
  `git log` for samples must run in the worktree's git, not the user's checkout.
- `convention --draft` without `--repo` output must not change byte-for-byte (R1).
- `compass status` and `compass done` outputs gain lines; their exit codes must not change. In
  `status` the lines go above the closing "Đọc kỹ lệnh test" line, so the config view still ends as
  before (CP-91-H5 pins that).
- **CP-84-EC1 changes meaning (added after approval).** It pinned that a repo sharing the root's git
  gives a brief identical to declaring no `repos`. Goal 1 makes every declared repo, shared git or not,
  its own conventions unit, so the context block (and the brief id that hashes it) now differs. The
  test keeps the part that is about git: scope, file list and diff stay byte-identical; only the
  context block and id may differ.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Workspace with `repos.be` (own git), root `conventions.md` whose only rule scopes `.compass/scripts/**`; task changes `be/migrations/m9.php` | brief's convention section has a `be` block saying `.knowledge/decided/conventions/be.md` is missing, a per-directory count line for `be/migrations`, and `#### Mẫu:` sample files from `be/migrations`; the root rule text is not presented as be's rules | P0 |
| H2 | Happy | `be/migrations` has 20 files declaring `safeUp`, 1 declaring `up`; task adds a file using `up` | count line says `safeUp` with `20/21`; `up` is not listed | P0 |
| H3 | Happy | `.knowledge/decided/conventions/be.md` exists with a rule whose scope matches the changed file | `be` block shows that file's text as declared; no count line, no sample for that directory; `conventionsDeclared` is true | P0 |
| H4 | Happy | Directory with 5 sibling `.php` files committed in order a,b,c,d,e (e last, b modified last of all) | the two samples are `b` and `e` (newest by commit), not `a` and `b` | P0 |
| H5 | Happy | `compass pr` run inside sub-repo `be` (nested git), PR adds a migration | brief samples are the 2 newest-by-commit siblings; the `be` block reads conventions from the workspace root; output and `report.md` both contain the pending line for `be` | P0 |
| H6 | Happy | `compass convention --draft --repo=be` | exit 0, writes `.compass/conventions-draft/be.md` containing section `Theo thư mục` with `safeUp` and its count, and naming `.knowledge/decided/conventions/be.md` as destination; nothing written under `.knowledge/decided/` | P0 |
| H7 | Happy | `compass status` in a workspace with repos `be` (no own file) and `fe` (own file) | prints the pending line for `be`, none for `fe`; exit code unchanged from before | P1 |
| H8 | Happy | `compass done` on a task whose `Phạm vi` covers `be` with no own file, all gates green | exit 0 and output contains the pending line for `be` | P0 |
| V1 | Validation | `--draft --repo=nope` where `nope` is not a key in `repos` | exit 2, message names the declared keys; no file written | P0 |
| V2 | Validation | `--draft --repo=be` when `config.json` has no `repos` | exit 2, says `--repo` needs `repos` in config | P1 |
| V3 | Validation | Findings with `basis: declared` when no unit shows a declared file, and again when one unit does | first is rejected by the coverage check, second accepted | P0 |
| E1 | Error | `git log` cannot run in the directory's git (no history: files only in the index) | samples fall back to name order; brief still built; no throw | P0 |
| E2 | Error | Own conventions file `.knowledge/decided/conventions/be.md` is a directory, or unreadable | treated as missing: inferred block shown and pending line printed; no throw | P1 |
| E3 | Error | `compass done` when `config.json` is not valid JSON | pending lines omitted, done's verdict and exit code exactly as before this task | P1 |
| EC1 | Edge | Single-repo project with prose-only `conventions.md`; and single-repo with a rule whose scope matches the changed file | convention section byte-identical to the output of the code at `bf56e53` for both | P0 |
| EC2 | Edge | Single-repo project with `conventions.md` that has rules, none matching the changed `commands/x.mjs` | declared text shown, followed by samples for `commands/`; no per-directory count line | P0 |
| EC3 | Edge | Directory with 7 sibling files, all declaring `safeUp` | count line says `7 file` and `chưa đủ mẫu`; no name stated | P1 |
| EC4 | Edge | Changed files in root (`.compass/scripts/a.mjs`) and in `be/` in one task | two blocks: root block uses root `conventions.md` as declared, `be` block inferred | P0 |
| EC5 | Edge | Repo key with a slash, `store/backend` | own file path `.knowledge/decided/conventions/store/backend.md` is read; draft goes to `.compass/conventions-draft/store/backend.md` | P1 |
| EC6 | Edge | Sibling file declares `safeUp` twice, and another mentions `function safeUp` only inside a `//` comment | counted once for the first; not counted for the second | P1 |
| EC7 | Edge | `--draft` without `--repo` on a multi-repo workspace | output byte-identical to the code at `bf56e53` | P0 |
| S1 | Security | Sibling `.env` and `.env.local` in the changed file's directory, newest by commit | never chosen as samples, never counted, their content never in the brief | P0 |
| S2 | Security | `.knowledge/decided/conventions/be.md` is a symlink to a file outside the repo | not followed: treated as missing, target content not in brief | P0 |
| S3 | Security | `--repo=../x`, `--repo=be/../..`, `--repo=C:x` | each exit 2 before any write; nothing created outside `.compass/conventions-draft/` | P0 |
| S4 | Security | A sibling file named so that `git log` prints it with a leading `-` or containing a newline | no git option injection (paths passed after `--`), brief built, odd file either sampled verbatim or skipped | P1 |
| P1 | Performance | Per-directory count on 250 vs 1,000 sibling files, interleaved pairs via `test/helpers/growth.mjs` | min ratio below 6 (linear, not quadratic) | P1 |
| P2 | Performance | Directory with 3,000 siblings | count reads at most 1,000 files and the line says it sampled | P1 |
