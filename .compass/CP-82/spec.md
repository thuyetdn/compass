# CP-82: compass convention --draft — read a repo's conventions, propose conventions.md, and notice when it goes stale
Loại: feature-m
Phạm vi: commands/convention.mjs, commands/init.mjs, lib/convention-draft.mjs (mới), lib/review-context.mjs, lib/rule-runner.mjs, cli.mjs, skills/compass/SKILL.md, templates/AGENTS.md, README.md, docs/huong-dan.md, docs/index.html, test/convention-draft.test.mjs (mới), test/convention-stale.test.mjs (mới), test/helpers/convention-repo.mjs (mới)
Gốc soi: af5fc3b

## Mục tiêu

A repo without `.knowledge/decided/conventions.md` gets no convention check: the convention gate
passes with "no rules", and the review gate leaves the reviewer to guess from two sample files. Each
reviewer may guess differently, and nothing is written down. Most repos do state their conventions,
though: in lint and formatter configs, and in what the code already does consistently.

`compass convention --draft` reads those and writes a draft. A person reads it, edits it, and moves
it into `decided/` themselves. Done means a repo with an `.editorconfig`, a Prettier config, an ESLint
config and consistent code gets a draft that:
- states each convention with the evidence behind it (the config line, or "412 of 430 files"),
- proposes `forbid-pattern` rules only where they are true today, and
- passes the convention gate on the current code once moved into `decided/`.

A draft is only half the job: conventions drift. A formatter config changes, or the team moves from
double to single quotes, and `conventions.md` goes on saying the old thing. Done also means the check
runs by itself, with no one asking for it. It does not wait for someone to say "check". It runs at
every point the workflow always passes through:
- `compass init`, the first step of every task, so a task never starts on missing or stale
  conventions without the agent knowing;
- the convention gate, so every `compass check`;
- every review brief.

All three use one function and print the same lines:
- **Missing.** No `decided/conventions.md`: the gate still passes, and adds one line pointing at
  `compass convention --draft`.
- **Stale.** The draft carries a source mark, an HTML comment that survives the move into
  `decided/`. It records the hash of each config file it read and the count behind each counted
  convention. The gate recomputes both. It warns with one line per reason (old and new counts for a
  counted convention; the file's name for a config, since the mark keeps only its hash),
  when:
  - a recorded config changed or disappeared,
  - a known config file appeared that was not recorded, or
  - a counted convention fell below 90 %, lost its majority, or dropped under 20 files.

  Either way the gate still passes: a stale convention is not wrong code.
- **What the skill does.** SKILL.md tells the agent that a "missing" or "stale" line, wherever it
  appears, means: run `--draft` straight away, without being asked, show the person what differs
  from the file in use, and wait (Rule 5). It never edits `decided/` on its own. After `init`, this
  happens before the spec is written, so the spec and the code follow the conventions the person
  just confirmed.
- **Reviewers see it.** The review brief's convention section (`compass review`, and `compass pr`
  once CP-81 lands) says when the conventions in use look stale and why. The reviewer then does not
  hold the code to rules the repo has left.

## Ràng buộc

- **The draft is never a decision.** It goes to `.compass/conventions-draft.md`, never into
  `.knowledge/decided/` (Rule 5: the knowledge base is decided by people). The command prints how
  to adopt it. An existing `decided/conventions.md` is never read as input or touched.
- **Deterministic.** Same tree, same draft, byte for byte. No network and no agent call; reading the
  code is plain counting.
- **Sources, in this order:**
  - `.editorconfig`
  - Prettier: `.prettierrc`, `.prettierrc.json`, and the `prettier` key in `package.json`
  - ESLint: `.eslintrc.json`, and `eslint.config.*` listed by name only, because JS configs are not run
  - `tsconfig.json` (`strict`)
  - `package.json` scripts named `lint`, `format`, `test`
  - counts over tracked code files: indentation, quote style, semicolons, file-name case, test-file naming
- **Executable configs are never run.** A `.js` or `.mjs` config is listed as "khai ở <file>, Compass
  không chạy file này". Its contents are not guessed.
- **A rule is proposed only if it holds.** Each proposed `forbid-pattern` rule is run against the
  current tree with the existing rule runner, and is kept only if it finds zero matches. Rules come
  out as `severity: warn`; a person raises them to `error`.
- **A convention is stated only with enough support.** A counted convention needs at least 20 files,
  and 90 % of them must agree. Below that it is listed under "Không nhất quán" with the split, not
  stated as a rule.
- An existing draft is overwritten only with `--force`. Without it the command exits 2 and says so.
- Reuse the tracked-file listing from `lib/git-files.mjs`, `stripComments` from `lib/repo-detect.mjs`,
  and the rule parser and runner. Do not copy them.
