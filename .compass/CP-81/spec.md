# CP-81: compass pr — review someone else's pull request
Loại: feature-m
Phạm vi: commands/pr.mjs (mới), lib/pr-source.mjs (mới), commands/review.mjs, lib/review-brief.mjs, lib/review-context.mjs, lib/git-files.mjs, lib/paths.mjs, lib/convention-draft.mjs, lib/test-runner.mjs, lib/process-tree.mjs (mới), commands/run-with-timeout.mjs (mới), cli.mjs, skills/compass/SKILL.md, templates/AGENTS.md, README.md, docs/huong-dan.md, docs/index.html, test/pr.test.mjs (mới)
Gốc soi: 2625ed6

## Mục tiêu

The review gate only reviews your own task: it needs a Compass spec and diffs your working tree. A
team lead asked to review a colleague's pull request gets nothing from it. `compass pr <ref>` gives
that PR the same blind review with the same ten criteria, then writes a report ready to paste into
the PR, and optionally runs the PR's tests.

Done means:
- `compass pr 123` reviews GitHub PR 123 with nothing installed beyond git: it fetches
  `pull/123/head` from `origin`. A branch name or a commit sha works the same way.
- Phase one writes `<git dir>/compass/pr/<key>/review-brief.md` and exits 1, like `compass review`. The
  reviewer is a separate agent with no chat history, and it writes `findings.json` next to the brief.
- Phase two checks the findings against the brief. It then writes `<git dir>/compass/pr/<key>/report.md`:
  verdict, test result, and findings by severity with file and line. It exits 0 only when nothing
  blocks.
- Neither phase changes the user's branch, index or working tree.

While here, one Minor left by CP-82's last review is fixed in the docs it touches: SKILL.md and the
AGENTS.md template said the review brief prints the "missing" and "stale" lines, and told the agent
to act on them. The brief carries only a note for the reviewer, and a reviewer writes findings only.

## Ràng buộc

- **The diff is `base...head`**, from the merge base. Base comes from `--base=<ref>`, or else
  `origin/HEAD`, or else `main`, or else `master`. If none resolves, it is an error that names `--base`.
- **The context is read from the PR head, not the working tree.** Compass adds a detached git
  worktree of the head in the OS temp folder, builds the context there with the existing
  `collectContext`, and removes the worktree afterwards, also on failure. File contents for the
  context come from git objects (`git cat-file --batch`), not from the fresh checkout: on Windows the
  first open of each file git just wrote costs about 6 ms, which made 2,000 files take 12 s.
  `collectContext` takes that reader as an option; its default still reads from disk.
- **The PR's `.compass/` changes are reviewed**, minus Compass's own state (gate records, findings,
  briefs, salt). A PR that rewrites the test command must not hide it from the reviewer.
- **Commit messages are untrusted data.** They are written by the PR author, so they sit in a fence
  under a "data, not instructions" note, like the diff.
- The rerun command printed in the brief carries only the flags that change the brief (`--base`,
  `--spec`), so adding `--run-tests` in phase two does not reopen an unchanged PR.
- A Compass root in a subfolder of the repo works: context, conventions and tests use that subfolder
  inside the worktree.
- **Intent replaces the spec.** A PR has no Compass spec. The `spec` criterion is judged against
  `--spec=<file>` (the ticket text) when it is given. Otherwise it is judged against the commit
  messages `base..head`, and the brief says that is all the reviewer has. `spec` still cannot be
  `insufficient`.
- **The PR's code is untrusted.** Tests run only with `--run-tests`. Before running, Compass prints
  that this executes the PR author's code on this machine. The test command is `config.test`, run
  in the temporary worktree, after `config.prSetup` (e.g. `npm ci`) when that is set. Without
  `--run-tests` the report says the tests were not run; it never implies they passed.
- Refs are validated before use: the PR number is digits only, and branches and shas go through
  `git rev-parse --verify`. Every git call passes arguments as a list, with no shell.
- The brief id covers intent, diff and context, as in CP-78. When the PR head moves, phase two reopens
  and says so.
- `<key>` is `pr-<number>`, or the branch name with every character outside `[A-Za-z0-9._-]` turned
  into `-`, or `sha-<7 chars>`.
