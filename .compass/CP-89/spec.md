# CP-89: a declared folder outside the root that is not a git is skipped like an outside git, and the docs and tests CP-88 left behind
Loại: feature-s
Gốc soi: eae2d3e
Phạm vi: lib/workspace-git.mjs, test/workspace-git-scope.test.mjs, test/workspace-git-outside.test.mjs (mới), README.md, docs/huong-dan.md, docs/index.html, skills/compass/SKILL.md

## Mục tiêu

CP-88's last review left three things:

- A declared repo that is a junction (or a path) to a folder outside the Compass root that is not a
  git makes `review` and `secrets` exit 2 for every task, with a wrong message: "có .git nhưng git
  không đọc được (safe.directory)". The cause: git finds no repo there, and the lexical walk up then
  finds the root's own `.git`. This is the same failure issue #2 reported for an outside git.
- README and `docs/huong-dan.md` still say `secrets` scans every repo. A skipped outside repo is not
  scanned.
- Four tests in `test/workspace-git-scope.test.mjs` return early, and so count as passing, when the
  file system does not let them run (S7, V4, S9, EC5).

Done means:
- A declared repo whose real folder lies outside the root and is not in a git is treated like an
  outside git: refused (exit 2) when it is in `Phạm vi`, skipped with one note otherwise. Messages say
  the folder lies outside the root; none mention `.git` or `safe.directory`.
- README and `docs/huong-dan.md` say `secrets` scans every repo except one skipped because it lies
  outside the root.
- The four tests call `t.skip()` with a reason instead of returning, so a run on an unsuitable file
  system reports them as skipped, not passed.

## Ràng buộc

- A real broken `.git` inside the root still reports "git không đọc được" (CP-84-E10, E11, E12).
- The skip reads none of the folder's untracked files, as for an outside git (CP-88): files a git
  already tracks under that path stay scanned.
- Single-git projects do not change.

## Rủi ro hồi quy

- CP-84-E10/E11/E12 (unreadable `.git` makes both gates red) must hold.
- CP-88-H3, E1, S1, S5, S7 (outside git skipped or refused, nothing leaks) must hold.
- CP-84-S3 (a repo in `Phạm vi` linked to a git outside the root is refused) must hold.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Repo `vendor` is a junction to a non-git folder outside the root, not in `Phạm vi` | `review` and `secrets` run, each prints one `Bỏ qua repo "vendor"` line | P0 |
| H2 | Happy | Same, with `vendor/x.js` in `Phạm vi` | `review` and `secrets` exit 2: its folder lies outside the root | P0 |
| H3 | Happy | Read README and `docs/huong-dan.md` | both say a repo skipped because it lies outside the root is not scanned | P1 |
| V1 | Validation | The messages for `vendor` | name the outside folder; never mention `.git` or `safe.directory` | P1 |
| V2 | Validation | `Gốc soi (vendor):` in the spec | exit 2: its folder lies outside the root | P2 |
| E1 | Error | A sub-repo inside the root whose `.git` is a broken gitfile | still "git không đọc được", exit 2 | P0 |
| E2 | Error | The root is not a git and the only declared repo is the outside non-git folder | `secrets` does not pass | P1 |
| EC1 | Edge | The junction sits inside sub-repo `be` (`be/vendor`) | skipped; be's diff holds none of its files | P1 |
| EC2 | Edge | The repo is declared by `path` (`libs/vendor`) under another name | skipped by that name, no leak | P2 |
| EC3 | Edge | Read `test/workspace-git-scope.test.mjs` | no test returns early on the file system check; each calls `t.skip` with a reason | P1 |
| S1 | Security | The outside folder holds a `.env` with a secret value and the root ignores nothing | no output, brief or context holds the value or the file name | P0 |
| S2 | Security | `Phạm vi` names it as `./vendor/x.js` | refused, not skipped | P1 |
| S3 | Security | The root git tracks `vendor/.env` under the junction | `secrets` still fails on it | P1 |
