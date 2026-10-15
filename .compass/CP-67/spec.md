# CP-67: `compass knowledge --page` writes one self-contained HTML page of the knowledge base
Loại: feature-s
Phạm vi: commands/knowledge.mjs, lib/knowledge-page.mjs (mới), test/knowledge-page.test.mjs (mới), skills/compass/SKILL.md, README.md
Gốc soi: 356a052

## Mục tiêu

`SKILL.md` line 726 lists "trang xem knowledge bằng trình duyệt" as missing. Today the knowledge
base is read by opening `.knowledge/derived/components.json` and the two `decided/*.md` files
separately; nothing shows them together, and nothing makes the `confident: false` warning visible
at the moment someone is trusting a component's props.

Done means `compass knowledge --page` writes `.knowledge/derived/index.html`: one file, no network,
no build step, showing the decided documents and every scanned component, with the unconfident ones
marked as not to be trusted. Opening it in a browser needs nothing installed.

## Ràng buộc

- Zero dependency and zero network: no CDN script, no web font, no fetch. The page must render from
  the single file, offline.
- Everything from the scan is untrusted text: component names, paths and prop names come from
  source files, so every value is HTML-escaped. A repo that defines a component named
  `<img onerror=...>` must not produce a page that executes it.
- Written into `.knowledge/derived/`, which is gitignored — the page is machine-made, like the JSON.
- `compass knowledge` and `compass knowledge --sync` keep their exact current behaviour and exit
  codes. `--page` is additive.
- Vietnamese output, matching every other command.

## Rủi ro hồi quy

- The knowledge gate is called by `done`. If `--page` changes what `knowledgeCommand` returns for
  the no-flag case, every task's `done` is affected.
- `--page` writing a file into `derived/` must not make the manifest stale — `.manifest` tracks
  source files, and an HTML output that counts as a source would make the gate red forever after.
- CP-60 taught the scan to skip linked worktrees. The page must show the same component set the
  gate sees, or the two disagree and the page becomes the lie.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Project with two components, run --page | .knowledge/derived/index.html exists, exit 0 | P0 |
| H2 | Happy | Page content for a scanned component | its name, path and each prop name appear in the HTML | P0 |
| H3 | Happy | decided/conventions.md and pitfalls.md exist | both headings appear in the page | P0 |
| H4 | Happy | A component with confident: false | the page marks it unreliable in text, not only by CSS class | P0 |
| H5 | Happy | Page is opened with no network | no src/href points to http:// or https:// anywhere in the file | P0 |
| V1 | Validation | No .knowledge directory at all | exit 0, says there is nothing to show, writes no file | P0 |
| V2 | Validation | derived/components.json missing but decided/ present | page is written with the decided documents and says the scan has not run | P0 |
| V3 | Validation | components.json is an empty object | page is written and says no component was found | P1 |
| E1 | Error | derived/components.json is malformed JSON | exit 2, names the file, writes no partial page | P0 |
| E2 | Error | derived/ is not writable | exit 2, says it cannot write, does not throw a raw stack | P1 |
| EC1 | Edge | Component name contains < > & " | they appear escaped; the raw characters do not reach the markup | P0 |
| EC2 | Edge | A prop default contains a </script> sequence | the page still parses as one document; the sequence is escaped | P0 |
| EC3 | Edge | decided/*.md contains a markdown table and a code fence | the page shows them as text without executing or breaking layout | P1 |
| EC4 | Edge | Run --page twice in a row | the second run overwrites cleanly, byte-identical for identical input | P1 |
| EC5 | Edge | --page after --sync in the same project | the page lists exactly the components the scan just wrote | P0 |
| S1 | Security | Component path is an absolute path outside the project | the page shows it as text, no link that opens a local file outside .knowledge | P0 |
| S2 | Security | A prop name is `onload=alert(1)` | it renders as visible text, never as an attribute | P0 |
| S3 | Security | A decided/*.md file contains a raw <script> block | the script tag is escaped and does not execute when the page is opened | P0 |
