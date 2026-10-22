# CP-86: fix a garbled comment and two descriptions of secrets for sub-repos
Loại: fix
Phạm vi: lib/review-brief.mjs, commands/secrets.mjs, skills/compass/SKILL.md, test/cp86-text.test.mjs (mới)

## Mục tiêu

CP-84's last review left three text faults, none of which change behaviour:

- A comment above the `rename from` prefix code in `lib/review-brief.mjs` has a copy of the code line
  pasted into the middle of it, where `$&` was meant to stand.
- The `secrets` row of the sub-repo table in SKILL.md says any repo on its main branch with no
  declared base contributes only uncommitted changes. The code does that only for repos outside
  `Phạm vi`; a repo in `Phạm vi` is diffed as `review` diffs it.
- The comment in `commands/secrets.mjs` drops the same "outside `Phạm vi`" qualifier.

Done means the comment reads as one sentence with `$1` and `$&` in code spans, and both descriptions
say "outside `Phạm vi`".

## Ràng buộc

Không đổi code chạy: chỉ comment và tài liệu.

## Rủi ro hồi quy

- The CP-84 tests and the doc tests (release-docs) must stay green.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read the comment lines above the rename replace in `lib/review-brief.mjs` | no comment line holds code (`collected.diff.replace`); the line names `$1` and `$&` in backticks | P0 |
| H2 | Happy | Read the `secrets` row in SKILL.md and the sub-repo comment in `commands/secrets.mjs` | both say the uncommitted-only rule is for repos outside `Phạm vi` | P0 |
