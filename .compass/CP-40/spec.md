# CP-40: A task can read or commit a `.env` file and every gate stays green
Loại: feature-m
Phạm vi: commands/secrets.mjs (mới), lib/secrets-scan.mjs (mới), commands/check.mjs, commands/done.mjs, lib/spec-parser.mjs, lib/gate-store.mjs, SKILL.md, test/secrets-scan.test.mjs (mới), test/secrets-command.test.mjs (mới), test/spec-parser.test.mjs, test/check-done.test.mjs
Gốc soi: a62c3f2

## Mục tiêu

The owner's rule, stated on 2026-09-13: an AI agent may not read or use a `.env` file
without asking first. Compass has no gate that notices when a task does it anyway. Today a
task can add `dotenv.config()`, read `.env` with `readFileSync`, or commit `.env.production`
with live keys, and `check` and `done` pass on every gate.

A new gate `secrets` closes that. It runs inside `check` and `done` for every task type,
because a one-line `fix` can commit a secret as easily as a feature can. It reads the task's
diff — same base resolution as `review`: `Gốc soi:` in the spec, then `reviewBase` in
config, then the fork point — plus untracked files, and turns red when:

1. **A secret file is in the diff or tracked.** Any path matching `.env` or `.env.<name>`
   is added or modified in the diff, or appears in `git ls-files`. `.env.example`,
   `.env.sample` and `.env.template` are documentation and are exempt.
2. **A secret file is not ignored.** A `.env*` file exists in the working tree and
   `git check-ignore` does not cover it.
3. **New code reads `.env` without a declaration.** An added line in a code file names a
   `.env` file — `dotenv`, `'.env'`, `".env.local"`, `open('.env')` — and the spec does not
   carry `Dùng .env: <lý do>` in its header region (above the first `##`).

The declaration is the owner's consent, in the place they already approve: a spec line is
covered by `specHash`, so adding it after approval reopens approval. With the line present,
reason 3 is reported as allowed and named; reasons 1 and 2 still block, because consent to
read a file is not consent to commit it.

The gate never opens a `.env` file. It works from paths, diff text and git metadata only, and
its output never contains a line from a `.env` file. That is a test, not a promise.

Done means: `compass secrets <id>` exists, `check` and `done` include it, `gate.json` for it
carries `sourceHash` like every code-reading gate, SKILL.md documents the gate and the
`Dùng .env:` line, and the full suite is green.

## Ràng buộc

- Zero dependencies. Diff and file lists come from `git` via the same runner `review-brief`
  uses; no secret-scanning library.
- Existing tasks keep closing. The 37 tasks already in `.compass/` have no `.env` in their
  diffs; the gate must pass on them without a spec change. A test runs it against this
  repo's HEAD range and expects green.
- Paths only. The gate must not call `readFileSync` on any path matching the `.env`
  pattern, and its output must not echo diff lines from such files. Reason 1 reports the
  path, never the content.
- Comments and docs are not reads. A `.env` mention inside a `//`, `#` or `/* */` comment,
  a Markdown file, or a test file under `test/` is not reason 3. Example files and
  `.gitignore` lines are not reads either.
- The declaration lives in the header region, like `Gốc soi:`, so a sentence about `.env`
  in `## Mục tiêu` never counts as consent.
- Backward compatible `gate.json`: `done` treats a task with no `secrets` record the way
  it treats any missing required gate today — red with the rerun hint — not as a legacy
  record to wave through.

## Rủi ro hồi quy

- **`done` on old tasks.** Adding a required gate means every open task needs one more
  green record. CP-4, CP-6, CP-10, CP-11, CP-13 are open on purpose (see pitfalls); they
  now need `compass secrets` run once before `done`. Cheap, but it must be said in the
  report.
- **Base resolution drift.** If `secrets` resolves its base differently from `review`, the
  two gates describe different diffs and the user cannot tell which one is wrong. The gate
  reuses `collectDiff` rather than re-implementing it.
- **False positives on `process.env`.** Reading an environment variable is not reading a
  `.env` file. The pattern must not match `process.env.X`, `env.mjs`, `.environment`, or
  `dotenv` in a `package.json` dependency list. EC tests pin each.
