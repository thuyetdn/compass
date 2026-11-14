# CP-114: release 3.5.1
Loại: fix
Gốc soi: 4ae38eb
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-5.test.mjs

## Mục tiêu

Since 3.5.0, CP-113 landed on `main`: four fixes with no new command or gate. The claim check no longer
judges a file the task deletes or renames away; `compass preflight` and `compass mutation` reject a task
id that leaves `.compass/`; `compass pr --since` refuses a commit before the fork point; and a
`reviewLenses` key that is not a task type is an error. Fixes only make this a patch release: 3.5.1.

Done means every place that states the version says 3.5.1, `compass --version` prints 3.5.1, the
release is tagged `v3.5.1` on the release commit (checked with `git show --stat` before tagging) and
pushed with `main` and `compass-phase-1`, and a GitHub release for `v3.5.1` exists whose notes say what
changed and what turns red after upgrading: a `reviewLenses` key that is not a task type. Released
tags are not moved.

## Ràng buộc

- `package.json` stays the single source for `compass --version` (CP-77).
- The release notes name no employer or internal names.

## Rủi ro hồi quy

- CP-112's tests pin 3.5.0 in `test/version-3-5.test.mjs`; they become CP-114's tests pinning 3.5.1 in the
  same file.
- `docs/index.html` must not keep any older version string.
- CP-98's tests compare against tag `v3.2.1`; that tag must stay where it is.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.5.1; the page contains no 3.5.0, 3.4.x, 3.3.x, 3.2.x, 3.1.x or 3.0.0 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.5.1` | P0 |
