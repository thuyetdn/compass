# CP-54: The test gate quotes `Kiểm tra bằng:` to a spec that wrote `Kiểm bằng:`
Loại: bug
Phạm vi: lib/spec-parser.mjs, commands/test.mjs, test/test-command.test.mjs, test/spec-parser.test.mjs
Gốc soi: f94ebdd

## Mục tiêu

CP-39 added the full-word keyword `Kiểm tra bằng:` and kept the old `Kiểm bằng:` working. The
parser accepts both with one pattern, `^Kiểm(?: tra)? bằng:\s*(.+)$` (`lib/spec-parser.mjs:102`).
It keeps only the value, and its return object (`:161`) has no trace of which keyword matched. The
two messages in `commands/test.mjs` that quote the line therefore hard-code the new form: `:67`
(`"Kiểm tra bằng: ${spec.verifyBy}" không hợp lệ`) and `:93` (`Bỏ dòng "Kiểm tra bằng:" …`). A spec
that uses the old form is told to fix or remove a line it does not contain. The person searches the
spec for `Kiểm tra bằng`, finds nothing, and cannot tell which line the gate means.

Measured on HEAD (f94ebdd) with the real `testCommand`:

| Spec line | Situation | Exit | Gate quoted |
|---|---|---|---|
| `Kiểm bằng: bói toán` | unknown value | 2 | **`"Kiểm tra bằng: bói toán" không hợp lệ`** |
| `Kiểm tra bằng: bói toán` | unknown value | 2 | `"Kiểm tra bằng: bói toán" không hợp lệ` — correct |
| `Kiểm bằng: mắt` | suite has `T-1-H1` | 2 | **`Bỏ dòng "Kiểm tra bằng:"`** |
| `Kiểm tra bằng: mắt` | suite has `T-1-H1` | 2 | `Bỏ dòng "Kiểm tra bằng:"` — correct |
| `Kiểm bằng: mắt` | no owned tests | 0 | `2 case kiểm tra bằng mắt` — prose, not a quote; correct |

