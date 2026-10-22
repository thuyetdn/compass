# CP-84: review, secrets and compass pr see sub-repos that have their own git
Loại: feature-m
Gốc soi: 435d4c7
Phạm vi: lib/workspace-git.mjs (mới), lib/review-brief.mjs, lib/review-context.mjs, lib/spec-parser.mjs, commands/review.mjs, commands/secrets.mjs, commands/pr.mjs, lib/git-files.mjs, lib/repos.mjs, test/workspace-git.test.mjs (mới), skills/compass/SKILL.md, docs/huong-dan.md, README.md, docs/index.html

## Mục tiêu

Issue #1. A Compass root can declare `repos` that each live in a sub-folder with their own `.git`:

```
workspace/                 ← Compass root (its own git, or no git at all)
├── .compass/config.json   ← "repos": { "be": …, "fe": … }
├── be/.git
└── fe/.git
```

`review`, `secrets` and `compass pr` run git only at the Compass root, so they see none of that code.
The review brief holds none of the task's code, `secrets` passes while `be/` has a committed `.env`,
and `compass pr` run inside `be/` cannot find the branch.

Done means:
- A **git unit** is one git a task's code can live in: the root's git (when the root is in one) plus,
  for each declared repo whose `git rev-parse --show-toplevel` is a different git inside the Compass
  root, that git. Two repos inside the same sub-git are one unit.
- `review` diffs the root unit and every own-git unit whose repo is in `Phạm vi`, each in its own git,
  and puts them in one brief. Paths carry the unit's folder (`be/b.js`) in the file list, the diff
  headers and the context. The range section names each unit's base.
- `secrets` scans the index and the unignored files of **every** unit, and the diff of every unit.
  For an own-git unit **outside `Phạm vi`** with no declared base and no branch point (it sits on
  its main branch), the diff covers only uncommitted changes: its history is not the task's work.
  A unit in `Phạm vi` is diffed exactly as `review` diffs it.
- A sub-repo's base comes from `Gốc soi (be): <ref>` in the spec, then `repos.be.reviewBase` in
  config, then the usual walk back to the branch point. `Soi đến (be): <ref>` stops be's diff at that
  commit and keeps only `Phạm vi` entries under `be/`. Plain `Gốc soi:` and `Soi đến:` keep meaning
  the root unit.
- `compass pr` uses the git that contains the current folder. Run inside `be/`, it fetches, diffs,
  checks out and keeps its state in be's git. Its `--run-tests` command comes from the Compass root's
  config, from the `repos` entry whose folder is that git.
- A project with one git behaves exactly as today: same diff, same brief bytes, same gate records.

## Ràng buộc

- Single-git projects take the current code path unchanged. Every existing test stays green, and a
  brief for a single-git task is byte-identical to the one 3.1.0 writes.
- One place decides the units (`lib/workspace-git.mjs`), shared by `review` and `secrets`. Two gates
  that disagree on what the task changed is what CP-33 set out to prevent.
- `collectDiff` runs once per unit, in that unit's folder, and keeps all its current rules (scratch
  index, untracked files, excludes, empty tree, size). The merged diff is size-checked as a whole.
- Paths are prefixed with explicit `--src-prefix`/`--dst-prefix`, so a sub-repo's `diff.noprefix`
  or `diff.mnemonicPrefix` cannot change the brief.
- The root unit's scratch index never adds an own-git unit's folder: `add -N be/` would turn it into
  a gitlink the task never added.
- An inherited top-level `reviewBase` does not apply to a sub-repo: it names a commit of another git.
  Only the repo's own entry counts.
- `Gốc soi (x):` or `Soi đến (x):` naming a repo that is not declared, or that shares the root's git,
  is an error (exit 2) that says what to write instead.
- A declared repo whose git lies outside the Compass root (a junction, or a path that resolves
  elsewhere) is refused with exit 2: Compass does not review or scan a git it was not given.
- An empty diff in one unit is fine; the review is red only when every unit is empty.
- `compass pr` in a sub-repo never reads a `.compass/config.json` from the PR's repo. The root's
  config is outside the git the PR can change.
- Running `compass pr` at a root that is not a git says which repos to `cd` into.
- Secrets content is never read: `.env` under a sub-repo is matched with its prefix, like at the root.

## Rủi ro hồi quy

- CP-33/CP-50 (`secrets` shares `collectDiff` with `review`, deleted `.env` not counted as in the
  diff): must hold per unit.
