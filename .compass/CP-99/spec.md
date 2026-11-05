# CP-99: CP-98 leftovers — doc example line, one raw `repos` reader, dead filter, newline file names
Loại: bug
Gốc soi: 2e1d887
Phạm vi: lib/repo-conventions.mjs, lib/convention-draft.mjs, commands/convention.mjs, skills/compass/SKILL.md, templates/AGENTS.md, test/repo-conventions.test.mjs

## Mục tiêu

The third blind review of CP-98 left four non-blocking findings; the user asked to fix them all
before the release:

1. SKILL.md (line 412) and `templates/AGENTS.md` (line 83) show the pending line as a code span
   holding another code span (`` `⚠ Repo `be` …` ``), which renders broken, and the text differs
   from what `pendingLine('be')` prints.
2. Reading `repos` straight from `config.json` is written three times
   (`commands/convention.mjs`, `lib/convention-draft.mjs`, `lib/repo-conventions.mjs`), two of them
   building the path by hand instead of `configPath`.
3. `units()` in `lib/convention-draft.mjs` keeps a `.filter((r) => only === null || …)` that can
   never drop anything, because `only` returns early.
4. CP-98 spec case S4 promised file names with a newline are handled; only the leading-`-` half has
   a test.

Done means: SKILL.md shows the exact line `pendingLine('be')` prints, in a fenced block, and
AGENTS.md has no nested code span; one function, `readDeclaredRepos(root)` in
`lib/repo-conventions.mjs`, reads the raw `repos` for all three callers through `configPath`; the
dead filter is gone; a sibling file whose name contains a newline neither breaks the brief nor
appears as a partial name.

Behaviour of every command stays as it is, except messages already covered below.

## Ràng buộc

- No output change for a valid config: plain `--draft` stays byte-identical to `v3.2.1`, CP-98's
  tests stay green unchanged.
- The JSON parser's message is never printed (it quotes part of `config.json`, CP-96 rule).
- Zero runtime dependencies; `lib/` never exits.

## Rủi ro hồi quy

- `--repo` validation (CP-98-V1, V2, S3) and the draft fallback when `loadConfig` fails (CP-98-H6)
  go through the new reader: they must keep their exit codes and messages.
- `repoLayout` feeds every review brief: a valid config must map files to the same repos.
- Removing the filter must not change plain `--draft` (EC2 pins it against `v3.2.1`).
- A file name with a newline cannot be created on Windows; EC1 measures only on Linux and macOS and
  says so in a diagnostic on Windows.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read SKILL.md and `templates/AGENTS.md` | SKILL.md contains `pendingLine('be')` verbatim on its own line inside a fenced block; neither file contains a backtick span opening with `` `⚠ Repo ` `` | P0 |
| H2 | Happy | Workspace with `repos: { be }`: `readDeclaredRepos`, `repoLayout`, `convention --draft --repo=be` | reader returns ok with key `be`; layout maps `be/x.php` to `be`; draft exits 0 | P0 |
| V1 | Validation | `repos` is an array | reader returns ok with `repos: null`; `--draft --repo=be` exits 2 naming `repos`; layout has no repos | P1 |
| E1 | Error | `config.json` is not JSON (`{ "repos": `) | `--draft --repo=be` exits 2 with "không phải JSON hợp lệ" and no parser text (no "Unexpected", no "position"); `collectContext` still builds a brief | P0 |
| EC1 | Edge | Sibling `src/a\nb.php` next to two normal `.php` files, task adds `src/z.php` (Linux/macOS only) | brief built; every sample is a real file in `src/`; no sample is `src/a` or `b.php` | P1 |
| EC2 | Edge | Plain `--draft` on a multi-repo workspace after the filter is removed | text byte-identical to `v3.2.1`'s `buildDraft` | P0 |
