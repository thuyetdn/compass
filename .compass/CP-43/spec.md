# CP-43: A `#` anywhere in a line blinds the secrets gate to a `.env` read on it
Loại: bug
Phạm vi: lib/secrets-scan.mjs, test/secrets-scan.test.mjs
Gốc soi: b5aa597

## Mục tiêu

`stripComments` treats `#` as a comment opener in every file, so `readsEnv` returns null for
any line that holds one before the `.env`. A JavaScript private field is enough:

| Line | Reported now | Should be |
|---|---|---|
| `this.#env = 1; readFileSync('.env')` | null | `.env` |
| `#!/bin/sh` (a shell file) | null | null — still a comment |
| `# tai lieu ve .env` (a shell file) | null | null — still a comment |

Measured on HEAD (b5aa597). The gate runs for every task type, so a one-line `fix` can add a
`.env` read on a line with a `#` and the gate stays green — a report of "no `.env` read found"
for a file it could not read. That is the failure mode Compass exists to refuse: green before
the scan actually happened.

Done means: `#` opens a comment only in a file whose language uses it, and a `.env` read on the
same line is still reported everywhere else. `readsEnv` takes the file path it is already given
at the one call site (`lib/secrets-scan.mjs:357`), so no caller outside the module changes.

## Ràng buộc

- No new dependency, no parser. The module stays line-based pattern matching, per its header.
- `readsEnv(line)` with no path keeps working and keeps today's behaviour — `#` opens a comment.
  The module is exported and its tests call the one-argument form; breaking it would be a second
  bug, not a fix.
- `stripProcessEnv`, `quotedStrings`, `ketRegex` and the string-skipping loop are untouched.
  `#` inside a string literal already works (`const x = '#'; readFileSync('.env')` reports
  `.env` today) because strings are consumed before this branch — the fix must keep that.
- Which extensions treat `#` as a comment is a stated list, not a guess: `.sh`, `.bash`, `.zsh`,
  `.py`, `.rb`, `.pl`, `.yml`, `.yaml`, `.toml`, `.env`, `.gitignore`, `Dockerfile`, `Makefile`.
  A file with no extension is treated as `#`-commenting, because the shebang scripts that use
  `#` are exactly the files that carry no extension.

## Rủi ro hồi quy

- **A shell script gains a false positive.** `# doc .env` in a `.sh` file is a comment and must
  stay unreported. If the fix drops the `#` branch entirely instead of making it conditional,
  every shell comment mentioning `.env` turns the gate red. V1 and V2 measure this.
- **`//` and `/* */` handling shares the loop.** Both break out of the same `for`. A change to
  the `#` branch can shift the others; E1 re-measures a `//` comment and EC3 a block comment.
- **A `#` inside a string is already correct.** `const x = '#'; readFileSync('.env')` reports
  `.env` on HEAD. The fix must not reach it — EC1 measures it.
- **URL fragments.** `'http://x/#/.env'` returns null today via the URL guard, not via `#`.
  EC2 pins that it still does, so a reader does not credit the wrong mechanism.
- **The one call site passes `file`**, which is already in scope. Everything else in the module
  and the `secrets` command is untouched; the existing suite must stay green.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `readsEnv("this.#env = 1; readFileSync('.env')", 'src/a.js')` | returns `'.env'` | P0 |
| H2 | Happy | Same line, path `src/a.ts` | returns `'.env'` | P0 |
| H3 | Happy | A `.env` read with no `#` on the line, path `src/a.js` | returns `'.env'` — unchanged | P0 |
| V1 | Validation | `readsEnv('# tai lieu ve .env', 'deploy/run.sh')` | returns `null` — still a comment | P0 |
| V2 | Validation | `readsEnv('#!/bin/sh', 'deploy/run')` — no extension | returns `null` | P0 |
| V3 | Validation | `readsEnv('# .env here', 'conf/app.yml')` | returns `null` | P0 |
| V4 | Validation | `readsEnv("x = open('.env') # nap", 'tools/a.py')` — the read sits before the `#` | returns `'.env'` — a trailing Python comment does not hide a read that precedes it | P0 |
| E1 | Error | `readsEnv("readFileSync('.env') // nap", 'src/a.js')` | returns `'.env'` — `//` still opens a comment after the read | P0 |
| E2 | Error | `readsEnv("this.#env = 1; readFileSync('.env')")` — one argument, no path | returns `null` — the documented old behaviour is preserved | P0 |
| EC1 | Edge | `readsEnv("const x = '#'; readFileSync('.env')", 'src/a.js')` | returns `'.env'` — a `#` in a string never opened a comment | P0 |
| EC2 | Edge | `readsEnv("url = 'http://x/#/.env'", 'src/a.js')` | returns `null` — via the URL guard, not the `#` branch | P1 |
| EC3 | Edge | `readsEnv("/* # */ readFileSync('.env')", 'src/a.js')` | returns `'.env'` — block comments unaffected | P1 |
| EC4 | Edge | `readsEnv('# x', 'Dockerfile')` and `readsEnv('# x', 'Makefile')` — no extension, named files | both `null` | P1 |
| S1 | Security | A `.env` read hidden after a `#` in every listed code extension (`.js`, `.ts`, `.jsx`, `.mjs`, `.go`, `.java`) | every one returns `'.env'` — the gate cannot be blinded by adding a `#` | P0 |
| P1 | Performance | 2000 lines, half holding a `#`, scanned through `readsEnv` | completes in under 200 ms | P2 |
