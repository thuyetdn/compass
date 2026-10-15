# CP-57: The writing guide claims 53 pairs and two of its pairs add facts the original never had
Loại: fix
Phạm vi: skills/compass/SKILL.md, skills/compass/references/writing-vi.md, test/writing-guide-faithful.test.mjs (mới)
Gốc soi: f94ebdd

## Mục tiêu

Two defects found by the CP-37 review that are still true on HEAD f94ebdd, both introduced by
f6ba84d after CP-37 closed.

`SKILL.md:66` tells the reader the guide holds "53 cặp câu". Counted on HEAD, `writing-vi.md` has
56 lines starting with `> ❌`. f6ba84d added three pairs and relaxed `test/wording.test.mjs:79` to a
floor of `>= 53`, so nothing noticed that the claim went stale. A reader who is told "53" and finds
56 stops trusting the other numbers in the same file.

In the section "Xếp lại thứ tự, đừng chỉ cắt", both pairs break the rule the guide itself calls the
worst mistake — rewriting while **adding facts**:

| Pair | ❌ says | ✅ adds |
|---|---|---|
| 1 | "khách sẽ nhận mail" | "4 khách", "báo đổi giờ", "Vá được", "không có cách nào gửi thầm" |
| 2 | script không dùng được; 160 event / 331 blocker id; 0/9; lệch 21–77 ngày | "4 cuộc hẹn", names Hari, Angenietje, Adama, Kaya, "25/11", "16/09", "phải dựng cái mới" |

A reader copying pair 2 learns that a good rewrite may introduce numbers and names that appear
nowhere in the draft.

Done means: SKILL.md states the real count; each pair in that section carries the same facts on
both sides, so ✅ only reorders and cuts; and a test fails the next time either drifts.

## Ràng buộc

- No pair is dropped. The `CP-39-EC4` floor in `test/wording.test.mjs` stays and must stay green.
- The lesson of each pair is kept: pair 1 still teaches "conclusion first", pair 2 still teaches
  "split independent points into lines". Only the facts are aligned.
- The fix may add facts to the ❌ side (it is a fabricated draft) rather than strip them from ✅,
  as long as both sides end up holding the same facts.
- `SKILL.md` section "Khuôn trả lời" (table as the default reply shape) is out of scope. The CP-37
  review flagged it as contradicting "mặc định là văn xuôi", but it was a deliberate owner change
  (ccb76e2) and is left for the owner to decide.

## Rủi ro hồi quy

- **`test/wording.test.mjs`** reads both files: the clipped-word checks (`kiểm`, `ca`) and the ❌
  floor. A rewrite that reintroduces a clipped word turns it red. It must stay green.
- **The ❌/✅ marker format.** Other tests and readers rely on `> ❌` starting a line. The rewrite
  keeps that exact prefix.
- **Pair count.** Merging or splitting a pair while rewriting would change the count H1 measures.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | The number in SKILL.md's "<n> cặp câu" sentence vs the count of lines starting with `> ❌` in writing-vi.md | the two numbers are equal (56 on this task) | P0 |
| H2 | Happy | In section "Xếp lại thứ tự, đừng chỉ cắt", every digit run on a pair's ✅ lines (so `0/9` yields `0` and `9`, `25/11` yields `25` and `11`) also appears on that pair's ❌ lines | no digit run exists only on the ✅ side, for both pairs | P0 |
| H3 | Happy | Same section: every capitalised word on a ✅ line that is not the first word of a sentence, bullet or bold run (i.e. a proper name such as `Hari`) also appears on that pair's ❌ lines | no proper name exists only on the ✅ side, for both pairs | P0 |
