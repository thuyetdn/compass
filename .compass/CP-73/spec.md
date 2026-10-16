# CP-73: GitHub Pages fails to build because Jekyll parses template braces in a plan document
Loại: fix
Phạm vi: docs/.nojekyll (mới), test/release-docs.test.mjs
Gốc soi: af93a81

## Mục tiêu

The first Pages build after CP-72 failed at "Build with Jekyll" (run 38844698787), so
https://thuyetdn.github.io/compass/ returns 404. GitHub runs Jekyll over all of `docs/` by default,
and `docs/superpowers/plans/2026-09-05-compass-phase-1.md` holds `{{taskId}}`, `{{type}}` and an
unclosed `'{{'` — Liquid syntax to Jekyll. The demo page is plain HTML and needs no Jekyll at all.

Done means `docs/.nojekyll` exists and the page sits where Pages looks for it. Whether the next
build succeeds is checked by hand after the push: the suite cannot call GitHub.

## Ràng buộc

- No change to the plan document: it is a historical record, and the braces are what the template
  really contained.
- No change to `docs/index.html`.

## Rủi ro hồi quy

- CP-17-H4 keeps `docs/` out of the npm package; a dotfile there must not change that.
- CP-58-H3 checks relative links; an empty file has none.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | docs/.nojekyll exists | file present | P0 |
| H2 | Happy | The page sits at the root of docs/ | docs/index.html exists, so Pages serves it at /compass/ | P0 |
