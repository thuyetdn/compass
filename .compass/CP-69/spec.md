# CP-69: The repo claims MIT in two manifests but ships no licence, and package.json names no author
Loại: fix
Phạm vi: LICENSE (mới), package.json, test/package.test.mjs
Gốc soi: ceccc25

## Mục tiêu

Measured on ceccc25, before a public release:

- There is no `LICENSE` file. `.claude-plugin/plugin.json` declares `"license": "MIT"` and README
  line 229 says "MIT.", but a repository with no licence file grants nothing: the default is all
  rights reserved, so nobody may reuse the code whatever the README says. GitHub also shows no
  licence for the repo.
- `package.json` declares neither `license` nor `author`. `npm publish` warns on the missing
  licence, and the published package credits nobody. `plugin.json` already names
  "Do Ngoc Thuyet"; the two manifests disagree by omission.

Done means the licence exists as a file, and all three places — `LICENSE`, `package.json`,
`plugin.json` — name the same licence and the same author, with a test that keeps them agreeing.

## Ràng buộc

- MIT, matching what `plugin.json` and the README already claim. This is not a licence change.
- Author "Do Ngoc Thuyet", copied from `plugin.json` rather than chosen here.
- Copyright year 2026: the first commit and the latest are both 2026.
- Standard MIT text, unmodified. A hand-edited licence is not the licence it claims to be.
- `LICENSE` goes nowhere in `package.json`'s `files`: CP-17-EC3 records that npm always packs
  `licen[cs]e` by name pattern, so declaring it would be redundant, and the test tolerates it either
  way.

## Rủi ro hồi quy

- CP-17-E1 parses `package.json` and asserts `files` is an array; adding fields must not break the
  parse or move `files`.
- CP-17-EC3 compares the npm tarball against `files`. `LICENSE` is exempt by the NPM_LUON_GOI
  pattern, so it must not appear as an out-of-scope file.
- CP-17-V1 asserts every entry in `files` exists on disk. Adding a bad entry would go red; this task
  adds none.
- The release tag v3.0.0 points at ceccc25. Adding a licence after tagging means the tag names a
  commit with no licence, so the tag moves with this commit.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | LICENSE exists at the repo root | file present, non-empty | P0 |
| H2 | Happy | LICENSE is the MIT text | contains "MIT License" and the permission + warranty paragraphs | P0 |
| H3 | Happy | Copyright line | names the year 2026 and "Do Ngoc Thuyet" | P0 |
| H4 | Happy | package.json declares the licence | `license` === "MIT" | P0 |
| H5 | Happy | package.json declares the author | `author` names Do Ngoc Thuyet | P0 |
| V1 | Validation | The three manifests agree | package.json, plugin.json and LICENSE name one licence | P0 |
| V2 | Validation | Author agrees across manifests | the name in package.json matches plugin.json | P0 |
| E1 | Error | package.json still parses after the edit | JSON.parse succeeds, `files` is still an array | P0 |
| EC1 | Edge | npm pack after adding LICENSE | LICENSE is in the tarball, and CP-17-EC3 stays green | P0 |
| EC2 | Edge | README's licence claim | still says MIT, agreeing with the file | P1 |
