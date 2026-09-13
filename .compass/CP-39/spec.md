# CP-39: Compass speaks in clipped words — "kiểm" and "ca" — where readers hear "kiểm tra" and "case"
Loại: feature-m
Phạm vi: SKILL.md, writing-vi.md, README.md, templates/investigation.md, .knowledge/decided/pitfalls.md, lib/spec-parser.mjs, lib/investigation-parser.mjs, lib/test-parser.mjs, lib/config.mjs, lib/review-brief.mjs, lib/query-outputs.mjs, commands/test.mjs, commands/done.mjs, commands/investigate.mjs, commands/check.mjs, commands/status.mjs, commands/convention.mjs, test/wording.test.mjs, test/spec-parser.test.mjs, test/investigation-parser.test.mjs, test/test-command.test.mjs, test/investigate-command.test.mjs
Gốc soi: a62c3f2

## Mục tiêu

Every Vietnamese text a reader sees — skill docs, the investigation template, CLI messages,
code comments, the pitfalls file — uses `kiểm tra` where it now says a bare `kiểm`, and
`case` where it now says `ca` for a test case. Counted on 2026-09-13 with a word-boundary
scan: 157 clipped `kiểm` and 95 standalone `ca` across 38 files outside `.compass/`.

Two of those words are keywords the parsers read, so wording alone is not enough:

- `Kiểm bằng:` in a spec (lib/spec-parser.mjs:98) gains the form `Kiểm tra bằng:`.
- `**Cách kiểm:**` in an investigation (lib/investigation-parser.mjs:109) gains the form
  `**Cách kiểm tra:**`.

Parsers accept both forms. Docs and the template show only the new form. The eight specs
and two investigations already on disk keep parsing exactly as today.

Done means: the wording guard test (H7–H9) passes on the in-scope files, the two keyword
aliases parse, and the full suite is green.

## Ràng buộc

- Backward compatible: `Kiểm bằng:` and `**Cách kiểm:**` keep working with identical
  results. No existing `.compass/*/spec.md` or `investigation.md` is edited.
- Complete words stay: `kiểm chứng`, `kiểm soát`, `kiểm định`, `kiểm duyệt`, `kiểm toán`,
  `kiểm kê` are not clipped and are left alone. `ca` inside another word (`cách`, `cả`,
  `các`) is untouched by construction of the word-boundary regex.
- writing-vi.md pairs stay faithful (CP-37): a substitution on one side of a ❌/✅ pair is
  applied to the other side too, and the pair count stays at its current value.
- Dated notes under `docs/superpowers/` are historical records and are not rewritten.
  Everything under `.compass/` is evidence and is not touched.
- The placeholder check `/chưa kiểm/i` for an investigation result must still catch
  `chưa kiểm tra`.
- Zero new dependencies. The wording guard is a plain `node --test` file using `fs` and a
  regex; it reads only the files it names.
- Out of repo scope: the copy at `~/.claude/skills/compass/` is a manual copy, not a
  symlink. The report after `done` must remind the user to recopy SKILL.md and
  writing-vi.md.

## Rủi ro hồi quy

- **Parsers.** A wrong alias regex could stop `Kiểm bằng: mắt` from setting `verifyBy`, and
  the eight visual-only specs on disk would start demanding a test suite. Same for
  `Cách kiểm:` in INV-1 and INV-2: `--close` would report missing methods on closed files.
- **Message assertions.** Tests in test/test-command.test.mjs, test/investigate-command.test.mjs,
  test/investigation-parser.test.mjs and test/test-parser.test.mjs match on the exact
  Vietnamese of gate output. Changing a message without its assertion breaks the suite;
  changing the assertion without the message hides the regression.
- **writing-vi.md faithfulness.** Editing one side of a pair changes what the pair teaches.
- **Over-replacement.** A regex that misses the exclusion list turns `kiểm chứng` into
  `kiểm tra chứng`. The guard test in EC2 pins the exclusion list.
- **Review scope.** CP-38 committed as `a62c3f2` while this spec was being written, so
  `Gốc soi:` moved there. CP-36 is now being implemented in a parallel session in the
  same working tree, uncommitted. Until it commits, a review diff from `a62c3f2` mixes
  its code into this brief, and both sessions edit lib/spec-parser.mjs and
  lib/review-brief.mjs. The wording guard (H7–H9) is the check that none of this
  task's edits were lost to a stale overwrite.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Spec with `Kiểm tra bằng: mắt` | `parseSpec().verifyBy === 'mắt'` | P0 |
