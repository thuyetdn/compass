# CP-59: `compass init` leaves `data/` — production query results — unignored
Loại: bug
Phạm vi: lib/signature.mjs, commands/init.mjs, skills/compass/SKILL.md, test/salt-gitignore.test.mjs, test/compass-gitignore.test.mjs (mới), .compass/.gitignore, examples/todo/.compass/.gitignore
Gốc soi: 4aba541

## Mục tiêu

Two places write `.compass/.gitignore`, with two different contents, and the one that runs first
wins. `commands/init.mjs:46-50` writes `.salt\n` if the file is missing. `cheSalt` in
`lib/signature.mjs` writes `.salt\ndata/\n` — but only when `getSalt` generates a new salt, and it
returns early when the file already exists. `init` is the documented first step, so it always runs
first, and `cheSalt` never gets to write. `data/` is where SKILL.md tells people to save query
results, log and dump files, and those come back with customer emails and names.

Measured on HEAD (a369838) with throwaway scripts, each in a fresh `git init` directory, then a file
written to `.compass/INV-1/data/INV-1-q-0915.csv` and asked of real `git check-ignore`:

| How the project started | `.compass/.gitignore` | `data/` file ignored |
|---|---|---|
| `compass init T-1 --type=bug` | `.salt\n` | **no** — `git status` lists it as `??` |
| `init`, then `getSalt` (first signed record) | `.salt\n` | **no** |
| `init`, then `compass spec T-1` (writes a signed gate record) | `.salt\n` | **no** |
| config only, `compass investigate INV-1`, then `getSalt` | `.salt\ndata/\n` | yes |

Only a project whose first `.compass/` write was a new salt gets `data/` covered; every project
started the documented way does not. This repository is one of them: `.compass/.gitignore` and
`examples/todo/.compass/.gitignore` are both blob `96286f5` (`.salt\n`; `.salt\r\n` in the working
tree under `core.autocrlf=true`), and `git check-ignore .compass/INV-9/data/x.csv` exits 1.

SKILL.md (line 525-526) blames the wrong cause: "Dự án dựng trước tháng 9/2026 có `.gitignore` chỉ một
dòng `.salt`". `data/` was added to `cheSalt` on 2026-09-07 (9fd11a8); the literal in `init` dates
from 641746a (2026-09-05) and never changed. The date does not matter — `init` still writes the
one-line file today.

Done means:

1. The default content of `.compass/.gitignore` exists once, as one exported constant, and both
   `init` and `getSalt` write it through one shared function. A new project gets `.salt` and `data/`
   whichever command touches `.compass/` first, and real git ignores its `data/` files.
2. A `.compass/.gitignore` whose content is exactly `.salt` — the file old `init` wrote, with LF,
   CRLF or no line ending — is not user-edited, so the shared function upgrades it to the default
   and `init` says so in one line. This is how existing projects get fixed: `init` runs at the start
   of every task, and a fresh clone creates its salt on the first gate run.
3. Any other content is the user's, and stays byte-identical. When git is available and reports
   that `.compass/<id>/data/` is not ignored, `init` prints one warning naming the line to add, and
   still exits 0.
4. SKILL.md says what is true: which file Compass writes, which it upgrades, which it leaves alone
   and warns about. The "trước tháng 9/2026" sentence goes.
5. This repository's two one-line `.compass/.gitignore` files are upgraded as part of the fix.

## Ràng buộc

- Never clobber a user-edited `.gitignore`. "User-edited" means anything other than `.salt` after
  removing one trailing `\n` or `\r\n`. A file with `.salt` plus a comment, a blank line, or the
  user's own rules is theirs, even when it lacks `data/`.
- `output/` and `evidence/` stay unignored. The CP-30 reason holds: products may be committed, and
  evidence must stay reviewable. `.salt` stays ignored in every case.
- The default text is `.salt\ndata/\n`, the text `cheSalt` writes today: `data/` with no leading `/`
  matches at every depth, and real git has already been measured against it by CP-30-EC2.
- `getSalt` keeps its rule that signing matters more than covering files: a failed write never stops
  it returning a salt. `getSalt` only writes `.gitignore` when it creates a new salt, as today —
  it is called on every gate read and write, and a read path must not start writing files.
- `init` keeps working outside a git repository: no git call is needed to write or upgrade the file.
  The warning in point 3 asks git (`git check-ignore -q`) and stays silent when git is missing or the
  directory is not a repo (exit 128). It probes a path, so nothing has to exist under `data/` yet.
- A fresh project's `init` output does not change. The new line appears only for an upgrade or a
  warning, so `test/init.test.mjs` and `test/integration.test.mjs` keep passing as written.
