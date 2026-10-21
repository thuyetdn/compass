# CP-83: release 3.1.0
Loại: fix
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-1.test.mjs (mới)

## Mục tiêu

Everything since v3.0.0 adds to Compass and removes nothing: `compass pr` (CP-81),
`compass convention --draft` with its staleness checks (CP-82), `compass --version` (CP-77) and the
ten-criteria review gate (CP-78, CP-79, CP-80). Yet every manifest still says 3.0.0, so a user who
updates cannot tell they have the new commands, and the v3.0.0 tag was moved forward to a commit that
is not 3.0.0.

Done means every place that states the version says 3.1.0, `compass --version` prints 3.1.0, and the
release is tagged `v3.1.0` with a GitHub release. The v3.0.0 tag goes back to the last commit before
any of this work (48b4eaf), so it names what 3.0.0 shipped.

## Ràng buộc

- Minor bump, not major: no command, flag or config key was removed or renamed.
- `package.json` stays the single source for `compass --version` (CP-77). The manifests and the page
  follow it; the CP-58 and CP-76 tests that make them agree stay as they are.
- Old `.compass/*/review-brief.md` files are historical briefs and are not edited.
- The release notes name no employer or internal names.

## Rủi ro hồi quy

- CP-58-V2, CP-76-H4 and the plugin tests fail if one manifest is missed.
- The page test (release-docs) fails if `docs/index.html` keeps 3.0.0 in either place.
- Users who installed from the v3.0.0 tag: moving that tag back changes what it points to. They get
  the older code on their next install from that tag; installs from `main` are unaffected.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.1.0; the page says it in both places it names the version | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.1.0` | P0 |
