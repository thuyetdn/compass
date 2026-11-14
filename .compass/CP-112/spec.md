# CP-112: release 3.5.0
Loại: fix
Gốc soi: b8a3a40
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-5.test.mjs

## Mục tiêu

Since 3.4.0, CP-106 to CP-111 landed on `main` and finish issue #7: review in rounds with a signed
ledger, verify-only rounds and a disposition rubric (CP-106, CP-107), the `preflight` gate with
migration checks and environment facts (CP-108), the `mutation` gate (CP-109), the claim check
(CP-110), and findings per lens with `compass pr --preflight` and `--since` (CP-111). Two new gates and
new commands make this a minor release: 3.5.0.

Done means every place that states the version says 3.5.0, `compass --version` prints 3.5.0, the
release is tagged `v3.5.0` on the release commit and pushed with `main` and `compass-phase-1`, and a
GitHub release for `v3.5.0` exists whose notes say what changed and what turns red after upgrading:
`feature-m` and `feature-l` specs without `## Môi trường`, open `feature-s` and larger tasks that need
`check` again for the `mutation` record, and docs or specs naming a path, commit or function that does
not exist. Released tags are not moved.

## Ràng buộc

- `package.json` stays the single source for `compass --version` (CP-77).
- The release notes name no employer or internal names.

## Rủi ro hồi quy

- CP-105's tests pin 3.4.0 in the 3.4 version test file; it is renamed to `test/version-3-5.test.mjs`
  as CP-112's tests pinning 3.5.0.
- `docs/index.html` must not keep any older version string.
- CP-98's tests compare against tag `v3.2.1`; that tag must stay where it is.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.5.0; the page contains no 3.4.x, 3.3.x, 3.2.x, 3.1.x or 3.0.0 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.5.0` | P0 |
