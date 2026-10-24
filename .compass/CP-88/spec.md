# CP-88: secrets reads only uncommitted changes of out-of-scope sub-repos on any branch, and skips an out-of-scope git outside the root
Loại: feature-s
Gốc soi: 8d56937
Phạm vi: lib/review-brief.mjs, lib/workspace-git.mjs, lib/review-context.mjs, lib/git-files.mjs, commands/review.mjs, commands/secrets.mjs, test/workspace-git-scope.test.mjs (mới), test/cp86-text.test.mjs, skills/compass/SKILL.md, docs/index.html, README.md

## Mục tiêu

Issue #2. Since 3.1.1 `secrets` diffs every sub-repo that has its own git. For a repo outside
`Phạm vi` with no declared base the intent is "uncommitted changes only", but that only happens when
the repo sits on its main branch: `resolveBase` tries the merge-base candidates first. A repo on any
other branch (`alpha`, a cherry-pick branch) is diffed against `main`, and that branch history is not
the task's work. In a real workspace eight such repos added 2.3 MB and every task went red with
"Diff quá lớn".

Second, a declared repo whose git lies outside the Compass root (a junction) makes `review` and
`secrets` exit 2 for every task, even when no task touches it.

Done means:
- A repo outside `Phạm vi` with no declared base (`Gốc soi (x):` or `repos.x.reviewBase`) contributes
  only its uncommitted changes to `secrets`, on whatever branch it is. Its index and unignored files
  are still scanned, as before.
- A repo inside `Phạm vi` keeps the branch-point base, so `review` and `secrets` still agree on the
  task's own repos.
- A repo whose git lies outside the root is refused (exit 2) only when it is in `Phạm vi`. Outside
  `Phạm vi`, both gates skip it and print one line naming it and why.

## Ràng buộc

- The change to `resolveBase` applies only when `fallbackToHead` is set; `review` and single-git
  projects never set it, so their diffs do not change.
- A declared base for an out-of-scope repo still wins over "uncommitted only".
- The skip note never prints file content; it names the repo and where its git lies.
- A skipped repo is not read at all: not listed, not diffed.

## Rủi ro hồi quy

- CP-84-EC4 (out-of-scope repo on main scanned for uncommitted changes only) must hold.
- CP-84-S6 (in-scope repo on main: committed work is scanned) must hold.
- CP-84-EC3 (out-of-scope repo commits a `.env`: caught through the index listing) must hold.
- CP-84-S3 (a repo in `Phạm vi` that is a link to a git outside the root is refused) must hold.
- CP-84-EC1 and every single-git test: briefs and diffs unchanged.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Issue #2's layout: `fe` outside `Phạm vi`, on `alpha` with 2.1 MB committed, nothing uncommitted | `secrets` passes | P0 |
| H2 | Happy | `fe` outside `Phạm vi`, on `alpha`, with an uncommitted new file that reads `.env` | `secrets` fails on that file | P0 |
| H3 | Happy | A declared repo `hub` is a junction to a git outside the root and not in `Phạm vi` | `review` and `secrets` run, and each prints one line saying `hub` was skipped | P0 |
| V1 | Validation | `fe` outside `Phạm vi` on `alpha` with `repos.fe.reviewBase` set to its first commit | `secrets` scans fe from that base and fails on a committed `.env` read | P1 |
| V2 | Validation | Same with `Gốc soi (fe): <first commit>` in the spec | same | P1 |
| E1 | Error | `hub` (junction outside the root) is in `Phạm vi` | `review` and `secrets` exit 2 naming `hub` | P0 |
| E2 | Error | `hub` is skipped, and `be` in `Phạm vi` commits a `.env` | `secrets` still fails on `be/.env` | P1 |
| EC1 | Edge | `fe` outside `Phạm vi`, on `alpha`, has a committed `.env` | `secrets` fails through the index listing | P0 |
| EC2 | Edge | `be` in `Phạm vi` sits on `alpha` and commits code that reads `.env` | `secrets` fails on it: the branch-point base still applies in scope | P0 |
| EC3 | Edge | `fe` outside `Phạm vi` is on a detached HEAD, nothing uncommitted | `secrets` passes | P2 |
| EC4 | Edge | `be` in `Phạm vi` on `alpha` | the review brief holds be's branch work, diffed from its branch point | P1 |
| S1 | Security | The skipped `hub` holds a `.env` with a secret value | neither output nor brief holds the value or any `hub` file name | P1 |
| S2 | Security | `Phạm vi` names the repo by its path (`apps/web/x.js`) instead of its name | treated as in scope: committed `.env` reads on its branch are caught | P1 |
| S3 | Security | The root is not a git and the only declared repo is a junction to a git outside it | `secrets` does not pass: there is no git to read | P0 |
| S4 | Security | The skipped repo is a junction at `be/hub`, inside sub-repo `be` | be's diff holds no gitlink for it, in `review` or `secrets` | P1 |
| V3 | Validation | `Gốc soi (hub):` for a skipped repo | exit 2, saying its git lies outside the root | P2 |
| S5 | Security | The skipped `hub` is a junction into a subfolder of an outside git (git lists each file through it); root ignores nothing | no `hub` file, name or `.env` value in the outputs, the brief or the context; `secrets` passes | P0 |
| S6 | Security | The same junction nested inside sub-repo `be` | same | P0 |
| S7 | Security | Config declares `Hub`, the folder is `hub` (a junction into a subfolder of an outside git), on a case-insensitive file system | nothing of it leaks; path checks fold case where the file system does | P0 |
| S8 | Security | The root's own git tracks `hub/.env` under the skipped junction, and the root's diff is empty | `secrets` fails on `hub/.env`: only untracked files are skipped | P0 |
| V4 | Validation | `Phạm vi` names `Hub/h.js` for repo `hub`, on a case-insensitive file system | treated as in scope: exit 2 | P2 |
| S9 | Security | `Phạm vi: BE/x.js` for repo `be` on `alpha`, which commits code reading `.env`, on a case-insensitive file system | `be` stays in scope: `secrets` fails on it | P0 |
| EC5 | Edge | A case-sensitive folder (`setCaseSensitiveInfo` on Windows): skipped junction `hub` next to a real folder `Hub` with an unignored `.env` and a file reading it | `secrets` fails on both `Hub` files; case folding follows the file system, not the OS name | P1 |
| S10 | Security | `Phạm vi` writes the task's repo as `./be/x.js`, `be//x.js` or `.//be/./x.js`; `be` on `alpha` commits code reading `.env` | `be` stays in scope: `secrets` fails on it | P0 |
| EC6 | Edge | `Soi đến (be):` with `Phạm vi: ./be/x.js` | be's diff narrows to `x.js` | P2 |
| E3 | Error | `Phạm vi` names the skipped repo as `./hub/h.js` | refused with exit 2, not skipped | P1 |