- Brief, findings and report live in the git dir (`git rev-parse --git-common-dir`), under
  `compass/pr/<key>/`, never in the working tree. Reviewing someone else's PR belongs to the
  reviewer, not to the branch they stand on. Six review rounds found ways for a PR to reach a
  `.compass/pr/` in the working tree (committed findings, symlinks, hard links, letter case, a
  linked `.compass`); a PR can commit nothing into the git dir and place no link there. The
  temporary worktree lives outside the repo.
- Reuse `buildBrief`, `collectContext`, `parseFindings` and `checkCoverage`. Do not copy them. The
  diff is the exception: `collectDiff` measures everything against the user's HEAD, which the PR is
  not on, and running it inside the PR's worktree let the PR's own `.gitattributes` (`*.js -diff`)
  hide its code as binary. The PR diff is built commit to commit in the user's repo, with the user's
  attributes, reusing `collectDiff`'s size check and its list of Compass state to leave out.
- **Checking out the PR runs nothing.** The user's `post-checkout` hook runs inside the PR's
  worktree, so a hook that calls a file from the repo would run the PR's code without
  `--run-tests`. Hooks are switched off for that call (`core.hooksPath` pointing at an empty folder),
  LFS does not fetch over the network (`GIT_LFS_SKIP_SMUDGE=1`), and no git call may stop to ask
  for a password (`GIT_TERMINAL_PROMPT=0`).
- The stale-convention check in the brief reads through the same git-object reader as the rest of
  the context.
- A worktree left by an interrupted run is removed by the next run — only when the process that
  made it is gone. Each worktree records its owner's pid, so two overlapping runs leave each other
  alone.
- Compass state is left out of the PR diff only inside a `.compass/` folder. Applied repo-wide, a PR
  file under `review/` or `evidence/` would vanish from the brief. The diff always covers the whole
  repo (`:/`), even when the Compass root is a subfolder.
- An old `report.md` is deleted whenever the review reopens, so a stale "nothing blocks" cannot be
  pasted on a PR that has changed.
- `pr` is no longer a valid task id: it would read like the `compass pr` command.
- Output reads "compass pr", not "Gate pr": this is a command, not a gate, and `done` never reads it.
- SSH remotes cannot stop to ask either: `BatchMode=yes`, but only when the user has configured no
  SSH command of their own (`GIT_SSH_COMMAND`, `GIT_SSH`, `core.sshCommand`). `GIT_SSH_COMMAND` beats
  all of those, so setting it always broke users with their own key setup.
- **For a PR number, the base is fetched too** (`origin`'s `HEAD`, or the `origin/<x>` given in
  `--base`). Fetching only the PR head left the base as old as the reviewer's last fetch, and a PR
  built on a newer main brought other people's commits into the diff. The temporary refs under
  `refs/compass/pr/` are removed at the end of every run.
- Compass state files a PR changes are left out of the diff but named in the intent.
- **Nothing in the PR can hide its code.** A file git calls binary because of one NUL byte is
  diffed again with `--text` when its name looks like code or text; any other binary file is named
  in the intent. File names from the PR never open a line in the brief: the changed-files list and
  the intent escape names holding control characters or backticks.
- `--run-tests` stops after `prTestTimeout` seconds (default 1,200), and stops the whole process
  tree, not just the shell: a small supervisor (`commands/run-with-timeout.mjs`) spawns the command
  and, on timeout, runs `taskkill /t` on Windows or kills the process group elsewhere.
- Files the user marked `-diff` (or `binary`) in their own `.gitattributes` keep that: only files
  git calls binary by content are diffed again with `--text`.
- `--base=origin/HEAD` with a PR number fetches the remote's default branch, the same as no `--base`.
- Temp folders whose owner is gone are removed even when no worktree is registered for them.
- Compass state is left out of the PR diff by file name only: `gate.json`, `findings.json`,
  `review-brief.md` and `.salt` inside a `.compass/` folder. Leaving out whole `review/` or
  `evidence/` folders let three review rounds in a row hide code there (a `.js`, a script with no
  extension, names pushed past the list cap). Every other file of the PR is in the diff. The state
  files are named in the intent. Every binary file not shown as text is named too, including ones the
  user marked `-diff`.
- A diff past git's 50 MB read buffer gets the same "split the PR" advice as one past the size limit.
- A PR that changes only state files says which ones.
- A checkout that fails, most often on a file name the OS cannot create, says so in plain words.
- `-diff` marks are trusted only when every `.gitattributes` in the working tree equals the fork
  commit's: a reviewer standing on the PR branch would otherwise take the PR's own marks as theirs.
