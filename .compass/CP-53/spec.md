# CP-53: A `## ` line inside a code fence cuts an investigation section short, and `--close` files the stump as the pitfall
Loại: bug
Phạm vi: lib/markdown-fence.mjs (mới), lib/investigation-parser.mjs, lib/pitfall-file.mjs, test/investigation-parser.test.mjs, test/investigate-command.test.mjs
Gốc soi: f94ebdd

## Mục tiêu

`lib/investigation-parser.mjs` ends a section at the first line matching `/^## /`. `sectionBody`
does it at `:83`, `parseHypotheses` at `:111`, and the section *start* is found by an exact
`## <heading>` match at `:78`. None of the three knows about fenced code, so a `## ` line inside a
` ``` ` or `~~~` block is read as a heading.

Measured on HEAD (f94ebdd) with a filled investigation whose Pitfall reads "Đừng tin heading.", then
a fenced block holding `## Đây là ví dụ, không phải mục`, then "Bài học: dòng ## trong code block
không phải ranh giới.":

| Case | Parsed on HEAD | `validateForClose` |
|---|---|---|
| Pitfall with a ` ```md ` fence | `pitfall = "Đừng tin heading.\n\n```md"` | ok |
| Same with a `~~~` fence | `pitfall = "Đừng tin heading.\n\n~~~"` | ok |
| Same, file in CRLF | `pitfall = "A.\n\n~~~"` | ok |
| A hypothesis with a fenced `## log line` between `**Cách kiểm:**` and `**Kết quả:** đúng — 3 dòng` | `result = ""` | refuses: "Giả thuyết H1 chưa có kết quả kiểm tra" |
| Bằng chứng quotes a fenced sample that contains `## Pitfall` | `evidence = "Mẫu đã dán:\n\n```"`; `pitfall` = the text of the *sample* (`"chữ mẫu trong ví dụ\n```"`); the real Pitfall section is never read | ok |
| Pitfall whose fence is never closed | pitfall keeps the open fence | ok |

`investigate INV-1 --close` on the first case exits 0 and writes the stump into
`.knowledge/decided/pitfalls.md`: the entry ends at a bare ` ```md `, the lesson is gone, and the open
fence turns everything below it in the file into code when rendered.

The parser cannot be fixed alone. `lib/pitfall-file.mjs` deliberately mirrors the same split
(`HEADING = /^## (.*)$/`, comment at `:23-26`): `replaceEntry` takes an entry to end at the next
`## ` line. Feeding it the full body measures what a fence-aware parser alone would do — three
re-closes of the same entry with a `## Mục sau` after it:

| After | "Bài học:" occurrences | `## ` lines in file | Bytes |
|---|---|---|---|
| re-close 1 | 2 | 4 | 396 |
| re-close 2 | 3 | 5 | 510 |
| re-close 3 | 4 | 6 | 624 |

