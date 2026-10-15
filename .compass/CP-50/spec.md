# CP-50: The secrets gate blocks the fix it prescribes, and hides the read-only warning from untracked files
Loại: bug
Phạm vi: lib/review-brief.mjs, lib/secrets-scan.mjs, commands/secrets.mjs, test/secrets-command.test.mjs, test/secrets-scan.test.mjs
Gốc soi: f94ebdd

## Mục tiêu

Two defects in the `secrets` gate, both found while reviewing CP-40.

**1. Removing a tracked `.env` keeps the gate red forever.** When a `.env` is already tracked, the
gate says `git rm --cached .env, add it to .gitignore, and rotate any key it held.` Doing exactly
that turns the problem into a different one — `secret file in the diff: .env` — and no further
step clears it. `collectDiff` lists diff paths with `git diff <base> --name-only -z` and no status
filter (`lib/review-brief.mjs:365` for the scratch-index branch, which is the only branch `secrets`
uses since it passes `endRef: null`; `:250` is the commit-to-commit twin). A deletion is a diff
path like any other, and `scanSecrets` puts every diff path through `isSecretFile` into `inDiff`
(`lib/secrets-scan.mjs:343`, `:347`). The file is gone from the index, so `tracked` no longer has
it, and the only reason left to report is "in the diff" — for a file the task just took out.

**2. A declared task never sees "declaration only permits reading" for a new `.env` file.** With
`Dùng .env:` in the spec, a newly created, unignored `.env.local` is classified as reason 2 (not
ignored), which is correct. But the line `Lời khai "Dùng .env: …" cho phép ĐỌC, không cho phép
commit.` is gated on `byReason[0].length` (`commands/secrets.mjs:175`), so it only prints for
reason 1. The unit test that claims to cover this, `test/secrets-scan.test.mjs:100` (CP-40-E5),
passes `untrackedUnignored: []` — a state a real run never produces for an uncommitted file,
because `collectDiff` adds untracked files to its scratch index and `ls-files --others` reports
the same file, which makes it reason 2. The unit test measures a scanner input that the command
cannot produce.

Measured on HEAD (f94ebdd) with the real `secretsCommand` in throwaway repos; the `.env` files
held a marker value:

| Situation | Exit | What the gate said |
|---|---|---|
| `.env` tracked since before `Gốc soi` | 1 | `secret file tracked by git: .env` — correct |
| then `git rm --cached .env` + `.env` in `.gitignore`, not committed | 1 | **`secret file in the diff: .env`** |
| same, committed | 1 | **`secret file in the diff: .env`** — `git diff --name-status <base>` shows `D .env`; `ls-files` no longer lists it |
| `.env.production` removed with `git rm` (gone from disk too), committed | 1 | **`secret file in the diff: .env.production`** |
| `Dùng .env: chạy local` + new untracked, unignored `.env.local` | 1 | `secret file not ignored: .env.local` — **no "cho phép ĐỌC" line** |
| same, after `git add .env.local` | 1 | `secret file tracked by git: .env.local` + the "cho phép ĐỌC" line |
| `Dùng .env:` + `import 'dotenv/config'`, no `.env` file | 0 | PASSED, read reported as declared |

In every row the marker value appeared in neither the output nor `gate.json`. It does appear in
`collectDiff(...).diff` for the deletion rows, as `-` lines that git writes into the diff.

Done means:

- A secret file that the task **deletes** relative to the base is not a reason 1 problem. A
  secret file that is added, modified, renamed into place, or still tracked keeps failing exactly
  as today. A deleted file that is still on disk and not ignored is still reason 2.
- When `Dùng .env:` is declared and at least one reason 1 **or reason 2** problem exists, the
  "cho phép ĐỌC, không cho phép commit" line prints.

**Fix chosen for defect 1.** `collectDiff` additionally returns `deleted`: the paths whose status
against the base is `D`, computed with `--name-only --diff-filter=D -z` against the same index and
the same pathspec as `files` (both branches, so the return shape is the same on each). `files`
itself is not filtered. `scanSecrets` takes `deletedFiles` (default `[]`), and removes those paths
from `diffPaths` before any reason runs, which also keeps a deleted `package.json` or
`.env.example` from producing a note. Why not add `--diff-filter=d` to `files`: `review` builds
its brief from the same `files`, and a deletion is work a reviewer must see (CP-46 EC2 pins it).
Why not a second `git diff` inside `commands/secrets.mjs`: the header comment of that file says why
the two gates share `collectDiff` — two gates that describe different diffs disagree about what the
task changed. The deletion list has to come from the same index as the file list.

**Fix chosen for defect 2.** Print the line when `declared && (reason 1 or reason 2 problems
exist)`. Reason 2 is one `git add -A` away from reason 1. Someone who wrote `Dùng .env:` and then
sees "not ignored" is exactly the person who believes the declaration covers the file, and the
sentence is there to correct that belief. Reason 3 is left out on purpose, and named rather than
covered by "any problem". A declaration suppresses reason 3 today, so the two forms behave the same
now. If reason 3 ever coexists with a declaration, a sentence saying the declaration permits reading
would be wrong next to a read problem.

## Ràng buộc

- **The gate never opens a `.env` file and never prints a line from one.** `lib/secrets-scan.mjs`
  keeps zero imports (CP-40-S3 pins it), and the new `deleted` list is paths from git, not file
  reads. S1 measures the new paths end to end with a marker value.
