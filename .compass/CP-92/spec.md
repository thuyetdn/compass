# CP-92: two SKILL.md tests read the file with CRLF line endings
Loại: fix
Gốc soi: e6ee11e
Phạm vi: test/codex-template.test.mjs, test/internal-names.test.mjs

## Mục tiêu

CP-75-H3 and CP-74-H3 fail on HEAD (e6ee11e) in a checkout with `core.autocrlf=true`: the working
copy of `skills/compass/SKILL.md` has CRLF line endings, and both tests match it with regexes that
expect `\n` (`## Luật tối cao\n`, the ```` ```sql\n ```` fence). Found while running CP-91; the suite
is 1716/1718 with only these two red.

Done means both tests pass whatever line endings the checkout produced, and the suite is green on
this machine.

## Ràng buộc

- Test-only change. No file outside `test/` changes; SKILL.md is not renormalised.
- The tests keep checking the same content: five rules in "Luật tối cao", two queries in the SQL
  example.

## Rủi ro hồi quy

- Other tests in `codex-template.test.mjs` read files through the same `read`/`template` helpers;
  normalising there must not change what they assert (CP-75-H1, H2, H4, H5 must hold).

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | SKILL.md text forced to CRLF, passed through the reader `codex-template.test.mjs` uses | "Luật tối cao" section found, 5 rules | P0 |
| H2 | Happy | Same CRLF text, passed through the reader CP-74-H3 uses | ```` ```sql ```` block found, 2 queries parsed with no errors | P0 |
