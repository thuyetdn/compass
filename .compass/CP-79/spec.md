# CP-79: Five faults the third review of CP-78 left open
Loại: bug
Phạm vi: commands/review.mjs, lib/review-context.mjs, lib/review-brief.mjs, lib/repo-detect.mjs, lib/knowledge-scan.mjs, skills/compass/SKILL.md, test/review-context.test.mjs, test/review-coverage.test.mjs, test/review-hardening.test.mjs (mới), README.md, docs/index.html
Gốc soi: e481b51

## Mục tiêu

The third blind review of CP-78 passed the gate with five Minors. Each was reproduced by the reviewer;
all five sit in code or text this session wrote.

1. **A context-only verdict built on an overwritten record.** Both phases decide "only the context
   changed" by comparing the current spec and diff hashes with the review record. The
   `findings-malformed` branch rewrites that record with the current diff hash. So: brief issued,
   code edited, a malformed findings.json filed — the next run, with findings fixed, says spec and
   code did not change. The gate still reopens; only the reason is wrong (CP-38's lesson again).
2. **A changed code file that cannot be read vanishes.** A changed `.js`/`.ts` file over 1 MB,
   binary, or a symlink returns null from the reader and the impact loop skips it; with no other
   code the section says "Không có file code nào để dò".
3. **Exports read from comments.** `exportedNames` runs over raw text, so a comment that quotes an
   export line creates a name. In CP-78's own brief a comment produced `a`, `b`, `d`, and `a` took one
   of the 20 slots with "(và 2652 nơi khác)".
4. **Every file stays in memory.** The reader caches each file it reads for the whole run. Measured by
   the reviewer on a 95 MB temporary repo: 1.25 s, 251 MB heap.
5. **A false example in SKILL.md.** It says editing `conventions.md` after review makes the gate
   report a context change. That only holds when `Soi đến:` pins the diff; otherwise the edit is part
   of the diff and the gate rightly reports a code change.

Done means each fault is gone. Faults 1, 2, 3 and 5 each have a test that fails on the code at e481b51.
Fault 4 is a memory property, and no test in the suite can measure heap without being flaky. EC1 and
EC2 only prove that the one-pass rewrite gives the same output; they pass on e481b51 too. The memory
drop was measured by hand (158 MB to 91 MB peak heap on a 92 MB repo).

The blind review of this task found seven Minors, fixed here as well. The comment stripper did not
know regex literals, so `/\/*$/` swallowed every export after it. The unreadable-file line always gave
the same reason. H2 passed on CRLF checkouts. No test reached the call-site cap. SKILL.md left out
that a Compass upgrade also changes only the context. `sameSubject` sat inside the import block.

## Ràng buộc

- Fault 1 is fixed by deciding from the brief itself, not from the record: the old brief embeds the
  spec and the diff it was written for, so "only the context changed" means both embedded copies equal
  the current ones. No record field can be overwritten out from under that.
- Fault 3 reuses the comment stripper already in `lib/repo-detect.mjs` (it keeps strings intact, so a
  `//` inside a URL is not a comment) instead of writing a second one. The stripper learns regex
  literals through `startsRegex` from `lib/knowledge-scan.mjs`, so the two strippers share one rule
  for regex versus division.
- Fault 4: nothing is cached; call sites for all traced names are found in one pass, which reads each
  tracked code file once. The few files other sections need (changed files, their siblings, two
  convention samples) may be read a second time; that costs far less than holding the whole repo. The brief text must stay byte-identical for the same tree.
- No change to what the gate decides — pass, fail, reopen — only to what it says and what it reads.

## Rủi ro hồi quy

- CP-78-E3 checks the context-only message in both phases; the new detection must keep it.
- CP-38 tests check the "findings answer another brief" message, which sits next to the changed branch.
- CP-78-H3 and P2 check caller lists and the export cap; the single-pass rewrite must give the same
  lists in the same order.
- CP-66 tests use `lib/repo-detect.mjs`; exporting its stripper and teaching it regex literals must
  not change how it reads framework config files.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | A changed file whose comment quotes `export const fake` and `module.exports = { ghost }` | neither name appears in impact or reuse; real exports still do | P0 |
| H2 | Happy | SKILL.md text about a context-only reopen | states that it needs `Soi đến:`, and that otherwise the edit counts as a code change | P1 |
| V1 | Validation | A changed `.js` file over 1 MB | impact names it as unreadable instead of skipping it | P0 |
| V2 | Validation | A changed `.js` file holding a NUL byte | impact names it as unreadable | P1 |
| V3 | Validation | A changed `.js` file missing from the working tree | impact says it is not in the working tree, not that it is over 1 MB | P1 |
| E1 | Error | Brief issued, code edited, malformed findings filed, then valid findings | phase two says code or spec changed, not context | P0 |
| E2 | Error | Same, then findings removed so phase one runs | phase one says code or spec changed, not context | P0 |
| EC1 | Edge | 20 traced names called across many files | every caller list equals the one a per-name scan gives, in the same order | P0 |
| EC2 | Edge | Context built twice over the same tree after the rewrite | byte-identical | P1 |
| EC3 | Edge | A traced name called on more lines than the cap of 8 | the first 8 call sites, then the exact count of the rest | P1 |
| EC4 | Edge | Regex literals holding `/*` and a quote after `(`, `=>` and `return`, and a division by `obj.in`, before real exports | every real export is still found | P0 |
| EC5 | Edge | A JSX file whose text holds an apostrophe, then a string holding `/*`, before real exports | every real export is still found | P1 |
| P1 | Performance | Stripping comments from 1 MB of code full of `/` | under 1.5 s, output unchanged | P1 |