- `collectDiff(root, {...})` keeps its signature. Its return value gains `deleted` and nothing
  else changes: `files`, `diff`, `base`, `end`, `endAtHead`, `narrowedTo` and the `ly_do: 'empty'`
  paths stay byte-identical for the same repo.
- `scanSecrets` keeps its signature; `deletedFiles` is an optional new key defaulting to `[]`, so
  every existing caller and unit test behaves as before.
- Every message and hint string in `scanSecrets` stays word-for-word. The "cho phép ĐỌC" sentence
  keeps its exact text; only its condition changes.
- No change to reason 2 or reason 3 logic, `SECRET_FILE`, the example exemption, `diffHash`, or
  the rule that `secrets` never narrows by `Phạm vi` or `Soi đến`.
- `test/secrets-scan.test.mjs:100` (CP-40-E5) stays as it is. It is a true statement about the
  scanner. The defect-2 tests go through `secretsCommand` against a real git repo, because the
  bug only exists in the inputs the command builds.
- No new dependency. SKILL.md is not edited. Its table row "File `.env` nằm trong diff, hoặc đã bị
  git theo dõi từ trước" already reads the way the fixed gate behaves.

## Rủi ro hồi quy

- **A `.env` committed by the task could slip through.** If the filter ever caught additions, the
  gate would go green on the leak it exists to stop. E1 commits a new `.env` inside the task (status
  `A`) and asserts reason 1. CP-40-E7 and CP-40-E8 must stay green.
- **A modified tracked `.env`.** Status `M` must still fail. E2 pins it.
- **A rename.** `git mv .env config/.env` deletes one path and adds another. Rename detection
  could put the new path under `D`, or both paths, and drop it. EC3 asserts the new path is still
  named.
- **Untracking without ignoring.** `git rm --cached .env` with no `.gitignore` line leaves an
  unignored file on disk. The deletion filter must not swallow it. EC1 asserts reason 2 with the
  `.gitignore` hint, and asserts the output does not say "in the diff".
- **The review brief losing deletions.** `files` feeds `review`. EC4 asserts that `collectDiff`
  still lists the deleted `.env` in `files` and also in `deleted`.
  `test/review-brief-staged.test.mjs` (CP-46 EC2) must stay green.
- **The warning printing where it does not belong.** V1 (no declaration, reason 2) and V2
  (declared, gate green) assert the sentence is absent. E3 keeps the reason-1 case that already
  printed it.
- **The scanner contract.** EC5 pins `deletedFiles` at unit level both ways. CP-40-E1 through
  CP-40-E5 and the rest of `test/secrets-scan.test.mjs` and `test/secrets-command.test.mjs` must
  stay green, including CP-40-H7, which scans this repo's own history.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `.env` tracked in the base commit; task runs `git rm --cached .env`, adds `.env` to `.gitignore`, commits; `Gốc soi` = that base | `secretsCommand` exit 0; output contains `PASSED`; output does not contain `secret file` | P0 |
| H2 | Happy | Same steps as H1, staged but not committed | exit 0; output contains `PASSED` | P0 |
| H3 | Happy | Spec declares `Dùng .env: chạy local`; a new untracked, unignored `.env.local` exists | exit 1; output contains `secret file not ignored: .env.local` and `Lời khai "Dùng .env: chạy local" cho phép ĐỌC, không cho phép commit.` | P0 |
| V1 | Validation | No declaration; new untracked, unignored `.env.local` | exit 1; output contains `not ignored: .env.local`; output does not contain `cho phép ĐỌC` | P0 |
| V2 | Validation | Declaration plus `import 'dotenv/config'` in `src/`, no `.env` file anywhere | exit 0; output does not contain `cho phép ĐỌC` | P1 |
| E1 | Error | A new `.env` added and committed inside the task (status `A` against the base), `.gitignore` empty | exit 1; output contains `secret file tracked by git: .env` | P0 |
| E2 | Error | `.env` tracked in the base and edited and committed in the task (status `M`) | exit 1; output names `.env` with `tracked by git` | P0 |
| E3 | Error | Declaration plus `.env.local` staged with `git add` | exit 1; output contains `tracked by git: .env.local` and the `cho phép ĐỌC` line | P1 |
| EC1 | Edge | `.env` tracked in the base; task runs `git rm --cached .env` and adds no `.gitignore` line; the file stays on disk | exit 1; output contains `secret file not ignored: .env` and `.gitignore`; output does not contain `in the diff` | P0 |
| EC2 | Edge | `.env.production` tracked in the base, removed with `git rm` (deleted from disk) and committed | exit 0 | P0 |
| EC3 | Edge | `.env` tracked in the base, moved with `git mv .env config/.env` and committed | exit 1; output names `config/.env` | P1 |
| EC4 | Edge | `collectDiff` on the H1 repo | `files` contains `.env` and `.gitignore`; `deleted` equals `['.env']` | P0 |
| EC5 | Edge | `scanSecrets` with `diffFiles: ['.env']`, empty tracked and untracked lists, once with `deletedFiles: ['.env']` and once without | with the key: `ok === true`, no problems; without it: one problem with `reason === 1` | P1 |
| S1 | Security | H1 and H3 repos whose `.env` / `.env.local` hold the marker `zq7x9marker`; read output and `.compass/T-S/evidence/gate.json` after the run | marker absent from output and from `gate.json`; `lib/secrets-scan.mjs` still has zero `import` statements | P0 |
