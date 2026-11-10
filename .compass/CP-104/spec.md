# CP-104: CP-103 review leftovers — evidence path forms, approve wording, junction on the approved folder, status count
Loại: bug
Phạm vi: lib/repo-conventions.mjs, commands/convention.mjs, commands/status.mjs, skills/compass/SKILL.md, test/repo-convention-leftovers.test.mjs
Gốc soi: 80257c7

## Mục tiêu

CP-103's third review round passed with three Minor findings and one Info, fixed here:

1. The repo draft names config files from the workspace root (`be/.prettierrc`), but evidence only
   accepted repo-relative paths, so citing a file exactly as the draft names it was refused with "Không
   có bằng chứng". Evidence now also accepts a path that starts with the repo's own prefix and resolves
   inside the repo, and the draft's instructions say paths are written from the repo.
2. `--approve` refusing printed "✗ Gate convention FAILED", though it runs no gate and writes no record.
   It now prints a plain refusal line.
3. When `.knowledge/decided/conventions` is a junction to a folder holding `be.md`, the gate says the
   file is missing while `--approve` said it already exists and suggested deleting it — a file outside
   the workspace. `--approve` now checks the folders on the destination path without following links
   before the existence check, and refuses naming the link.
4. `status` printed "Repo (1):" above two entries when one declared repo is missing; the count now
   includes missing repos.

## Ràng buộc

- Evidence still never counts `..`, absolute paths, or paths through a link; a workspace-level file
  outside the repo (root `.editorconfig`) still does not count.
- No change for workspaces without missing repos or links.

## Rủi ro hồi quy

- CP-103 tests on approve output match lines, not the header; they must stay green.
- CP-103-S3 (approve through a junction) keeps exiting 2.
- `status` output is unchanged when no repo is missing.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Every criterion cites `be/src/a.ts` (repo prefix + path) | `--approve` exits 0 | P0 |
| H2 | Happy | `--approve` refuses an unfilled draft | output does not contain "Gate convention", still names the criteria | P1 |
| V1 | Validation | `.knowledge/decided/conventions` is a junction to a folder holding `be.md` | `--approve` exits 2 naming the link, does not say "Đã có" nor suggest deleting; the outside file is unchanged | P0 |
| E1 | Error | A criterion cites `be/../outside.txt` and another cites the root `.editorconfig` | both criteria are named as lacking evidence | P0 |
| EC1 | Edge | `status` without task id, repos `be` and missing `x` | header says "Repo (2):" | P1 |
| EC2 | Edge | Draft instructions | say evidence paths are written from the repo, with an example | P2 |