- **Tracked files only**, minus tracked files deleted from the working tree. That holds for code
  files, config files and the trial run of candidate rules. A scratch file that one person has not
  added must not change the draft or the stale verdict. A folder outside any git repo (the root of a
  multi-repo project) has nothing to ask, so its configs are read as they are on disk.
- Mark fields are percent-encoded for `%`, `>` and whitespace, so a path with a space round-trips
  and no value can close the comment early.
- A `prettier` key in `package.json` that names a shared config package is listed by name, not
  ignored.
- **Multi-repo layouts work.** The Compass root of a multi-repo project need not be a git repo.
  Files are listed in each declared repo and named from the Compass root (`fe/src/x.js`). Configs
  are read at the root and in each repo (`fe/.prettierrc`). The missing or stale line is printed
  once per gate run, not once per repo.
- **Content counts are sampled on big repos.** File names are counted on every tracked code file.
  Indentation, quotes and semicolons are read from at most 1,000 files, spread evenly in name order,
  and only the first 64 KB of each. The draft says so whenever it sampled.
- Files over 1 MB, binaries and symlinks are skipped. A repo with no tracked code still gets a draft
  holding only the config sections.
- **The source mark is data, not a path list to follow.** The gate re-reads only the known config
  names from the source list above, at the repo root. A mark entry naming anything else, like
  `../../x` or an absolute path, is ignored and reported. A malformed mark gives one warning and no
  stale verdict.
- A `decided/conventions.md` written by hand, with no mark, gets one info line: Compass cannot tell
  whether it is stale. It is never called stale without evidence.
- The stale check never changes the gate's exit code, and never writes a file.
- One counting function serves the draft and the stale check, so they cannot disagree on what "38 of
  40" means.

## Rủi ro hồi quy

- `compass convention` without `--draft` must behave exactly as today. That covers every existing
  convention gate test.
- The rule runner gains a caller and a `files` option, and now reads with `lstat`. Its output for
  the gate must not change: the gate's own walk never yields symlinks, so skipping non-regular files
  changes nothing there.
- The review gate reads `decided/conventions.md`. A draft in `.compass/` must not be read as declared
  conventions, so `basis: declared` stays impossible without the real file.
- `compass init` output is checked by CP-59 and CP-80 tests (one gitignore line, nothing else). The
  convention line is a separate line, and a repo with fresh conventions prints nothing new.
- The convention gate runs inside `compass check` for every task type. The stale check adds time
  there, so it is held to a budget (P3). On a repo with no mark it must cost nothing beyond reading
  the file.
- Brief ids hash the context. Adding a stale note changes the brief, and therefore the id, only when
  the note is present; a repo without conventions keeps byte-identical briefs.
- `.compass/conventions-draft.md` sits in the tracked part of `.compass/`. That is on purpose: people
  can see the draft in a diff before adopting it.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Repo with `.editorconfig` (`indent_size = 2`), `.prettierrc` (`singleQuote`, `semi: false`) and 30 matching files | draft states 2-space indent, single quotes and no semicolons, each with its source line | P0 |