- CP-36, CP-48 (`Soi đến` narrows by `Phạm vi`; declared `.compass/` paths are reviewed): the root
  unit must narrow only by its own entries, not by `be/…`.
- CP-52 (single-commit repo diffs from the empty tree): must work inside a sub-repo too.
- CP-60 (linked worktrees nested in the repo are skipped): must not be confused with own-git units.
- CP-78/79 (context: conventions, callers, docs) must find callers and docs inside sub-repos without
  reading `.env` or following symlinks.
- CP-81 (`compass pr`): state, worktree cleanup, config source and every security rule must hold when
  the PR's git is a sub-repo.
- The spec parser: the new `Gốc soi (x):` lines must not be read as the plain `Gốc soi:` line, and
  the plain line's first-wins rule stays.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | The issue's layout: root git tracks only `.compass/`, `be/` has its own git, branch `feature` adds `b.js` | `review` brief lists `be/b.js`, its diff header reads `a/be/b.js`, and the range names be's base | P0 |
| H2 | Happy | Same layout, `be/` commits a `.env` | `secrets` fails and names `be/.env` | P0 |
| H3 | Happy | `cd be && compass pr feature --base=main` | exit 1, brief for `b.js` only, state under be's git dir | P0 |
| H4 | Happy | `be/` and `fe/`, both with own git, both in `Phạm vi` | one brief with both repos' files, each prefixed, and one range line per repo | P0 |
| H5 | Happy | Phase two with findings for the brief, then `be/b.js` edited | first run passes; after the edit the review reopens | P0 |
| H6 | Happy | `compass pr feature --run-tests` inside `be/`, `repos.be.test` set in the root config | the test that runs is the one from the root config, in the PR's worktree | P1 |
| V1 | Validation | `Gốc soi (be): <sha>` in the spec | be's diff starts at that sha and the brief says it was declared in the spec | P0 |
| V2 | Validation | `repos.be.reviewBase` set, and a top-level `reviewBase` that names a root commit | be uses its own entry; the top-level one is not tried in be's git | P1 |
| V3 | Validation | `Gốc soi (xx):` for an undeclared repo | exit 2, names `xx` and the declared repos | P1 |
| V4 | Validation | `Gốc soi (fe):` where `fe` shares the root's git | exit 2, says to use plain `Gốc soi:` | P1 |
| V5 | Validation | `Soi đến (be): <sha>` with `Phạm vi` naming `be/b.js` | be's diff stops at that commit and keeps only `b.js` | P1 |
| V6 | Validation | `Gốc soi (be):` names a ref that is not in be's git | exit 2, names `be` and that the line is in the spec | P1 |
| V7 | Validation | Only `Soi đến (be):` is declared, and `Phạm vi` has an entry that is not a pathspec (`../x`) | exit 2, the entry is named | P1 |
| E1 | Error | Compass root is not a git at all, `be/` is | `review` and `secrets` still run on be | P0 |
| E2 | Error | `be/` is a git with no commit yet | `review` exit 2 naming `be` | P1 |
| E3 | Error | Every unit has an empty diff | `review` is red: nothing to review | P1 |
| E4 | Error | `compass pr 1` at a root that is not a git, with own-git repos `be` and `fe` | exit 2, the message names `be` and `fe` to `cd` into | P1 |
| E5 | Error | `secrets` where be's declared base does not resolve | red, names `be` | P1 |
| EC1 | Edge | A repo declared in `repos` that shares the root's git | the brief is byte-identical to the same project without `repos` | P0 |
| EC2 | Edge | `fe/` has its own git and changes, but is not in `Phạm vi` | not in the review brief | P0 |
| EC3 | Edge | `fe/` is not in `Phạm vi` and commits a `.env` | `secrets` still fails on `fe/.env` | P0 |
| EC4 | Edge | `fe/` sits on main with no branch point: old committed code reads `.env`, and an uncommitted new file reads `.env` | `secrets` names only the uncommitted file | P1 |
| EC5 | Edge | The root git does not ignore `be/` | the root unit adds no gitlink for `be`; no "Subproject commit" in the brief | P0 |
| EC6 | Edge | Repos `apps/web` and `apps/api` both live in one git at `apps/` | one unit, prefix `apps/`, each file once | P1 |
| EC7 | Edge | An uncommitted new file in `be/` | in the brief | P1 |
| EC8 | Edge | The task deletes a tracked `be/.env` | `secrets` does not count it as a `.env` in the diff | P1 |
| EC9 | Edge | `be/b.js` changes an exported function that `be/c.js` calls | the context lists `be/c.js` as a caller | P1 |
| S1 | Security | `be/.env` exists and `be/b.js` mentions it | the brief never holds the `.env` content | P0 |
| S2 | Security | `be/` sets `diff.noprefix=true` and `diff.external` | the brief still reads `a/be/b.js`, and the external tool never runs | P1 |
| S3 | Security | `be` is a junction to a git outside the Compass root | `review` and `secrets` exit 2 and read nothing from it | P0 |
| S4 | Security | The PR commits `be/.compass/config.json` with another test command | `--run-tests` runs the root config's command, not the PR's | P0 |
| S5 | Security | `Gốc soi (be):` holds a value that reads as a git flag (`--output=…`) | exit 2 before git runs it; no file is written | P1 |
| P1 | Performance | Six own-git repos of 300 files each, three in `Phạm vi` | `review` phase one finishes within 15 s | P1 |
| E6 | Error | One `repos` entry fails to resolve (empty `test`) | `secrets` still fails on `be/.env`, `review` still holds `be/b.js` | P0 |
| E7 | Error | `fe` is declared but its folder is missing | in `Phạm vi`: `review` exit 2 naming `fe`; outside it: `review` runs and `secrets` still scans `be` | P1 |
| E8 | Error | `config.json` cannot be parsed | `secrets` does not pass | P1 |
| EC10 | Edge | Repo `web` lives at `apps/web`; `Phạm vi` written as `apps/web/w.js` or as `web/w.js` | chosen either way, and `Soi đến (web)` narrows either way | P1 |
| EC11 | Edge | A sub-repo with a single commit | diffed from the empty tree, and its range line says so | P2 |
| EC12 | Edge | A file renamed inside a sub-repo | `rename from be/…` and `rename to be/…` | P2 |
| EC13 | Edge | Repos `web` and `api` share one git; `compass pr --run-tests` run inside `apps/api` | api's test command runs, in `api/` of the worktree | P1 |
| EC14 | Edge | Root `Soi đến:` with only `be/…` entries in `Phạm vi` | the root's diff is left out, be's is in | P2 |
| V8 | Validation | `Gốc soi (be):` lines before and after a plain `Gốc soi:` | the plain value stays the root's; per-repo first value wins | P1 |
| S6 | Security | `be/` in `Phạm vi` sits on main; the task commits code that reads `.env` there | `secrets` fails on that file, as `review` shows it | P0 |
| E9 | Error | `compass pr --run-tests` inside `be/` while `fe` is declared but not cloned | runs be's test in the worktree | P1 |
| EC15 | Edge | Root `Soi đến:` with `docs/a.md` and `be/b.js` in `Phạm vi` | the root's diff keeps only `docs/a.md`; be's diff is whole | P1 |
| V9 | Validation | A `repos` entry whose `path` leaves the root | `review` and `secrets` exit 2 naming it | P1 |
| EC16 | Edge | Single-git project whose `config.json` has no top-level `test`, or does not parse and never mentions `repos` | `review` and `secrets` behave as before CP-84; nothing says "repo con" | P1 |
| EC17 | Edge | Repos named `toString` and `constructor` | each diffed from its own default base, nothing taken from `Object.prototype` | P2 |
| E10 | Error | `be/.git` exists but git cannot read it (broken gitfile, `safe.directory`) | `review` and `secrets` exit 2 naming `be`; never treated as a plain folder | P0 |
| EC18 | Edge | `apps/` and `apps/web/` each have their own git, both declared | no gitlink for `apps/web` in apps' diff; `apps/web/w.js` once | P1 |
| E11 | Error | `apps/.git`, shared by repos `apps/web` and `apps/api`, cannot be read by git | `review` and `secrets` exit 2, pointing at `apps` | P0 |
| E12 | Error | The root's `.git` cannot be read by git while sub-repos are declared | `review` and `secrets` exit 2, naming the root's git | P0 |
| E13 | Error | The root is a git with no commit yet, next to a sub-repo | the error is labelled as the root's git, not a sub-repo's | P2 |
| EC19 | Edge | Single-git project; the task deletes a declared repo folder that is in `Phạm vi` | `review` runs as before CP-84 and shows the deletion | P1 |
| EC20 | Edge | A sub-repo in `Phạm vi` whose diff is empty, next to one with changes | its range line says it has no change | P2 |
| EC21 | Edge | A sub-repo folder named `app$1` with a rename inside | `rename from app$1/…`: the `$` stays literal | P2 |