- **Windows paths.** Diff paths use `/`; untracked file listing may return `\`. Normalise
  before matching, as CP-36 did for `Phạm vi`.
- **Shared working tree.** Another session is committing on this branch. `Gốc soi:` is
  `a62c3f2` at spec time and may have to move; that reopens approval, as designed.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Repo with a diff that touches only `src/a.mjs` and no `.env` anywhere | exit 0, output says no `.env` file or read found | P0 |
| H2 | Happy | Diff adds `.env.example` with placeholder values | exit 0, output names it as an exempt example file | P0 |
| H3 | Happy | Diff adds `import 'dotenv/config'` and spec header has `Dùng .env: local dev only` | exit 0, output quotes the reason and the line that reads `.env` | P0 |
| H4 | Happy | `check` on a `fix` task includes `secrets` in the gates it runs | gate list printed by `check` contains `secrets`; `gate.json` has a `secrets` slot | P0 |
| H5 | Happy | `done` after all gates green including `secrets` | exit 0 | P0 |
| H6 | Happy | `secrets` record carries `sourceHash`, `specHash`, `diffHash` and a valid `sig` | `readGate().sourceHash` is a 64-hex string; `verifyAllGates` accepts it | P0 |
| H7 | Happy | Running against this repo, base `a62c3f2` to HEAD | exit 0 — the repo has no `.env` and no code reading one | P1 |
| V1 | Validation | Spec header `Dùng .env:` with empty value | usage error exit 2, message says the reason is required | P0 |
| V2 | Validation | `Dùng .env: x` placed below the first `##` heading, code reads `.env` | exit 1 for reason 3; output says the line is not in the header region | P0 |
| V3 | Validation | Missing task id | exit 2, usage message names the argument | P1 |
| E1 | Error | Diff adds `.env.production` containing `KEY=abc` | exit 1; output names the path and says "secret file"; output does not contain `abc` | P0 |
| E2 | Error | `.env` is tracked by git from an earlier commit, diff untouched | exit 1 for reason 1, path named, hint says remove from index and rotate keys | P0 |
| E3 | Error | `.env` exists untracked and `.gitignore` does not cover it | exit 1 for reason 2, hint shows the `.gitignore` line to add | P0 |
| E4 | Error | Diff adds `readFileSync('.env')` in `src/config.mjs`, no declaration | exit 1 for reason 3; output shows file and line number, and the hint names `Dùng .env:` | P0 |
| E5 | Error | Declaration present, but diff also adds `.env.local` | exit 1 for reason 1; output says the declaration covers reading, not committing | P0 |
| E6 | Error | Git unavailable or not a repo | exit 1, message says the gate could not read the diff, no false green | P1 |
| EC1 | Edge | Added line `const k = process.env.API_KEY` | not reason 3 | P0 |
| EC2 | Edge | Added line `import { x } from './env.mjs'` and a file named `.environment` | not reason 3, not reason 1 | P0 |
| EC3 | Edge | `.env` named only in a `//` comment or a Markdown file | not reason 3 | P0 |
| EC4 | Edge | `dotenv` added under `dependencies` in `package.json` | not reason 3 on its own; output notes the dependency without failing | P1 |
| EC5 | Edge | Untracked path returned with `\` separators on Windows | matched as `.env` all the same | P1 |
| EC6 | Edge | A `.env` mention in a file under `test/` | not reason 3 | P1 |
| EC7 | Edge | `.env.example` present and also `.env` untracked and ignored | exit 0 — ignored untracked secret file is the intended state | P1 |
| EC8 | Edge | Same repo scanned twice with no change | second `gate.json` has same `diffHash` and passes `done` | P2 |
| S1 | Security | `.env` exists in the temp repo with content `SECRET=zzz9` | gate output and `gate.json` contain no `zzz9` | P0 |
| S2 | Security | Diff adds `.env` whose content includes a line that looks like a path (`x=/tmp/.env`) | output names the file once, never prints the line | P0 |
| S3 | Security | The gate module never imports a reader for `.env`: a test wraps `fs.readFileSync` and asserts it is never called with a path matching `.env` during a scan | zero such calls | P0 |
| S4 | Security | Base ref in spec starting with `-` | refused with the same wording `review` uses; never passed to git argv | P1 |
| P1 | Performance | Diff of 300 files, 20k added lines, no `.env` | under 500 ms excluding git (bound, not yet measured) | P2 |
| P2 | Performance | Running `secrets` on this repo end to end | under 3 s (bound, not yet measured) | P2 |