| H2 | Happy | Spec with old `Kiểm bằng: mắt` | `verifyBy === 'mắt'`, unchanged | P0 |
| H3 | Happy | Investigation hypothesis with `**Cách kiểm tra:** run X` | `hypotheses[0].method === 'run X'` | P0 |
| H4 | Happy | Investigation hypothesis with old `**Cách kiểm:** run X` | `method === 'run X'`, unchanged | P0 |
| H5 | Happy | Hypothesis result `chưa kiểm tra` | errors include `chưa có kết quả kiểm tra` for that id | P0 |
| H6 | Happy | templates/investigation.md | contains `**Cách kiểm tra:**`, zero clipped `kiểm`, zero standalone `ca` | P0 |
| H7 | Happy | Wording guard on SKILL.md, writing-vi.md, README.md, .knowledge/decided/pitfalls.md | zero matches of clipped `kiểm` regex | P0 |
| H8 | Happy | Wording guard on the same four docs | zero matches of standalone `ca` regex | P0 |
| H9 | Happy | Wording guard on every `.mjs` under lib/ and commands/ | zero matches of either regex | P0 |
| H10 | Happy | `compass test` on a visual-only spec with 3 cases | pass line reads `3 case kiểm tra bằng mắt` | P1 |
| V1 | Validation | Spec with `Kiểm tra bằng: bói toán` | test gate exit 2, message quotes `"Kiểm tra bằng: bói toán"` and lists accepted values | P0 |
| V2 | Validation | Spec with `Kiểm tra bằng:` and empty value | `verifyBy === null`, same as empty `Kiểm bằng:` today | P1 |
| V3 | Validation | Hypothesis with neither method form | error text is `Giả thuyết H1 không nêu cách kiểm tra` | P0 |
| V4 | Validation | Visual-only spec with empty test table, new keyword | exit 2, message says every case and its check method must be listed | P1 |
| E1 | Error | Spec `Kiểm tra bằng: mắt` but suite has a test named with the task id | exit 2 (usage error, as the gate has returned since CP-20), message says the spec declares visual verification yet tests carry the id, and quotes the `Kiểm tra bằng:` line | P0 |
| E2 | Error | Old-form spec `Kiểm bằng: mắt` in the same situation | same exit code and same message shape as E1 | P1 |
| EC1 | Edge | Spec declaring both `Kiểm bằng: mắt` and `Kiểm tra bằng: mắt` | `verifyBy === 'mắt'`, no error, first line wins | P1 |
| EC2 | Edge | Guard regex on the string `kiểm chứng kiểm soát kiểm định kiểm duyệt kiểm toán kiểm kê kiểm tra` | zero matches | P0 |
| EC3 | Edge | Guard regex on `cách cả các ca, ca. ca` | exactly 3 matches, none inside `cách`/`cả`/`các` | P0 |
| EC4 | Edge | writing-vi.md ❌/✅ pair count | equals the count at `910670a` (measured in the test from git-free fixture: 53) | P1 |
| EC5 | Edge | The tracked `.compass/INV-1/investigation.md` and `INV-2/investigation.md` | parser reports zero `không nêu cách kiểm tra` errors | P0 |
| EC6 | Edge | Uppercase `KIỂM` in a heading like `## KIỂM TRA` | guard does not flag it (regex is case-sensitive on the clipped form only) | P2 |
| S1 | Security | `Kiểm tra bằng: mắt` placed after the first `##` heading | still parsed (parity with `Kiểm bằng:`, which is read anywhere); test documents this so nobody assumes header-only | P1 |
| S2 | Security | Wording guard given a path outside the listed set | it never reads it: the test asserts every doc path the guard reads is in the spec's `Phạm vi:`, every module path is directly under `lib/` or `commands/`, and no path starts with `.compass/` or `docs/superpowers/` | P1 |
| S3 | Security | A spec line `Kiểm tra bằng: mắt` followed by `Kiểm bằng: đọc` | second declaration ignored; gate does not silently switch verification method | P1 |
| P1 | Performance | Wording guard over all in-scope files | completes in under 500 ms on the local machine (bound, not yet measured) | P2 |
| P2 | Performance | `parseSpec` on a 2000-line spec containing the new keyword once | under 50 ms (bound, not yet measured) | P2 |
