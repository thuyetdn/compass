# CP-118: release 3.5.2
Loại: fix
Gốc soi: ea9c663
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-5.test.mjs

## Mục tiêu

Since 3.5.1, CP-117 landed on `main`: the source hash reads only files git knows (tracked, or untracked
and not ignored), so ignored folders such as a Python `.venv` or a PHP `vendor` are no longer read on
every gate. On one multi-repo project a single hash went from over 10 minutes to 4.6 s warm. It is a fix
with no new command or gate, so this is a patch release: 3.5.2.

Done means every place that states the version says 3.5.2, `compass --version` prints 3.5.2, the
release is tagged `v3.5.2` on the release commit (checked with `git show --stat` before tagging) and
pushed with `main` and `compass-phase-1`, and a GitHub release for `v3.5.2` exists whose notes say what
changed and what happens after upgrading: in a project with ignored files outside the skipped folders,
tasks in progress need one more `compass check`. Released tags are not moved.

## Ràng buộc

- `package.json` stays the single source for `compass --version` (CP-77).
- The release notes name no employer or internal names.

## Rủi ro hồi quy

- CP-114's tests pin 3.5.1 in `test/version-3-5.test.mjs`; they become CP-118's tests pinning 3.5.2 in the
  same file.
- `docs/index.html` must not keep any older version string.
- CP-98's tests compare against tag `v3.2.1`; that tag must stay where it is.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.5.2; the page contains no 3.5.1, 3.5.0, 3.4.x, 3.3.x, 3.2.x, 3.1.x or 3.0.0 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.5.2` | P0 |
