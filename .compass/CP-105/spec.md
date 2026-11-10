# CP-105: release 3.4.0
Loại: fix
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-4.test.mjs

## Mục tiêu

Since 3.3.1, CP-103 and CP-104 landed on `main`: issue #6, each sub-repo gated by its own approved
convention, a 12-criteria repo draft, the new `compass convention --approve --repo=` command, the
`convention` gate on `fix` and `bug`, and missing out-of-scope repos skipped with a note. A new
command and changed gate results make this a minor release: 3.4.0.

Done means every place that states the version says 3.4.0, `compass --version` prints 3.4.0, the
release is tagged `v3.4.0` on the release commit and pushed with `main` and `compass-phase-1`, and a
GitHub release for `v3.4.0` exists whose notes say what changed and what turns red after upgrading:
tasks touching a sub-repo without an approved convention, and open `fix`/`bug` tasks that need
`check` again for the new gate. Released tags are not moved.

## Ràng buộc

- `package.json` stays the single source for `compass --version` (CP-77).
- The release notes name no employer or internal names.

## Rủi ro hồi quy

- CP-102's tests pin 3.3.1 in `test/version-3-3.test.mjs`; they move to `test/version-3-4.test.mjs`
  as CP-105's tests pinning 3.4.0.
- `docs/index.html` must not keep any older version string.
- CP-98's tests compare against tag `v3.2.1`; that tag must stay where it is.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.4.0; the page contains no 3.3.x, 3.2.x, 3.1.x or 3.0.0 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.4.0` | P0 |