- Files with no extension, and more code extensions, are forced to text when git calls them binary.
- When the tests fail, the report's conclusion line says so.
- Each run's temporary refs carry its pid, so overlapping runs on one PR number never delete each
  other's refs.
- One sync tree kill (`lib/process-tree.mjs`) serves the supervisor and `runCommand`.
- **A PR cannot approve itself.** Findings or a brief that git tracks are refused: they were not
  written by the reviewer on this machine. The intent carries the full head sha, so the brief id
  cannot be predicted by a commit that would have to contain it.
- Temporary refs of dead runs are removed by the next run.
- The user's git config cannot change what the reviewer sees: every PR diff runs with
  `--no-ext-diff --no-textconv --no-relative --no-color`.
- A base that cannot be fetched is noted in the brief's range section (not hashed into the id) and
  in the output.
- `--run-tests` reads `.compass/config.json` only as committed at the base tip, never from disk.
  Three rounds found ways for the file on disk to be the PR author's (on the PR head, on an older
  PR commit, on a version later amended); not reading the disk leaves nothing to guess. Local
  uncommitted config changes therefore do not apply to `compass pr`.
- The PR checkout switches off every filter in the user's config (smudge, process), as it does
  hooks and LFS.
- The timeout marker carries a random per-run token.
- A file git calls binary is forced to text only when its content is mostly text (under 10 %
  control bytes in the first 8 KB, at most 1 MB).
- **Nothing the PR commits is read as review state.** Files a PR commits under `.compass/pr/` (any
  letter case), or a `.compass` that is a link, are just files of the PR. Every file Compass writes
  in its state folder is removed first and created fresh (`wx`), so no write follows a hard link.
- Cleanup never runs a global `git worktree prune`: that unregisters the user's worktrees on an
  unplugged drive. Only registrations pointing into a `compass-pr-*/head` whose folder is gone are
  removed.
- The supervisor's pid file lives in a fresh `mkdtemp` folder, not at a predictable tmp name.
- The test output tail in the report is cut to 40 lines and 16 KB.
- Long path lists are split to fit the Windows command line (`check-attr`, `--text` diffs).
- The test supervisor catches SIGINT, SIGTERM and SIGHUP and kills the test tree before it exits.
- Reviewer text in `report.md` is escaped for Markdown as well as HTML (links, images, mentions do
  not render), and file names sit in code spans long enough for any backtick.
- `prTestTimeout` is one budget for `prSetup` and the tests together.
- Any run that does not write a new report removes the old one for that ref, whatever made it stop,
  so an error never leaves a stale "nothing blocks" behind.
