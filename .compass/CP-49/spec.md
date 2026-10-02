# CP-49: SKILL.md still describes the multi-repo ledger and the review scope as before CP-47 and CP-48
Loại: fix
Phạm vi: skills/compass/SKILL.md
Kiểm tra bằng: mắt

## Mục tiêu

Two passages in SKILL.md are now partly wrong:

1. "Giai đoạn hiện tại" says `convention`, `ui`, `visual` record without the repo name, so multi-repo
   projects should trust only `test` and `knowledge`. That is still true for a **real run** of those
   gates (they call `writeGate` with no repo, checked 02/10/2026). But skip records from `check` do
   carry the repo (`ui@<repo>`). Since CP-47, `done` accepts them when every repo in scope skipped.
   The passage must keep the real limitation and add the skip rule, not drop either one.
2. The `review` section never says that `.compass/**` is left out of the diff, or that, since CP-48,
   a `.compass/` path declared in `Phạm vi:` is reviewed. Without that, a task whose code lives in
   `.compass/scripts/` sees "0 file" and no hint of the way out.

Done means both passages say exactly what the code does today, in the skill's own Vietnamese style.

## Ràng buộc

- Docs only, no code change.
- Do not claim more than the code does: real `convention`/`ui`/`visual` runs in multi-repo mode are
  still not repo-scoped.
- Follow references/writing-vi.md: conclusion first, consequences instead of mechanics, no padding.

## Rủi ro hồi quy

- Overstating the CP-47 fix would tell multi-repo users to trust `ui`/`visual` records that can still
  overwrite each other. H1 checks the limitation is kept.
- Nothing else in SKILL.md changes.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read "Giai đoạn hiện tại" after the edit | It still says real `convention`/`ui`/`visual` runs record without the repo and only `test`/`knowledge` are trustworthy across repos; it adds that skip records are per repo and `done` accepts them only when every repo in scope skipped | P0 |
| H2 | Happy | Read the `review` section after the edit | It says `.compass/**` is excluded and why, that a `.compass/` path declared in `Phạm vi:` is reviewed with or without `Soi đến`, and that `evidence/`, `review/`, `review-brief.md` and `.salt` never enter even when declared | P0 |
| H3 | Happy | `git diff` of the commit | Only those two passages of skills/compass/SKILL.md change | P1 |
