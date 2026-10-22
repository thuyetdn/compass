# CP-87: release 3.1.1
Loại: fix
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-1.test.mjs

## Mục tiêu

Since 3.1.0, three changes landed on `main`: CP-84 fixes issue #1 (`review`, `secrets` and
`compass pr` now see sub-repos that have their own git), CP-85 gives a timing test room under a
parallel suite, and CP-86 corrects two descriptions of `secrets`. Users who install from the `v3.1.0`
tag still have the bug from issue #1.

Done means every place that states the version says 3.1.1, `compass --version` prints 3.1.1, and the
release is tagged `v3.1.1` with a GitHub release. `v3.1.0` stays where it is.

## Ràng buộc

- Patch bump: these are fixes. `Gốc soi (be):` is a new spec line, but it only matters for layouts
  that did not work before, and nothing existing changes meaning.
- `package.json` stays the single source for `compass --version` (CP-77).
- The released tags `v3.0.0` and `v3.1.0` are not moved.
- The release notes name no employer or internal names.

## Rủi ro hồi quy

- CP-83's tests pin 3.1.0. They become CP-87's tests pinning 3.1.1 in the same file; CP-83's
  evidence was recorded on 3.1.0 and is not rerun.
- CP-58-V2, CP-76-H4 and the plugin tests fail if one manifest is missed.
- The page test fails if `docs/index.html` keeps 3.1.0 in either place.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.1.1; the page says it in both places and no longer says 3.1.0 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.1.1` | P0 |
