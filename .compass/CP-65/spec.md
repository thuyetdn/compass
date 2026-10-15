# CP-65: Three small truths before release — `output/` is not ignored, a test title must carry one ID, and agent worktrees show up in git status
Loại: fix
Phạm vi: skills/compass/SKILL.md, docs/huong-dan.md, .gitignore
Gốc soi: 1658b54
Kiểm tra bằng: mắt

## Mục tiêu

Three things a developer trying Compass would trip on, measured on HEAD 1658b54.

1. **SKILL.md "Script và dữ liệu"** (line 526) says: "Đừng để ở `output/` — thư mục đó bị
   `.gitignore` che". It is not. `lib/signature.mjs` writes `.salt\ndata/\n` and deliberately leaves
   `output/` unignored (its comment: "sản phẩm là thứ mang đi dùng và có khi muốn commit"), and
   CP-30-V1 tests exactly that. The advice — keep scripts in `.compass/scripts/`, not `output/` — is
   still right; the reason given is false. The real reason: `output/` belongs to one task and holds
   things made for the user, so a reusable script left there is not found by `compass scripts`
   nor by the next task.
2. **A test title that mentions a second ID is not counted.** Measured with `extractRanIds`:
   output `ok 1 - T-1-H1 xử lý giống H2` + `ok 2 - T-1-H2 thật`, spec IDs `H1, H2`, task `T-1` →
   `ran: ["H2"]`, `seenOnSharedLines: ["H1"]`. H1 is not credited because its line also names H2.
   The CP-63 agent hit this in this very repo (its task first showed 11/17). `docs/huong-dan.md`
   tells developers how to name tests but not this.
3. **`.claude/` shows in `git status`** of this repo whenever Claude Code runs an agent in worktree
   mode, because `.claude/worktrees/` is not ignored. CP-60 made the gates skip linked worktrees, so
   this is no longer a gate problem — but a developer running `git add .` would stage the worktree as
   a gitlink. The root `.gitignore` already lists scratch folders agents create (`.probe-tmp/`,
   `.tmp-review/`) for the same reason.

Done means: the SKILL.md sentence gives the true reason, the guide says a test title carries exactly
one spec ID, and `.claude/worktrees/` is in the root `.gitignore`.

## Ràng buộc

- Only the named passages change. Vietnamese follows `skills/compass/references/writing-vi.md`;
  "kiểm tra" and "case" in full (`test/wording.test.mjs` scans both docs).
- `.gitignore` gains one entry, `.claude/worktrees/`, next to `.probe-tmp/` with a one-line comment.
  It does not ignore all of `.claude/` — a project may commit `.claude/settings.json` on purpose.
- No code change.

## Rủi ro hồi quy

- **`test/wording.test.mjs`, `test/writing-guide-faithful.test.mjs`, `test/release-docs.test.mjs`**
  read SKILL.md and the guide (clipped words, pair count, headings, commands, links). All must stay
  green.
- **`.gitignore` hiding a real file.** `.claude/worktrees/` only; `git check-ignore .claude/settings.json`
  must still exit 1.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read SKILL.md "Script và dữ liệu" after the edit | It no longer says `output/` is ignored; it says scripts go in `.compass/scripts/` because `output/` belongs to one task and `compass scripts` does not list it | P0 |
| H2 | Happy | Read the naming paragraph in `docs/huong-dan.md` "Task đầu tiên" | It says a test title carries exactly one spec ID, with an example of a title naming two IDs and what the gate does with it | P0 |
| H3 | Happy | `git check-ignore .claude/worktrees/x` and `git check-ignore .claude/settings.json` | first exits 0, second exits 1 | P0 |
| H4 | Happy | `git diff` of the commit, then `node --test test/wording.test.mjs test/writing-guide-faithful.test.mjs test/release-docs.test.mjs` | only the named passages and one `.gitignore` entry change; all three files pass | P1 |