- Bare URLs, `www.` addresses, emails, `@names` and `#numbers` in findings and in the branch name
  go into code spans: GitHub renders mentions and issue links even after a `\`.
- Criteria the reviewer marked `insufficient` are named in the report.
- The test supervisor caps relayed output at 12 MB, so `spawnSync` never kills it for overflowing its
  buffer; it also writes the command's pid to a file so the caller can clean the tree if it dies.
- A branch name that already ends like a hashed key (`-<6 hex>`) is hashed again.
- A base that cannot be fetched is reported in the output and in the brief.
- A rerun with the same brief id keeps the findings: the id covers everything the reviewer judged
  (intent, diff, context), so only instructions and the rerun line can differ.
- Known limits, kept on purpose: `test-runner.mjs` points at a supervisor under `commands/`, because
  `lib/` may not set an exit code; the supervisor's tree kill is a sync copy of the async one in
  `dev-server.mjs`; `pr` is now refused as a task id everywhere.
- A rerun whose brief differs only in the rerun line (same id) keeps the findings.
- Keys never collide: a branch name that had to be rewritten, or that looks like a key Compass uses
  (`pr-7`, `sha-…`), gets six hex characters of its own hash appended.
- Text from findings goes into `report.md` on one line with `&`, `<` and `>` escaped, since the
  report is posted on the PR, where HTML renders.
- No new dependency. No network access except `git fetch` for a PR number: one call for the PR head, one for its base.

## Rủi ro hồi quy

- `compass review` shares `collectDiff`, `buildBrief` and `collectContext`. Every CP-78 and CP-79 test
  must stay green, and the task brief must stay byte-identical for the same tree.
- `collectContext` gains a way to read from a directory other than the repo root. The default must
  read exactly what it reads today.
- `git worktree add` registers the worktree in `.git/worktrees`. A crash must not leave a registration
  that breaks the user's later `git worktree` commands: clean up with `git worktree remove --force`
  and `git worktree prune`.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `compass pr feature` on a repo with a `feature` branch two commits ahead of `main` | exit 1, brief at `.git/compass/pr/feature/review-brief.md` holding only the two commits' diff | P0 |
| H2 | Happy | `compass pr 7` against a local bare `origin` that has `refs/pull/7/head` | fetches it, key `pr-7`, brief written | P0 |
| H3 | Happy | Valid findings with only Minor items, then phase two | exit 0, `report.md` lists each finding with severity, file and line, verdict says nothing blocks | P0 |
| H4 | Happy | `--spec=ticket.md` given | the brief's intent section holds the ticket text, not the commit messages | P1 |
| H5 | Happy | `--run-tests` with `config.test` passing on the PR head | report says tests passed and how many seconds they took | P1 |
| V1 | Validation | No ref argument | exit 2 with usage | P1 |
| V2 | Validation | PR number with letters (`12a`) | exit 2, nothing fetched | P1 |
| V3 | Validation | A ref that does not resolve | exit 2 naming the ref | P1 |
| V4 | Validation | No `--base` and none of `origin/HEAD`, `main`, `master` exists | exit 2 telling the user to pass `--base` | P1 |
| V5 | Validation | Findings missing a criterion, or with `spec: insufficient` | phase two exit 2, the same coverage errors as the review gate | P0 |
| E1 | Error | Findings quote another brief id after the PR head moved | phase two reopens: new brief, exit 1, says the PR changed | P0 |
| E2 | Error | `--run-tests` with a failing `config.test` | exit 1 even with clean findings; report shows the failing output tail | P0 |
| E3 | Error | `git fetch` of a PR number that does not exist | exit 2 with git's reason, no worktree left behind | P1 |
| E4 | Error | Context building throws inside the worktree | the worktree is removed and `git worktree list` shows only the main one | P0 |
| EC1 | Edge | PR head equals base (empty diff) | exit 2: nothing to review | P1 |
| EC2 | Edge | Branch name `feat/x y`; and `feat/x` against `feat-x`, `pr-7` against PR 7 | key `feat-x-y-<6 hex>`; no two refs share a key | P2 |
| S6 | Security | A `post-checkout` hook in the user's repo that writes a marker | phase one never runs it | P0 |
| S7 | Security | A PR adding `.gitattributes` with `*.js -diff` and a JS file | the JS content is in the brief's diff | P0 |
| EC9 | Edge | Adopted conventions with a source mark, disk differing from the committed files | the brief's stale check reads git objects, not the disk | P1 |
| E6 | Error | A worktree left by an interrupted run | the next run removes it | P1 |
| S8 | Security | A PR touching only `src/review/`, `src/evidence/` and `docs/review-brief.md` | all three are in the brief's diff | P0 |
| EC10 | Edge | Compass root in a subfolder, PR also changing the top-level `package.json` | that change is in the brief's diff | P0 |
| E7 | Error | A Compass worktree whose owner process is still running | the next run leaves it in place | P0 |
| E8 | Error | A report written, then the PR changes and the review reopens | the old `report.md` is removed | P1 |
| V8 | Validation | `compass init PR` | refused: the name belongs to `compass pr` | P2 |
| EC11 | Edge | PR number based on a `main` newer than the reviewer's last fetch | the base is fetched with the PR; diff and intent hold only the PR's own commits; temporary refs are removed | P0 |
| S9 | Security | The user has `core.sshCommand` set and an SSH remote | their command is used, not overridden | P0 |
| V9 | Validation | A PR that changes `.compass/T-1/evidence/gate.json` | left out of the diff, but named in the intent | P1 |
| EC12 | Edge | Branch `fix(1)!` | the rerun line in the brief quotes it | P2 |
| V10 | Validation | `--spec=` with no value, `--run-tests=yes` | the CLI refuses both | P2 |
| S10 | Security | A `.js` file in the PR holding a NUL byte | its content is in the brief's diff (diffed with `--text`) | P0 |
| S11 | Security | A changed file name holding a newline and `## …` | no heading or new line is opened in the brief; normal names stay unchanged | P0 |
| S12 | Security | A binary file that is not code | named in the intent so the reviewer can open it | P1 |
| EC15 | Edge | `--base=main` in phase two when phase one used the default `main` | does not reopen | P1 |
| E9 | Error | A PR diff over the size limit | the advice is for a PR (split it, review in parts), not for a task | P2 |
| E10 | Error | A temp folder left by an interrupted run | removed with its worktree | P2 |
| E11 | Error | `--run-tests` with a test that hangs, `prTestTimeout: 2` | stopped after 2 s with its whole process tree (it never writes the marker it would write at 4 s); the report says it ran out of time | P0 |
| EC16 | Edge | `yarn.lock -diff` in the user's `.gitattributes`, PR changing it with a NUL byte | stays out of the text diff | P1 |
| EC17 | Edge | PR number with `--base=origin/HEAD`, remote main newer than the local copy | the base is fetched; other people's commits stay out of the diff | P1 |
| E12 | Error | A `compass-pr-*` temp folder with a dead owner and no registered worktree | removed | P2 |
| S13 | Security | Eleven forged gate files plus `.compass/scripts/review/zz-evil.js` | the JS is in the diff and the changed-files list | P0 |
| S14 | Security | SIGTERM to the test supervisor while a test runs (POSIX only) | the test tree dies too | P0 |
| V11 | Validation | Finding text with a link, an image, an @mention, and a file name with a backtick | none renders in `report.md`; the file name stays in its code span | P1 |
| V12 | Validation | No ssh setup of the user's own | git calls carry `BatchMode=yes` and no terminal prompt | P2 |
| E13 | Error | A finished report, then malformed findings | phase two exits 2 and the old report is gone | P1 |
| EC18 | Edge | 650 binary files plus `yarn.lock -diff` | the lockfile stays out of the text diff | P1 |
| E14 | Error | A finished report, then a run that exits early (base that does not resolve, context that throws) | the old report is gone | P0 |
| V13 | Validation | Branch `fix-@org/team`, a finding with a bare URL and a `www.` address | no mention in the heading; both addresses sit in code spans | P1 |
| EC19 | Edge | PR number whose remote `HEAD` cannot be fetched | the run says so in its output and in the brief | P1 |
| V14 | Validation | A criterion the reviewer marked `insufficient` | named in the report under "Chưa soi được" | P1 |
| EC21 | Edge | A NUL byte past the first 64 KB, with the stale count exactly at the threshold | the context from git objects equals the one from disk | P1 |
| E15 | Error | A test that writes 40 MB of output and hangs, `prTestTimeout: 3` | output is cut, the run stops on time, and the test tree is gone | P0 |
| S15 | Security | 60 forged gate files plus `.compass/scripts/review/run` with no extension | the script is in the diff and the changed-files list | P0 |
| S16 | Security | The reviewer has the PR branch checked out, and the PR adds `*.js -diff` plus a JS file with a NUL byte | the JS content is in the diff: attributes that differ from the fork commit are not trusted | P0 |
| S17 | Security | A script with no extension holding a NUL byte | shown as text in the diff | P1 |
| EC22 | Edge | Both phases run to a report | `git status --porcelain --ignored` is empty: no state in the working tree | P1 |
| S18 | Security | The PR commits a brief and clean findings under `.compass/pr/<key>/`, reviewer on the PR branch | they are never read: exit 1 "Chưa ai soi", no report | P0 |
| V16 | Validation | `_https://…`, `9www.…`, `GH-123` and a `---` line in finding text | none renders as a link or a heading | P2 |
| E17 | Error | `refs/compass/pr/<N>-<pid>` left by a dead run | removed by the next run | P2 |
| E18 | Error | A worktree of the user whose folder is missing (unplugged drive) | still registered after both phases; no Compass worktree left | P1 |
| S19 | Security | `*.pdf diff=astextplain` (Git for Windows' default) and a `.pdf` that is really JS | its content is in the diff | P0 |
| EC23 | Edge | `diff.relative=true` in the user's config, Compass root in a subfolder | the top-level change is still in the diff | P1 |
| S20 | Security | `.compass/pr` is a link to a folder outside the repo | nothing is written through it | P1 |
| S30 | Security | `.compass` itself is a link to a tracked folder holding a brief and clean findings | they are never read: exit 1 "Chưa ai soi"; nothing is written into that folder | P0 |
| S21 | Security | `review-brief.md` in the state folder is a link (hard link here) to a file outside the repo | that file keeps its content; Compass writes a fresh file of its own | P0 |
| S22 | Security | Git tracks a `report.md` under `.compass/pr/`, reviewer on the PR branch | both phases run; that file and `git status` stay as they were | P0 |
| S23 | Security | Control characters and U+2028 in a file name | escaped wherever it is printed, terminal included | P1 |
| S24 | Security | The PR commits under `.compass/PR/` (other letter case), reviewer on the PR branch | both phases run; working tree untouched | P0 |
| S25 | Security | Reviewer on the PR branch, the PR rewrites `config.test` | `--run-tests` uses the base commit's config; the PR's command never runs | P0 |
| V17 | Validation | A test that prints the bare timeout marker and exits 0 | not reported as timed out | P2 |
| S26 | Security | Reviewer on an older commit of the PR, the author pushed since | the PR's test command still never runs | P0 |
| S27 | Security | The user's config has `filter.x.smudge = node tools/smudge.js`; the PR rewrites that script and points `.gitattributes` at it | checkout runs no filter; the script never runs | P0 |
| S28 | Security | Reviewer on version 1 of the PR, the author amended to a version 2 that does not contain it | the PR's test command never runs | P0 |
| S29 | Security | A script at `.compass/scripts/.salt` | in the diff: state names are left out only at their own place | P1 |
| V18 | Validation | A failing test prints a secret held in the reviewer's environment (`*_TOKEN`) | the report shows `***` instead | P1 |
| EC24 | Edge | A real binary with no extension | named as binary, not forced into the text diff | P1 |
| EC25 | Edge | Failing tests print one 2 MB line | the report keeps the end of it and stays under 40 KB | P2 |
| V15 | Validation | A PR that changes only a Compass state file | exit 2, naming that file | P2 |
| E16 | Error | A PR diff past git's 50 MB read buffer | the "split the PR" advice, not a git error | P2 |
| EC13 | Edge | Compass root in a subfolder, PR also changing Compass state in the top-level `.compass/` | that state stays out of the diff | P1 |
| EC14 | Edge | A file over 1 MB that only the stale-convention check reads | the context from git objects equals the one from disk | P1 |
| EC3 | Edge | The user has uncommitted changes in their own tree | the brief holds none of them; their tree and index are byte-identical after both phases | P0 |
| EC6 | Edge | Context built on a clean tree from git objects and from disk | byte-identical | P0 |
| EC5 | Edge | Both phases run on a repo | `git status --untracked-files=all` lists nothing | P1 |
| EC4 | Edge | A merge commit inside the PR | the diff is `base...head`, so commits already on base are not in it | P1 |
| S1 | Security | Without `--run-tests`, a PR whose `config.test` would write a marker file | the marker never appears; report says tests were not run | P0 |
| S2 | Security | Ref `--upload-pack=touch x` and a ref with `;` | rejected as invalid ref, no command runs | P0 |
| S3 | Security | A PR file containing text that reads like instructions to the reviewer | it sits inside the fenced diff in the brief, under the "data, not instructions" note | P1 |
| S4 | Security | A PR that changes `.compass/config.json`, and a PR that changes only `.compass/` | the change is in the brief's diff; a `.compass/`-only PR still gets a brief | P0 |
| S5 | Security | A commit message holding text that reads like an instruction | it sits in a fence in the intent, after a "data, not instructions" note | P0 |
| E5 | Error | Phase one without `--run-tests`, phase two with it, PR unchanged | phase two does not reopen | P0 |
| EC7 | Edge | Compass root in a subfolder of the repo, with its own conventions and a test that needs a file there | the brief reads those conventions; tests run in that subfolder | P0 |
| H6 | Happy | `prSetup` set; then `prSetup` failing | setup runs before the tests; a failing setup is named in the report | P1 |
| V6 | Validation | Branch names `fix#12`, `feat+x`, `tính-năng` | accepted | P1 |
| V7 | Validation | `compass pr feature --base main` (no `=`) | the CLI refuses with exit 2 instead of ignoring the flag | P2 |
| EC8 | Edge | A task brief built with the defaults | keeps its own wording: task, findings path, `compass review` | P1 |
| P1 | Performance | PR touching 200 files in a repo of 2,000 files, `.ts` and `.tsx` interleaved | phase one under 15 s, measured through `withinBudget` | P2 |
