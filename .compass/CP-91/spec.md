# CP-91: secrets accepts tracked .env files declared public in config.json, and treats .dist as an example file
Loại: feature-m
Gốc soi: 69ec39a
Phạm vi: lib/secrets-scan.mjs, lib/config.mjs, commands/secrets.mjs, commands/done.mjs, commands/status.mjs, test/secrets-public.test.mjs (mới), test/secrets-scan.test.mjs, skills/compass/SKILL.md, docs/huong-dan.md

## Mục tiêu

Issue #3. Since 3.1.x `secrets` scans the index of every sub-repo, in or out of `Phạm vi`. One
workspace has a repo (`api`) that has tracked five `.env*` files since 04/2023 on
purpose: they hold public configuration, confirmed by the workspace owner. Another
(`shop/backend`) tracks `.env.dist` and `.env.docker.dist`, the Symfony convention for template
files. `secrets` is red on every task in that workspace, and no task can reach `done` by any
legitimate route.

Done means:
- `config.json` accepts `secretsPublic`: a list of exact paths, written the way the gate prints
  them (`api/.env.alpha`). A path in that list that git tracks no longer fails
  reason 1. The gate prints one `ℹ` line per such file, on green and on red, so nobody reads the
  green as "scanned and clean". For the same reason the green `PASSED` line, when such files
  exist, says how many tracked files were left unscanned instead of claiming the index holds no
  `.env`.
- A `.env` file whose last suffix is `dist` is an example file, exempt like `.example`, `.sample`
  and `.template`.
- `done` treats `secrets` as config-dependent: a `secrets` record written before `config.json`
  changed is stale, so removing a path from `secretsPublic` after a green run reopens the gate.

