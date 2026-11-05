# CP-102: release 3.3.1
Loại: fix
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-3.test.mjs

## Mục tiêu

Since 3.3.0, CP-101 landed on `main`: issue #5, untracked files behind a symlink or junction no
longer reach the review brief, and `review` prints one note naming the link directory. A bug fix
with no new flag or format makes this a patch release: 3.3.1.

Done means every place that states the version says 3.3.1, `compass --version` prints 3.3.1, the
release is tagged `v3.3.1` on the release commit and pushed with `main` and `compass-phase-1`, and a
GitHub release for `v3.3.1` exists whose notes say what changed and that a review brief only
changes when the repo has such a link. Released tags are not moved.

## Ràng buộc

- `package.json` stays the single source for `compass --version` (CP-77).
- The release notes name no employer or internal names.
- No gate record format changes, so the notes ask for no `check` rerun.

## Rủi ro hồi quy

- CP-100's tests pin 3.3.0 in `test/version-3-3.test.mjs`; they become CP-102's tests pinning 3.3.1.
- `docs/index.html` must not keep any older version string.
- CP-98's tests compare against tag `v3.2.1`; that tag must stay where it is.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.3.1; the page contains no 3.3.0, 3.2.x, 3.1.x or 3.0.0 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.3.1` | P0 |