- No new dependency. Tests ask real git, not string patterns, as CP-30 does.

## Rủi ro hồi quy

- **CP-30-E1 asserts the old behaviour on purpose.** It writes `.salt\n`, calls `getSalt`, and
  expects `.salt\n` back — the rule this spec reverses for a file that is exactly `.salt`. The fix
  must rewrite that test to expect `.salt\ndata/\n` (pinned again by H3 and V1 at the `init` level);
  leaving it red, or deleting it without a replacement, both hide the change of decision.
- **A user's own `.gitignore` gets overwritten.** CP-28-V1 (`*.log\nnode_modules/\n`) and CP-28-EC1
  (`.salt\n# ghi chú của tôi\n`) keep passing unchanged; V2 adds the `init` path and checks bytes.
- **The salt lands in git.** Every case asks `git check-ignore .compass/.salt`; H1 and EC2 fail if it
  is ever unignored.
- **The pattern widens to `output/` or `evidence/`.** CP-30-V1 and CP-30-EC1 keep passing; EC2 runs
  the same check on the file `init` writes, not on a string typed into the test.
- **`init` and `getSalt` write the same file twice.** CP-28-EC2 counts `.salt` lines after
  `init` + `getSalt`; EC1 extends that to `init`, `getSalt`, `init` again and asserts the exact bytes.
- **`getSalt` stops signing when the file is odd.** CP-28-E1 (`.gitignore` is a directory) keeps
  passing; E1 adds the same case through `init`.
- **`init` breaks outside a git repo**, now that it can call git. E2 runs it in a plain directory.
- **The upgrade fails on a read-only file and takes `init` down with it.** E3 pins that the task is
  still created.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Fresh `git init` directory, `compass init T-1 --type=bug`, then a file at `.compass/T-1/data/T-1-q-1015.csv` | `.compass/.gitignore` is exactly `.salt\ndata/\n`; `git check-ignore` exits 0 for the data file and for `.compass/.salt` | P0 |
| H2 | Happy | Project A started by `init`, project B started by `getSalt` alone (config only, no `.gitignore`) | the two `.compass/.gitignore` files are byte-identical — the drift on HEAD shows here as `.salt\n` vs `.salt\ndata/\n` | P0 |
| H3 | Happy | Existing project whose `.compass/.gitignore` is `.salt\n`, then `compass init T-2 --type=bug` | file becomes `.salt\ndata/\n`; output has one line naming `.compass/.gitignore` and `data/`; `git check-ignore .compass/T-2/data/x.csv` exits 0 | P0 |
| V1 | Validation | Same as H3 with `.salt\r\n`, and again with `.salt` and no line ending | both are upgraded to `.salt\ndata/\n` — CRLF is how this repo's own file sits in the working tree | P0 |
| V2 | Validation | `.compass/.gitignore` is `.salt\n*.log\n` (user-edited, no `data/`), git repo, then `init T-2` | file is byte-identical before and after; output has one warning that names `data/`; exit code 0; spec created | P0 |
| V3 | Validation | User-edited file `.salt\n# mine\n`, and the repo-root `.gitignore` already has `data/` | file byte-identical; no warning — `git check-ignore` says the path is covered | P1 |
| E1 | Error | `.compass/.gitignore` is a directory, then `init T-1` | exit 0, spec created, the directory is untouched, no throw | P1 |
| E2 | Error | `init T-1` in a plain directory that is not a git repo | exit 0; file is `.salt\ndata/\n`; output has no warning line and no git error text | P0 |
| E3 | Error | `.compass/.gitignore` is `.salt\n` and made read-only, then `init T-2` | exit 0, spec created, file content unchanged; output warns that `data/` is not covered instead of claiming the upgrade | P1 |
| EC1 | Edge | `init T-1`, `getSalt`, `init T-2`, `getSalt` in one project | file is exactly `.salt\ndata/\n` — no line duplicated, nothing appended twice | P0 |
| EC2 | Edge | The file `init` writes, checked by real git against `data/`, `output/`, `evidence/` and `.salt` under `.compass/T-1/` | `{ data: true, output: false, evidence: false, salt: true }` | P0 |
| EC3 | Edge | File already `.salt\ndata/\n`, then `init T-2` | byte-identical; no upgrade line, no warning | P1 |
| EC4 | Edge | A nested Compass project (`sub/.compass/.gitignore` = `.salt\n`) inside an outer git repo; `init T-1` run in `sub/` | `sub/.compass/.gitignore` upgraded; from the outer repo root, `git check-ignore sub/.compass/T-1/data/x.csv` exits 0 — the layout of `examples/todo/` | P1 |