Design choices this spec makes, which the reviewer must approve (the issue's "Điều cần quyết"):
1. **Exact paths, no wildcards.** The issue proposes `api/.env*`. A glob also
   covers a `.env.production.local` that someone commits next month with live keys, and the gate
   would stay silent. Exact paths mean each new public file costs one reviewed config line.
   An entry with `*`, `?`, `[` or `{` is refused (exit 2).
2. **Tracked files only, reason 1 only.** The declaration says "this committed file is public".
   It does not cover reason 2 (a declared path that sits on disk untracked and unignored stays
   red) nor reason 3 (new code reading `.env` still needs `Dùng .env:` in the spec).
3. **Any repo, in or out of `Phạm vi`.** The issue suggests limiting it to out-of-scope repos.
   That would leave every task that edits `api` itself unable to close, since its
   five files are tracked there too. The exact-path rule already bounds the hole.

## Ràng buộc

- The gate never opens a declared file. Exemption is decided by path only, like every other
  decision in `secrets-scan.mjs`.
- Config validation for `secretsPublic` runs only in `secrets` (and is shown by `status`).
  `loadConfig` keeps its current contract, so a malformed `secretsPublic` does not break `test`,
  `ui` or `pr`. `secrets` reads `secretsPublic` from the parsed JSON itself, so a `config.json`
  that `loadConfig` rejects (no `test` field, a layout some workspaces still use) does not make the
  declaration vanish silently. A `config.json` that is not valid JSON makes `secrets` print one `ℹ`
  line saying `secretsPublic` was not read.
- The `secrets` record's `configHash` is the hash of the config file whenever the gate runs,
  including when the file is missing or rejected, the same way `test` hashes it. `done` then names
  a changed config, not "an old record", in those cases.
- Paths are compared after `normalisePath` (`\` → `/`, leading `./` dropped), case-sensitively.
  On a case-insensitive file system a mismatched case therefore stays red: the safe direction.
- No new git calls: the declared list is matched against the `ls-files` output the gate already
  reads.
- Projects without `secretsPublic` see no change in output or exit code.

## Rủi ro hồi quy

- Reason 1/2/3 behaviour for undeclared files: every existing test in `secrets-scan.test.mjs`,
  `secrets-command.test.mjs` and `workspace-git-scope.test.mjs` must hold.
- `isExemptExample` stays last-segment based (`.env.dist.local` must still be a secret file,
  `.env.production.example` stays exempt, `.env.example.production` stays blocked).
- `done` configHash check for `test` keeps its current message and behaviour.
- `secrets` records written by 3.1.2 store `configHash` as a hash of the parsed JSON, not of the
  file. After this change `done` compares file hashes, so a task with a green 3.1.2 `secrets`
  record must rerun `check` once. Intended, but it is a visible change: `done` names the reason.
- `status` output for projects without `secretsPublic` unchanged.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Issue #3 layout: out-of-scope sub-repo `be` (own git) tracks `.env`, `.env.alpha`; both listed in `secretsPublic` as `be/.env`, `be/.env.alpha`; task edits `fe` | `secrets` exit 0, output has one `ℹ` line naming each of the two paths; the `PASSED` line says 2 tracked files declared public were not scanned and does not say "không thấy file .env nào … trong index" | P0 |
| H2 | Happy | Sub-repo tracks `backend/.env.dist` and `backend/.env.docker.dist`, no `secretsPublic` | `secrets` exit 0; both listed in the "example file, exempt" note when in the diff | P0 |
| H3 | Happy | Single-git project tracks `.env`, `secretsPublic: [".env"]` | `secrets` exit 0 with the `ℹ` line | P1 |
| H4 | Happy | `be` is in `Phạm vi` and its declared `be/.env.alpha` is modified by the task | `secrets` exit 0: declaration holds in scope too | P0 |
| H5 | Happy | `compass status` with `secretsPublic` of two paths | output lists both paths under a line saying `secrets` does not scan them | P2 |
| V1 | Validation | `secretsPublic` is a string, not an array | `secrets` exit 2 naming the field and the expected shape | P1 |
| V2 | Validation | An entry is `be/.env*` | exit 2: wildcards are refused, message says to list each file | P0 |
| V3 | Validation | An entry is empty, a number, absolute (`/srv/.env`, `C:/x/.env`), contains `..`, or starts with `-` | exit 2 naming the entry, for each form | P1 |
| V4 | Validation | An entry is `src/app.js` (not a `.env` file) or `.env.example` (already exempt) | exit 2: entry names no file the gate would block | P2 |
| V5 | Validation | An entry written `.\be\.env` on Windows | treated as `be/.env`: exempt | P1 |
| E1 | Error | `secretsPublic` lists `be/.env.prod`, git does not track it | gate result unchanged by it; one `ℹ` line says the declared file is not tracked | P1 |
| E2 | Error | `config.json` has invalid `secretsPublic` and a `test` command | `compass test` still runs; only `secrets` refuses | P1 |
| E3 | Error | `config.json` has `secretsPublic: ["be/.env", "be/.env.alpha"]` but no `test` field (rejected by `loadConfig`); then, separately, `config.json` is not valid JSON | first: `secrets` exit 0 with both `ℹ` lines, and the record's `configHash` equals the hash of the file; second: one `ℹ` line says `secretsPublic` was not read | P1 |
| EC1 | Edge | `be/.env` declared; `be/.env.local` also tracked, not declared | exit 1 on `be/.env.local` only | P0 |
| EC2 | Edge | `be/.env.dist.local` tracked | still a secret file: exit 1 | P0 |
| EC3 | Edge | Declared `be/.env` on a case-insensitive file system, entry written `BE/.env` | not exempt: exit 1 (safe direction) | P2 |
| EC4 | Edge | `isExemptExample` for `.env.dist`, `.env.docker.dist`, `.env.DIST`, `.env.dist.local`, `.env.production.example`, `.env.example.production` | true, true, true, false, true, false | P1 |
| S1 | Security | Declared `be/.env` is deleted from the index but left on disk, not ignored | reason 2 still fails on it | P0 |
| S2 | Security | Declared `fe/.env.local` exists untracked and unignored | reason 2 fails: declaration covers tracked files only | P0 |
| S3 | Security | Task adds code reading `be/.env`, which is declared, and spec has no `Dùng .env:` | reason 3 fails | P0 |
| S4 | Security | Declared files hold a value `SECRET_VALUE_91` | neither `secrets` output nor `gate.json` contains it | P0 |
| S5 | Security | `secrets` green with `be/.env` declared, then the entry is removed from `config.json` | `done` fails, naming `secrets` and saying config changed since it ran | P0 |
| S6 | Security | `secrets` record without `configHash` | `done` treats it as an old record and asks to rerun | P1 |
| S7 | Security | A 3.1.2-style green `secrets` record: `configHash` is the hash of the parsed config JSON, config file unchanged since | `done` fails naming `secrets` and the 3.1.2 wording | P1 |
| P1 | Performance | Count of `git` processes spawned by `secrets` on the H1 layout, with and without `secretsPublic` | equal counts | P1 |
| P2 | Performance | `scanSecrets` on 20,000 tracked `.env` paths, run with 500 and with 10,000 declared paths taken from the end of the list, measured with `measureGrowth` (5 interleaved pairs, smallest ratio; CP-62 forbids clocks in test files) | time with 10,000 ≤ 3× time with 500: lookup does not grow with tracked × declared. Measured 27/10/2026: Set lookup 0.76–1.30×, three pairwise variants 5.4–7.1× | P2 |
