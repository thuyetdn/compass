# CP-72: The demo page lives where nobody outside the org can open it
Loại: fix
Phạm vi: docs/index.html (mới), README.md, test/release-docs.test.mjs
Gốc soi: 63dc92e

## Mục tiêu

The demo page built this session is published as a Claude artifact, which only people inside the
owner's organisation can open. The repo goes public, so the one page that shows what Compass does
is the one thing a visitor cannot see.

GitHub Pages serves it from the repo itself: same place as the code, no account needed to read it,
and a link that keeps working as long as the repo does. Done means `docs/index.html` holds the
page, the README links to it, and a test keeps the page honest — self-contained, offline, no
reference to anything that is not in the repo.

## Ràng buộc

- One file, no build step: GitHub Pages serves `docs/` as static files.
- Offline-safe except fonts: everything the page needs is inline. Google Fonts is the single
  outside reference, and every face declares a real fallback stack so the page reads without it.
- The content stays what it is — a real task's output, taken from `docs/demo/transcript.json`. No
  numbers invented for the page.
- No tracking, no analytics, no form. This is a page about verifiable evidence; a hidden beacon on
  it would be the wrong joke.
- Works at phone width and in both colour schemes, as the page already does.

## Rủi ro hồi quy

- CP-58-H3 asserts every relative link in the README resolves to a file in the repo. A link to a
  Pages URL is absolute, so it must not be caught by that check, and the file it describes must
  exist.
- `package.json` `files` controls what npm ships. `docs/` is already excluded by CP-17-H4, and a
  page added there must not change that.
- The knowledge gate hashes source files. An HTML file under `docs/` must not make the manifest
  stale on every unrelated run.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | docs/index.html exists and is non-trivial | file present, over 4 KB | P0 |
| H2 | Happy | The page is one self-contained document | no `<script src>`, no stylesheet link except fonts.googleapis.com | P0 |
| H3 | Happy | README links to the Pages URL | an https link to the published page appears in README | P0 |
| H4 | Happy | Every figure on the page matches the transcript | the test counts and gate names on the page appear in transcript.json or the code | P0 |
| V1 | Validation | No analytics or tracking beacon | no gtag, no analytics, no pixel, no third-party script host | P0 |
| V2 | Validation | Fonts declare a fallback stack | every font-family with a webfont also names a system family | P1 |
| E1 | Error | The page opened with fonts blocked | nothing in the page depends on the font load to be readable (no FOIT-only content) | P1 |
| EC1 | Edge | npm pack after adding the page | docs/ still excluded from the published package | P0 |
| EC2 | Edge | CP-58-H3, the relative-link test | still passes with an absolute link in the README | P0 |
