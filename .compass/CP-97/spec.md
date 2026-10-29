# CP-97: release 3.2.1
Loại: fix
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-2.test.mjs

## Mục tiêu

Since 3.2.0, CP-95 and CP-96 landed on `main`. Users on the `v3.2.0` tag still get a `secrets` pass
that never scanned sub-repos when `config.json` is not valid JSON, and a `review` message that blames
the `secretsPublic` list for a context change.

Both are fixes with no new config key or command, so this is a patch release: 3.2.1.

Done means every place that states the version says 3.2.1, `compass --version` prints 3.2.1, the
release is tagged `v3.2.1` on the release commit and pushed with `main` and `compass-phase-1`, and a
GitHub release for `v3.2.1` exists whose notes say what changed and that a project with a broken
`config.json` now gets a red `secrets` gate (exit 2). Released tags are not moved.

## Ràng buộc

- `package.json` stays the single source for `compass --version` (CP-77).
- The release notes name no employer or internal names.
- No record format changes, so the notes ask for no rerun after upgrading from 3.2.0.

## Rủi ro hồi quy

- CP-94's tests pin 3.2.0 in `test/version-3-2.test.mjs`; they become CP-97's tests pinning 3.2.1 in
  the same file.
- `docs/index.html` must not keep any older version string.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.2.1; the page contains no 3.2.0, 3.1.x or 3.0.0 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.2.1` | P0 |