| H2 | Happy | 40 files, 38 in kebab-case | draft states kebab-case file names with "38 / 40" | P0 |
| H3 | Happy | Draft moved into `.knowledge/decided/conventions.md` | `compass convention` passes on the same tree | P0 |
| H4 | Happy | Tests all named `*.test.mjs` under `test/` | draft states the test-file pattern and folder | P1 |
| H5 | Happy | No code uses `var` and ESLint sets `no-var` | a `forbid-pattern` rule for `var` with `severity: warn` | P1 |
| V1 | Validation | Fewer than 20 code files | counted conventions go under "Chưa đủ mẫu", not stated | P1 |
| V2 | Validation | Quotes split 60 / 40 | listed under "Không nhất quán" with the split | P0 |
| V3 | Validation | `.prettierrc` that is not valid JSON | the draft names the file as unreadable; the command still exits 0 | P1 |
| V4 | Validation | A candidate rule that matches 3 places today | the rule is left out, and the draft says it is not proposed because 3 places break it | P0 |
| E1 | Error | Draft already exists, no `--force` | exit 2, file untouched | P0 |
| E2 | Error | Not a git repo | exit 2 with a reason, nothing written | P1 |
| E3 | Error | The draft path cannot be written (a folder sits there), with `--force` | exit 1 with a reason, no partial or temporary file | P2 |
| EC1 | Edge | Repo with configs but no code files | draft holds only config sections and says no code was counted | P1 |
| EC2 | Edge | Same tree, two runs with `--force` | byte-identical drafts | P0 |
| EC3 | Edge | An existing `decided/conventions.md` | read for nothing, untouched; the draft notes it exists | P0 |
| EC4 | Edge | Tabs in `.editorconfig` but the code uses spaces | both are stated, and the conflict is flagged for a person to settle | P1 |
| S1 | Security | `eslint.config.js` that writes a marker file when run | the marker never appears; the draft lists the file as not run | P0 |
| S2 | Security | A link named `.prettierrc` pointing outside the repo (a symlink, or a junction where symlinks need privileges) | not followed; listed as skipped | P1 |
| S3 | Security | A config value holding Markdown or a fence (`"x```y"`) | appears inside a code span or a fence and cannot break the draft's structure | P1 |
| P1 | Performance | 5,000 tracked code files, 60 MB | draft under 10 s, measured through `withinBudget` | P1 |
| P2 | Performance | One 900 KB file of long lines | counted once, no quadratic cost | P2 |
| H6 | Happy | Convention gate on a repo with no `decided/conventions.md` | passes, and one line points at `compass convention --draft` | P0 |
| H7 | Happy | Draft adopted into `decided/`, nothing changed since | gate passes with no stale line | P0 |
| H8 | Happy | `compass init` on a repo with no conventions, and on one whose `.prettierrc` changed after adoption | `init` prints the same missing or stale line as the gate, still exit 0 and the task is created | P0 |
| H9 | Happy | SKILL.md's text on these lines | tells the agent to run `--draft` without being asked, before writing the spec, and to wait for the person | P1 |
| EC5 | Edge | `.prettierrc` edited after adoption | gate passes and warns stale, naming `.prettierrc` | P0 |
| EC6 | Edge | Adopted with single quotes at 95 %, code now at 70 % | gate warns stale naming quotes, with the old and the new split | P0 |
| EC7 | Edge | `.editorconfig` added after adoption | gate warns that a new config was not part of the draft | P1 |
| EC8 | Edge | Review brief built while the conventions in use are stale | the brief's convention section states the stale reasons | P1 |
| V6 | Validation | Hand-written `decided/conventions.md` with no mark | one info line saying Compass cannot tell; no stale verdict | P0 |
| V7 | Validation | A mark that is cut short or malformed | one warning about the mark, no stale verdict, gate exit unchanged | P1 |
| S4 | Security | A mark entry naming `../../outside.json` and an absolute path | neither is read; both are reported as ignored | P0 |
| EC9 | Edge | 25 test files at the repo root, draft adopted unedited | the mark parses; the gate reports no broken mark and no stale line | P0 |
| H10 | Happy | Multi-repo root that is not a git repo, with `fe/` and `be/` each a git repo and `fe/.prettierrc` | draft exits 0, counts files of both repos, reads `fe/.prettierrc`; after adoption an edit to it is reported as stale | P0 |
| EC10 | Edge | Multi-repo project without conventions, gate run for all repos and for each repo the way `check` runs it | the missing line appears once, not once per repo | P1 |
| V8 | Validation | A code file, a `console.log` file under an ESLint `no-console` rule, and a `.prettierrc`, none added to git | the draft is byte-identical to the one without them | P0 |
| V10 | Validation | A `.prettierrc` created but not added after adoption | no stale line | P0 |
| EC14 | Edge | A test folder `my tests/`, and a multi-repo repo at path `web app` | the adopted mark parses and the gate reports no broken mark | P0 |
| H11 | Happy | `package.json` with `"prettier": "@acme/prettier-config"` | the draft lists the shared config by name | P2 |
| EC15 | Edge | Multi-repo: `fe/test/` and `be/test/` hold the tests; after adoption `be` adds more tests under `test/` | the test folder is stated as `test/`, and the gate reports no stale line | P0 |
| EC16 | Edge | Files without semicolons that hold styled-components CSS (`color: red;`) in template literals | semicolons are stated as "không dấu chấm phẩy", not inconsistent | P1 |
| S7 | Security | A committed symlink among the tracked files during the rule trial | not followed (measured where the machine can create file symlinks) | P1 |
| V9 | Validation | A tracked file deleted from the working tree | not counted | P1 |
| S5 | Security | A config value holding a lone `\r` before `## x` | no heading is created | P1 |
| S6 | Security | A config value holding the mark's opening line | the real mark at the end of the file is the one read | P1 |
| EC11 | Edge | Only `.compass/conventions-draft.md` exists, no `decided/` file | the review brief says the repo has not declared conventions | P1 |
| EC12 | Edge | `init` on a repo whose adopted conventions are still fresh | prints no convention line | P1 |
| EC13 | Edge | Review brief with fresh adopted conventions | the convention section has no stale note, only the declared-rules line and the file | P1 |
| P3 | Performance | Gate with a mark on 5,000 tracked code files | stale check under 10 s through `withinBudget`; with no mark, no file is counted | P1 |
