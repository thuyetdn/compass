# CP-61: SKILL.md says `done` misses code changed after a green gate, and is silent on two behaviours CP-52 and CP-53 added
Loại: fix
Phạm vi: skills/compass/SKILL.md
Gốc soi: 4aba541
Kiểm tra bằng: mắt

## Mục tiêu

SKILL.md is what the AI reads before it talks to a developer, so a wrong sentence there becomes a
wrong answer to every developer who asks. Three passages are out of date on HEAD a369838.

1. **"Giới hạn còn lại của `done`"** (line 707) says: "`done` đọc `gate.json`, không đo lại code.
   Sửa code sau khi gate xanh thì `done` vẫn đóng được — đúng với **mọi** gate". That stopped being
   true when 5187b73 added `sourceHash`: `commands/done.mjs:286-294` recomputes `hashSource(root)` and
   refuses any source-dependent record whose hash differs. Measured today: `compass done CP-48` on
   HEAD prints "Code đã thay đổi sau khi gate "test" chạy — bằng chứng nói về bản cũ" and exits 1.
   The same file already describes this correctly in "Bốn thứ `done` đối chiếu" (row `sourceHash`) and
   "Hai giới hạn còn lại", so the document contradicts itself. The true remaining limit is narrower:
   `done` does not re-run tests, and restoring both code and `gate.json` to an earlier green state
   passes (already stated in "Hai giới hạn còn lại").
2. **Review scope** (line 373) says the default base is "điểm rẽ khỏi nhánh chính, hoặc commit đầu
   tiên nếu không có". Since CP-52, a repository whose only commit is HEAD is diffed from git's empty
   tree, so that first commit is reviewed (and scanned by `secrets`) too. The passage does not say so.
3. **`investigate --close`** (line 502) lists what blocks a close: missing evidence, conclusion,
   pitfall, or template text. Since CP-53 a code fence left open anywhere in the file also blocks it,
   with an error naming the line and section. Not listed.

Done means those three passages state what the code does today, and nothing else in SKILL.md
changes.

## Ràng buộc

- Only these three passages change. Wording follows `skills/compass/references/writing-vi.md`
  and keeps "kiểm tra" / "case" in full (`test/wording.test.mjs` scans SKILL.md).
- Paragraph 1 keeps the honest boundary sentence ("Chặn được sai sót vô tình, không chặn được cố
  ý") and points to "Hai giới hạn còn lại" rather than repeating it.
- No new claim without a code reference checked in this task: each new sentence corresponds to
  `commands/done.mjs` (sourceHash), `lib/review-brief.mjs` (empty tree), or
  `lib/investigation-parser.mjs` (`unclosedFence`).

## Rủi ro hồi quy

- **`test/wording.test.mjs`** reads SKILL.md for clipped words, and **`test/writing-guide-faithful.test.mjs`**
  reads its "<n> cặp câu" sentence. Both must stay green.
- **Section headings other docs link to** (`docs/huong-dan.md` links into SKILL.md by file, README
  by file) — no heading is renamed.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read "Giới hạn còn lại của `done`" after the edit | It no longer says changed code still closes; it says `done` compares `sourceHash` and refuses changed code, that `done` does not re-run tests, and refers to "Hai giới hạn còn lại" for the restore-both case | P0 |
| H2 | Happy | Read the "Phạm vi soi" paragraph of the review section | It says a repo whose only commit is HEAD is diffed from git's empty tree, so the first commit is reviewed and scanned by `secrets` | P0 |
| H3 | Happy | Read the `--close` paragraph in "Điều tra" | It lists an unclosed code fence among the things that block a close | P0 |
| H4 | Happy | `git diff` of the commit, and `node --test test/wording.test.mjs test/writing-guide-faithful.test.mjs` | Only those three passages of skills/compass/SKILL.md change; both test files pass | P1 |