An existing test locks the bug in. `test/test-command.test.mjs:391-397` (CP-39-E2, "the old form
in the same situation gets the same exit code and message shape") builds its spec with
`Kiểm bằng: mắt` (`SPEC_MAT`, `:270`) and asserts `/Bỏ dòng "Kiểm tra bằng:"/` — the wrong quote.
That assertion changes in this task: it will assert `Bỏ dòng "Kiểm bằng:"`. The exit-code and
`Spec khai kiểm tra bằng mắt` assertions stay.

Done means: `parseSpec` returns `verifyByKeyword` — `'Kiểm bằng'` or `'Kiểm tra bằng'`, taken from
the same line that set `verifyBy`, or `null` when `verifyBy` is `null` — and both messages quote
that keyword. An old-form spec sees its own keyword, and a new-form spec sees exactly what it sees
today.

## Ràng buộc

- `parseSpec` changes by one added key. Every existing key keeps its value. That includes
  `verifyBy`, which stays trimmed and lowercased, and the first-occurrence rule, which stays: the
  first line with a non-empty value wins, and the keyword comes from that same line.
- Both spellings stay accepted. No deprecation warning is added for the old form — that would be a
  separate decision.
- Only the two quoting messages (`commands/test.mjs:67` and `:93`) change. The pass line
  `… case kiểm tra bằng ${verifyBy}` and the line `Spec khai kiểm tra bằng ${verifyBy}, …` are
  prose that describe the check rather than quote the line. They stay word-for-word, and
  CP-20-H1, CP-39-H10 and CP-39-E1 assert them.
- Exit codes stay: 2 for an unknown value, 2 for an empty table, 2 for the contradiction, 0 for a
  valid declaration.
- The `test` gate record in `gate.json` keeps its shape. `verifyBy` is still written and no
  keyword field is added: the keyword only shapes the message and is not evidence. `specHash`
  already covers the line.
- Out of scope, stated so the reviewer does not read it as an oversight: the quoted value is still
  the lowercased `verifyBy`. `Kiểm bằng: Bói Toán` will be quoted as `"Kiểm bằng: bói toán"`. Fixing
  that needs the raw value as another parser field, and it changes a message nobody has reported.
  This task fixes the keyword the issue names.
- No new dependency. SKILL.md is not edited — it documents the new form only, which stays correct.

## Rủi ro hồi quy

- **New-form specs could start getting the old keyword.** Capturing the group wrongly would flip
  the bug around. H2 (`CP-39-V1` shape) and H4 (`CP-39-E1` shape) assert the new form is still
  quoted as `Kiểm tra bằng`. CP-39-V1 and CP-39-E1 stay unedited and green.
- **CP-39-E2 is edited, not deleted.** Its old assertion encodes the bug, so it must flip to
  `Bỏ dòng "Kiểm bằng:"`. H3 is that edited test. Deleting it instead would drop the only test of
  the old form in the contradiction path.
- **The first-occurrence rule.** The keyword and value could come from different lines, for
  example the keyword from an earlier line whose value was empty. EC1 pins both orders of two
  filled lines, and EC2 pins an empty old-form line followed by a filled new-form line.
- **The prose lines.** Search-and-replace on `Kiểm tra bằng` in `commands/test.mjs` would also hit
  the pass line and the `Spec khai kiểm tra bằng` line. E1 asserts the pass line for an old-form
  spec still reads `kiểm tra bằng mắt`. CP-20-H1 and CP-39-H10 must stay green.
- **Other `parseSpec` callers** (`check`, `done`, `status`, `review`, `secrets`,
  `spec-validator`) read named keys only, and none enumerate the result. V1 asserts the added key
  and the unchanged `verifyBy`. `test/spec-parser.test.mjs` (CP-39-H1 to CP-39-H7, V2) must stay
  green.
- **The gate record.** CP-20-H2 asserts `gate.verifyBy === 'mắt'`. E1 also asserts the record has
  no `verifyByKeyword` key.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Spec with `Kiểm bằng: bói toán`, run `testCommand` | exit 2; output contains `"Kiểm bằng: bói toán" không hợp lệ`; output does not contain `Kiểm tra bằng` | P0 |
| H2 | Happy | Spec with `Kiểm tra bằng: bói toán` | exit 2; output contains `"Kiểm tra bằng: bói toán" không hợp lệ` | P0 |
| H3 | Happy | `Kiểm bằng: mắt` while the suite prints `ok 1 - T-1-H1 …` (CP-39-E2, edited) | exit 2; output contains `Spec khai kiểm tra bằng mắt` and `Bỏ dòng "Kiểm bằng:"`; output does not contain `Bỏ dòng "Kiểm tra bằng:"` | P0 |
| H4 | Happy | `Kiểm tra bằng: mắt` with the same owning suite | exit 2; output contains `Bỏ dòng "Kiểm tra bằng:"` | P0 |
| V1 | Validation | `parseSpec` on a spec with `Kiểm bằng: Mắt`, one with `Kiểm tra bằng: mắt`, and one with neither line | `verifyByKeyword` is `'Kiểm bằng'`, `'Kiểm tra bằng'`, `null` respectively; `verifyBy` is `'mắt'`, `'mắt'`, `null` | P0 |
| V2 | Validation | `parseSpec` on a spec whose only such line is `Kiểm bằng:` with nothing after it | `verifyBy === null` and `verifyByKeyword === null` | P1 |
| E1 | Error | `Kiểm bằng: mắt` with no test carrying the task id | exit 0; output contains `2 case kiểm tra bằng mắt`; `gate.json` test record has `verifyBy === 'mắt'` and no `verifyByKeyword` key | P1 |
| E2 | Error | `Kiểm bằng: bói toán` — the list of valid values still prints | output contains `Giá trị nhận: mắt, người, eye, manual.`; no `gate.json` test record is written | P1 |
| EC1 | Edge | `parseSpec` with `Kiểm tra bằng: mắt` then `Kiểm bằng: đọc`, and with the two lines reversed | first: `verifyBy 'mắt'`, `verifyByKeyword 'Kiểm tra bằng'`; reversed: `'đọc'`, `'Kiểm bằng'` | P0 |
| EC2 | Edge | Spec with an empty `Kiểm bằng:` line followed by `Kiểm tra bằng: bói toán`, run `testCommand` | exit 2; output contains `"Kiểm tra bằng: bói toán" không hợp lệ` | P1 |
| EC3 | Edge | Spec saved with CRLF line endings holding `Kiểm bằng: bói toán` | exit 2; output contains `"Kiểm bằng: bói toán" không hợp lệ` with no `\r` in the quote | P2 |