The tail from the fenced `## ` line onward is left behind and duplicated on every close. That
file's header records why it stopped reading fences: three attempts failed — a per-line flag stuck
open on a stray marker, pairing markers in order matched two odd markers in different entries and
deleted everything between them, and the recogniser knew ` ``` ` but not `~~~`. CP-35-S5, S7 and
EC11 pin those failures.

Done means:

1. **One fence recogniser, shared.** A new `lib/markdown-fence.mjs` decides, per line, whether it
   is inside a fence (marker lines included). Rules follow CommonMark: an opener is up to three
   spaces, then three or more `` ` `` (with no `` ` `` in the info string after it) or three or more
   `~`. A closer is up to three spaces, then the *same* character repeated at least as many times
   as the opener, then only whitespace. The parser and `pitfall-file.mjs` both import it, so the
   two cannot drift apart again.
2. **Parser: inside a fence, no line is structure** — not `## `, not `### Hn:`, not
   `**Cách kiểm tra:**` or `**Kết quả:**`, and not the line that starts a section.
3. **Parser: a fence still open at the end of the document refuses the close.** The parser then
   cannot know which `## ` lines are headings, so it reads the document the way HEAD does,
   `parseInvestigation` reports the line and the section where the fence opened, and
   `validateForClose` adds an error naming both. Nothing is written to `pitfalls.md`. A Compass
   close therefore never files an entry with an open fence.
4. **`pitfall-file.mjs` finds an entry's end with the same recogniser, and keeps a witness rule
   as its safety rail.** `timMuc` computes two ends: the end HEAD uses (next `## ` line), and the
   fence-aware end (next `## ` line outside a fence, with fence state starting fresh at the entry's
   own heading). It takes the fence-aware end only when both of these hold, and HEAD's end
   otherwise:
   - every fence opened after the entry's heading is closed before that end;
   - every `## ` line it skipped is a line *inside a fence of the body being written*, as the
     recogniser reads that body.

   The witness is the new body, which Compass holds, not a guess about what the author meant. A
   real neighbour heading (`## Mục Y`) is not a fenced line of the new body, so a stray marker can
   never make `replaceEntry` swallow it. The worst case stays where CP-35 put it: a visible
   duplicated tail, never a deleted neighbour.

## Ràng buộc

- `replaceEntry(existing, title, body)` and `appendBlock(existing, title, body)` keep their
  signatures and their per-line EOL preservation: lines outside the replaced entry stay
  byte-identical, CRLF included (CP-35-EC9, EC12).
- `parseInvestigation` keeps every field it returns today with the same meaning. It may add one
  field reporting an unclosed fence. `validateForClose` keeps `{ ok, errors }`.
- How `timMuc` finds an entry's *start* is unchanged: an exact title match on a `## ` line, not
  fence-aware. Tracking fences from the top of the file is exactly the global state that failed
  before. A fenced line that exactly equals another investigation's title is a residual risk this
  task accepts.
- The header comment of `lib/pitfall-file.mjs` must be rewritten to describe the witness rule and
  why it avoids each of the three recorded failures. A comment saying "this file does not read
  fences" next to code that does would be the kind of wrong documentation SKILL.md warns about.
- No new dependency.

## Rủi ro hồi quy

- **Silent loss of neighbouring entries** — the reason fence reading was removed. CP-35-S5 (an
  unterminated fence in the entry) and CP-35-S7 (two odd fences in different entries) must stay
  green unchanged. S1 adds the case the witness rule creates: the new body *does* contain a fenced
  `## ` line, and the old entry's odd fence is closed only inside a neighbour.
- **CP-35-S3 and CP-35-EC11** hand-edit a fenced `## ` line into an *existing* entry while the
  investigation body has no fence. The witness rule sends those to HEAD's end, so both keep their
  current outcome and must stay green.
- **Entries written by HEAD** end in an open fence (the stump in the table above). Re-closing such
  an investigation with the fixed parser must repair the entry, not eat what follows. EC1 measures
  this with a later entry that holds a balanced fence the stray opener could pair with.
- **Investigations that close today could be refused.** An unclosed fence anywhere in the document
  now blocks `--close`. That is intended, and E1/E2 pin both the refusal and that the message names
  the section. The other errors stay those HEAD reports: E2 asserts no spurious "Việc cần làm tiếp
  còn trống".
- **Placeholder and hypothesis checks.** The template ships no fences, so every existing parser and
  close test (`test/investigation-parser.test.mjs`, CP-11 and CP-35 in
  `test/investigate-command.test.mjs`) must stay green. H4 and EC5 pin that fenced lines no longer
  create or end hypotheses.
- **Repeated closing must stay stable** (CP-35-EC12: blank lines neither grow nor shrink). H3 and
  EC4 extend that to entries holding fences, byte for byte.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Parse an investigation whose Pitfall holds a ` ```md ` block containing `## Đây là ví dụ, không phải mục`, then the "Bài học:" paragraph | `pitfall` equals the full section text from "Đừng tin heading." through "…không phải ranh giới.", fence markers included; `validateForClose(...).ok === true` | P0 |
| H2 | Happy | Same as H1 with `~~~` markers | `pitfall` ends with "…không phải ranh giới." and contains both `~~~` lines | P0 |
| H3 | Happy | `investigate --close` the H1 investigation; append a `## Mục sau` entry to pitfalls.md and record its bytes; `--close` again | the file after the second close is byte-identical to the recorded bytes (HEAD already achieves this for a fence-free pitfall, measured); exactly one line equals `## INV-1: <title>`; "Bài học:" occurs once; `## Mục sau` and its body are intact | P0 |
| H4 | Happy | A hypothesis with a fenced `## log line` between `**Cách kiểm:**` and `**Kết quả:** đúng — 3 dòng` | `hypotheses[0].result === 'đúng — 3 dòng'`; errors do not include "Giả thuyết H1 chưa có kết quả kiểm tra" | P0 |
| V1 | Validation | Bằng chứng quotes a fenced sample containing `## Pitfall`; the real Pitfall section reads `**Phòng tránh:** Z.` | `evidence` contains the whole fenced sample; `pitfall === '**Phòng tránh:** Z.'` | P0 |
| V2 | Validation | Fence rules, one `## X` line after each marker: (a) ` ``` ` opened, `~~~` inside; (b) four backticks opened, three inside; (c) ` ``` ` opened, ` ```js ` inside; (d) a marker indented four spaces | (a), (b) and (c): the `## X` line is still inside the fence, so it is not a section; (d): the marker is not a fence, so the `## X` line ends the section | P1 |
| E1 | Error | Pitfall holds a ` ```sh ` that is never closed | `--close` exits 1; the error names "Pitfall" and the opening line number; pitfalls.md does not exist afterwards (or is byte-identical if it existed); no `investigate` gate record is written | P0 |
| E2 | Error | Bằng chứng holds an unclosed ` ``` `; every other section is filled | `--close` exits 1; errors include the unclosed-fence error naming "Bằng chứng"; errors do not include "Việc cần làm tiếp" | P0 |
| EC1 | Edge | pitfalls.md holds an INV-1 entry as HEAD wrote it (ending in an open ` ```md `), then `## Mục Y`, then `## Mục Z` containing a balanced ` ``` ` block; re-close the H1 investigation | the INV-1 entry now holds the full body; `## Mục Y` and `## Mục Z` with their bodies are byte-identical to before; exactly one INV-1 heading | P0 |
| EC2 | Edge | After the first close of H3, the author changes the text of the fenced `## ` line in the investigation, then closes again | `## Mục sau` and its body are intact; the new fenced line is in the file. The old entry's end falls back to HEAD's end, so a duplicated tail is allowed; a deleted neighbour is not | P1 |
| EC3 | Edge | H3 with both the investigation and pitfalls.md in CRLF | second close byte-identical to the first; the number of LF not preceded by CR is 0 | P1 |
| EC4 | Edge | H3 with the INV-1 entry as the last entry in the file (nothing after it) | second close byte-identical to the first | P1 |
| EC5 | Edge | A ` ``` ` block in Giả thuyết containing `### H9: giả`, after the real `### H1:` | `hypotheses.length === 1` and `hypotheses[0].id === 'H1'` | P1 |
| S1 | Security | pitfalls.md: the INV-1 entry has an odd ` ``` ` that pairs with an odd ` ``` ` inside the following `## Mục Y`; the H1 investigation (whose body has its own fenced `## ` line) is closed | `## Mục Y` and its body are byte-identical to before; `## Mục W` after it is intact; the witness rule refuses to treat `## Mục Y` as hidden | P0 |
