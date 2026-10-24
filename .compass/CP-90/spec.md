# CP-90: release 3.1.2
Loại: fix
Phạm vi: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .codex-plugin/plugin.json, docs/index.html, test/version-3-1.test.mjs, lib/workspace-git.mjs, skills/compass/SKILL.md, test/workspace-git-outside.test.mjs

## Mục tiêu

Since 3.1.1, CP-88 (issue #2) and CP-89 landed on `main`. Users on the `v3.1.1` tag still have every
task go red when sub-repos outside `Phạm vi` sit on another branch, or when a declared repo lies
outside the root.

CP-89's review left two small faults, fixed here before the release:
- The `secrets` row of SKILL.md's sub-repo table still says every repo is scanned, and the paragraph
  on unreadable `.git` says both gates always go red. Neither holds for a repo skipped because it lies
  outside the root.
- A declared repo outside the root that has a `.git` git cannot read is skipped with a note calling
  it a plain folder ("thư mục"). The note now says it is a git.

Done means every place that states the version says 3.1.2, `compass --version` prints 3.1.2, the
release is tagged `v3.1.2` with a GitHub release, and the two faults above are gone. Released tags
are not moved.

## Ràng buộc

- Patch bump: fixes only.
- `package.json` stays the single source for `compass --version` (CP-77).
- The release notes name no employer or internal names.

## Rủi ro hồi quy

- CP-87's tests pin 3.1.1; they become CP-90's tests pinning 3.1.2 in the same file.
- CP-89-H1/V1 (a plain outside folder is called "thư mục" and nothing blames `.git`) must hold.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read `package.json`, both Claude manifest entries, the Codex manifest and `docs/index.html` | each says 3.1.2; the page no longer says 3.1.1 | P0 |
| H2 | Happy | Run `node cli.mjs --version` | prints `3.1.2` | P0 |
| H3 | Happy | Read the `secrets` row and the unreadable-`.git` paragraph of SKILL.md | both name the exception for a repo skipped because it lies outside the root | P1 |
| H4 | Happy | A declared repo is a junction to a folder outside the root whose `.git` is a broken gitfile, not in `Phạm vi` | skipped, and the note calls it a git, not a folder | P1 |
