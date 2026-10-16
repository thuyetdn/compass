# CP-74: The public repo names the owner's employer's internal repos and database tables
Loại: bug
Phạm vi: skills/compass/SKILL.md, skills/compass/references/writing-vi.md, lib/gate-store.mjs, lib/gates.mjs, lib/repo-detect.mjs, test/, .compass/, docs/superpowers/, .mailmap
Gốc soi: 4b078dd

## Mục tiêu

Measured on 4b078dd, after the repo went public: 25 tracked files use names from the owner's
employer as examples — six internal repo names, two database tables with their columns and the join
between them, a dev port, and `.mailmap` (added in 63dc92e) spelling out a work address. No
credentials, hosts or customer data were found. The owner judged it not highly sensitive and asked
for the names to be replaced, not for history to be rewritten.

Done means no tracked file at HEAD contains any of those names, every example still teaches what it
taught with neutral names, and a test stops them coming back — without the test itself spelling
them out, since it is public too.

## Ràng buộc

- One consistent mapping, applied in a single pass, so an example that names a repo in a table and
  again in the prose still agrees with itself. Replacements: shop-api, shop-web, Shop, store,
  web-app, admin-tool, orders, customers, CustomerDto, CustomerId, SQL aliases `o` and `c`, port 3100.
  The mapping table stays out of the repo; the guard test holds SHA-256 digests of the old names.
- History is not rewritten; the names remain reachable in old commits. That is the owner's call.
- `writing-vi.md` keeps its 56 ❌ → ✅ pairs, and every number in a rewrite still appears in its
  draft (CP-57).

## Rủi ro hồi quy

- Tests use a two-level parent/backend and parent/frontend layout as fixture paths for nested repos (CP-56, CP-60,
  CP-66); the rename must keep the two-level shape they exercise.
- The SQL examples feed the `@out:` parser tests (CP-32); changing aliases must not move a statement
  across a line the tests count.
- Closed specs under `.compass/` change text, so their local gate records stop matching specHash.
  Evidence is not committed, so a fresh clone is unaffected.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Grep every tracked file for the old names | no match | P0 |
| H2 | Happy | The investigation scripts whose SQL was renamed | each still runs and exits 0 | P0 |
| H3 | Happy | SKILL.md SQL example | still declares @out: for each query, now on orders/customers | P0 |
| V1 | Validation | .mailmap | removed from the repo | P0 |
| V2 | Validation | writing-vi.md pair count | still 56 | P0 |
| E1 | Error | A name reintroduced later | the guard test names the file and the term | P0 |
| EC1 | Edge | Nested-repo fixtures | still two levels deep, now store/backend and store/frontend | P0 |
