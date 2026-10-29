# CP-94: release 3.2.0
Loại: fix
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-1.test.mjs, test/version-3-2.test.mjs (mới)

## Mục tiêu

Since 3.1.2, CP-91 (issue #3), CP-92 and CP-93 landed on `main`. Users on the `v3.1.2` tag still have
every task go red in a workspace whose sub-repo tracks `.env` files with public configuration, or
tracks Symfony `.env.dist` templates.

CP-91 adds a config key (`secretsPublic`), so this is a minor release: 3.2.0, not a patch.

Done means every place that states the version says 3.2.0, `compass --version` prints 3.2.0, the
release is tagged `v3.2.0` on the release commit and pushed with `main`, and a GitHub release for
`v3.2.0` exists whose notes say:
- what changed;
- that `secrets` records written by 3.1.2 or earlier must be rerun once (`compass check <id>`).

Released tags are not moved.

## Ràng buộc

- `package.json` stays the single source for `compass --version` (CP-77).
- The release notes name no employer or internal names. The two workspace repos from issue #3 are
  not named; the notes say "a sub-repo that tracks public `.env` files".
- SKILL.md's "3.1.2 trở về trước" wording stays: it names the last version with the old record
  format, which is still 3.1.2.

## Rủi ro hồi quy

- CP-90's tests pin 3.1.2. They move to `test/version-3-2.test.mjs` as CP-94's tests pinning
  3.2.0, and `test/version-3-1.test.mjs` is removed.
- `docs/index.html` must not keep any older version string.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.2.0; the page contains no 3.1.x or 3.0.0 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.2.0` | P0 |
