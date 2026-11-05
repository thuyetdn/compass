# CP-100: release 3.3.0
Loại: fix
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-3.test.mjs

## Mục tiêu

Since 3.2.1, CP-98 and CP-99 landed on `main`: issue #4, per-repo conventions in the review brief,
a new `--repo` flag for `compass convention --draft`, and a pending line in `status`, `done` and
`pr`. A new flag and a changed brief make this a minor release: 3.3.0.

Done means every place that states the version says 3.3.0, `compass --version` prints 3.3.0, the
release is tagged `v3.3.0` on the release commit and pushed with `main` and `compass-phase-1`, and a
GitHub release for `v3.3.0` exists whose notes say what changed and that review briefs of in-flight
tasks without declared conventions change once (sample choice and the new count), so an open
`review` or `compass pr` reopens one time after upgrading. Released tags are not moved.

## Ràng buộc

- `package.json` stays the single source for `compass --version` (CP-77).
- The release notes name no employer or internal names.
- No gate record format changes, so the notes ask for no `check` rerun; only open reviews reopen.

## Rủi ro hồi quy

- CP-97's tests pin 3.2.1 in `test/version-3-2.test.mjs`; they move to `test/version-3-3.test.mjs`
  as CP-100's tests pinning 3.3.0.
- `docs/index.html` must not keep any older version string.
- CP-98's tests compare against tag `v3.2.1`; that tag must stay where it is.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.3.0; the page contains no 3.2.x, 3.1.x or 3.0.0 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.3.0` | P0 |
