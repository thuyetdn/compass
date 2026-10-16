# CP-70: Two repos can be written with the same devUrl, and the port regex reads the wrong one
Loại: bug
Phạm vi: lib/repo-detect.mjs, cli.mjs, commands/knowledge.mjs, test/repo-detect.test.mjs, test/knowledge-page.test.mjs
Gốc soi: 6be8113

## Mục tiêu

A blind review of CP-66 found two faults that feed each other. Both reproduced on 6be8113.

**1. A declared port switches off the collision check.** `lib/repo-detect.mjs:222` skips any repo
whose port was declared: `if (!url || repo.entry.__portDeclared) continue`. So the check only ever
fires when *both* repos are silent. Measured: `web` declaring `port: 5173` next to `admin`
declaring nothing (Vite's default is 5173) gives two entries with
`devUrl: "http://localhost:5173/"`, exit 0, config written. The comment two lines above says what
that costs — `visual` photographs one repo's app and files it as the other's baseline, with the
gate green.

**2. The port regex takes the first `port:` in the file.** `lib/repo-detect.mjs:105` is
`/\bport\s*:\s*(\d{2,5})\b/` over the whole text, so a `proxy` or `preview` block that appears
before `server.port` wins. Measured: a config with `proxy: {'/api': {…, port: 8080}}` above
`port: 3100` yields `http://localhost:8080/`. The wrong number is then marked `__portDeclared`,
which is what disables fault 1's net.

Two smaller findings ride along. `compass init TD-1 --multi` silently drops the task id and exits 0,
so the user believes TD-1 exists; and `knowledge --page` prints `✓ Gate knowledge PASSED` for an
operation that writes no gate record — the exact confusion Compass exists to prevent.

Done means a config is never written with two repos sharing a devUrl, the port comes from the
`server` block or not at all, `--multi` refuses a task id, and `--page` stops claiming a gate passed.

## Ràng buộc

- Still regex, never evaluation: reading a port must not execute the target project's config.
- Unsure beats confidently wrong. A port the scanner cannot place inside `server` reads as not
  declared, so the framework default applies and the collision check still sees it.
- `compass init <id> --type=` keeps its current behaviour exactly.
- `knowledge` and `knowledge --sync` keep their exit codes and their gate records.

## Rủi ro hồi quy

- CP-66-H4 asserts a declared `port: 4000` becomes the devUrl; narrowing the regex must not break
  the ordinary `server: { port: N }` shape.
- CP-66-H5 asserts the 5173 fallback when nothing is declared.
- CP-66-V4 asserts two silent Vite repos are refused; widening the check must keep that passing,
  not replace it.
- CP-66-EC4 feeds the written config to `loadConfig` and `resolveRepos`; the shape must not change.
- `--page` output is asserted by CP-67 tests on exit code, not on the word PASSED, but the wording
  change must not alter the exit code.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `server: { port: 4000 }`, nothing else | devUrl 4000 — the ordinary case still works | P0 |
| H2 | Happy | A proxy block with its own port before `server.port` | devUrl takes server.port, not the proxy port | P0 |
| H3 | Happy | `preview: { port: 4173 }` before `server: { port: 3300 }` | devUrl 3300 | P0 |
| H4 | Happy | `server.port` written after a nested object inside server | devUrl takes server.port | P1 |
| V1 | Validation | One repo declares 5173, another declares nothing | exit 2, both named, config not written | P0 |
| V2 | Validation | Two repos both declare the same port explicitly | exit 2, config not written | P0 |
| V3 | Validation | Two repos declare different ports | exit 0, config written, two distinct devUrls | P0 |
| V4 | Validation | Two silent Vite repos (the case CP-66-V4 already covers) | still exit 2 | P0 |
| E1 | Error | `compass init TD-1 --multi` | exit 2, says --multi takes no task id, writes nothing | P0 |
| E2 | Error | A port outside any server block, e.g. only `preview.port` | treated as not declared: falls back to 5173 | P0 |
| EC1 | Edge | A Next repo and a Vite repo, neither declaring a port | 3000 and 5173 differ, so exit 0 | P0 |
| EC2 | Edge | `server` appearing in a comment before the real block | does not crash; port read or absent, never a wrong number | P1 |
| EC3 | Edge | angular.json port, read through JSON not regex | unchanged by this fix | P1 |
| EC4 | Edge | `knowledge --page` output wording | does not contain "Gate knowledge PASSED" | P0 |
| EC5 | Edge | `knowledge --page` exit code | still 0 on success, 2 on malformed components.json | P0 |
| S1 | Security | A vite.config.js whose text contains shell or JS payload | still only read, never executed | P0 |
