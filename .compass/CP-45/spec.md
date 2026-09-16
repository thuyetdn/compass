# CP-45: An indented list line makes `investigate --close` hang for minutes
Loại: bug
Phạm vi: lib/investigation-parser.mjs, test/investigation-parser.test.mjs
Gốc soi: 55f2303

## Mục tiêu

`DAU_DONG` is `(?:[>\s]*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?)+` — a `(X)+` whose every
branch can match the empty string. The leading `[>\s]*` and the trailing `\s*` both consume
spaces, so a run of indentation can be split between them in exponentially many ways. When the
rest of the pattern then fails, the engine tries every split before giving up.

`parseHypotheses` matches on the untrimmed line, so indentation reaches the ambiguity directly.
Measured on HEAD (55f2303), on a line that does not match:

| Indent | Time |
|---|---|
| 8 spaces | 5 ms |
| 12 spaces | 94 ms |
| 14 spaces | 1112 ms |

Each two spaces multiplies by roughly twelve. Sixteen — a list nested four deep at the 4-space
default of most editors — is minutes. Nobody has to be attacking: an ordinary investigation file
with nested bullets is enough, and `investigate --close` stops responding with no output.

Done means: the same lines match, capturing the same text, and time stays flat as indentation
grows. The prefix is a fixed sequence of optional layers — quote, then bullet or number, then
checkbox — so each layer can match at most once and no layer can match empty.

Replacement, verified against HEAD on the 14 lines in H1: `(?:[>\s]+)?(?:(?:[-*+]|\d+[.)])\s*)?(?:\[[ xX]\]\s*)?`

## Ràng buộc

- No new dependency and no parser: this is one constant, and the four call sites that build a
  `RegExp` from it (`PLACEHOLDER`, and lines 109/114/171) keep their current shape.
- The 14 lines measured on HEAD keep matching exactly as they do — including `abc **Kết quả:**`,
  which does not match and must keep not matching. Anchoring the prefix is what makes a bare
  `abc` prefix fail; a fix that merely trims the line first would start accepting it.
- No behaviour change to `isEmpty`, `HINTS`, `loadTemplateHints`, `sectionBody` or
  `validateForClose`. This task replaces one regular expression.
- Ordering inside the prefix stays as it is: a quote marker precedes a bullet, which precedes a
  checkbox. `- > x` was not accepted on HEAD and stays unaccepted.

## Rủi ro hồi quy

- **A template hint stops being recognised.** `PLACEHOLDER` is built from this constant, and
  V6/V8/V12/V13 exist because unrecognised hints get copied into the knowledge base as findings.
  V1 re-measures a placeholder behind each prefix shape.
- **A real answer starts reading as a hint.** `**Vùng ảnh hưởng:** <SaveButton />` is real content
  that looks like a placeholder; EC4 pins it, as CP-11 did.
- **The `Cách kiểm`/`Kết quả` pair stops parsing**, which would make `--close` reject a complete
  file. H1 covers both keywords behind all 13 accepted prefixes.
- **Deep indentation now parses but slowly**, i.e. a partial fix. P1 asserts a wall-clock ceiling
  at an indent that takes minutes today — the one measurement where an absolute threshold is the
  point rather than a proxy.
- **`sectionBody` and the close flow are untouched** but share the module; the existing suite for
  `investigate` must stay green.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `**Kết quả:** x` behind each of the 13 prefixes accepted on HEAD (bare, `-`, `*`, `+`, two-space indent, `1.`, `2)`, `>`, `> -`, `- [ ]`, `- [x]`, three-space indent, `>  1.  [ ]`) | all 13 match and capture `"x"` | P0 |
| H2 | Happy | `**Cách kiểm:** y` and `**Cách kiểm tra:** y` behind `- ` and behind `>  1.  [ ]` | all four match, capture `"y"` | P0 |
| H3 | Happy | A full investigation file with 3-deep nested bullets parses | hypotheses, method and result read exactly as on HEAD | P0 |
| V1 | Validation | A template placeholder (`<ngày>`) behind bare, `- `, `1. `, `> `, `- [ ] ` | every one is still recognised as a placeholder | P0 |
| V2 | Validation | `abc **Kết quả:** x` — text before the prefix | does not match, as on HEAD | P0 |
| V3 | Validation | `- > **Kết quả:** x` — checkbox order reversed | does not match, as on HEAD | P1 |
| E1 | Error | A line of 200 spaces and nothing else, run through `parseInvestigation` | returns within 200 ms, does not throw | P0 |
| E2 | Error | A line that is only prefix characters (`>  - [ ]  `) with no keyword | does not match; no exception | P1 |
| EC1 | Edge | `**Kết quả:**` with an empty value | matches, captures `""` — unchanged from HEAD | P1 |
| EC2 | Edge | Indent of 16 spaces before `**Kết quả:** x` | matches and captures `"x"` | P0 |
| EC3 | Edge | `	- **Kết quả:** x` — a tab as indentation | matches, as on HEAD | P1 |
| EC4 | Edge | `**Vùng ảnh hưởng:** <SaveButton />` — real content shaped like a hint | not treated as a placeholder | P0 |
| S1 | Security | 40 spaces before a line that does not match, measured directly against the constant | under 50 ms — the shape that costs minutes today | P0 |
| P1 | Performance | `parseInvestigation` on a file whose hypothesis lines carry 16-space indents | completes in under 500 ms | P0 |
