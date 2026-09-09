# CP-35: Compass was written for one file type and one closing pass
Loại: bug
Phạm vi: commands/investigate.mjs, commands/scripts.mjs, SKILL.md, .compass/scripts/README.md, writing-vi.md, test/investigate-command.test.mjs, lib/pitfall-file.mjs (mới)
Gốc soi: 3482c91

## Mục tiêu
Three defects reported from the MEI multi-repo project, INV-1, 2026-09-09. All three share one
shape: Compass was built assuming `.mjs` files and a single `--close` per investigation.

1. **Duplicate pitfalls.** `commands/investigate.mjs:126` calls `appendFileSync` unconditionally,
   so closing an investigation twice writes the entry twice. Reopening is routine — editing the
   dossier changes `docHash`, which forces a re-close. That session left INV-1 and INV-5 with two
   copies each, cleaned up by hand.

2. **`scripts --list` cannot read HTML comments.** `purposeOf()` at `commands/scripts.mjs:33`
   accepts `//`, `#`, `--` and `/*` but not `<!--`, so an `.html` file that does carry a
   description is reported as having none.

3. **`scripts/` now holds three kinds of file** and the docs name only one. `.mjs` runs under
   node, `.sql` is pasted into a client, `.html` opens in a browser. SKILL.md says only "script
   lưu vào `.compass/scripts/`", so where a `.sql` or a UI tool belongs became an argument — that
   session lost several exchanges to it. `output/` is gitignored, so putting a tool there loses it.

Plus two writing rules, from a survey of Vietnamese style resources that found nothing loadable
(VietLint checks identifiers, not prose; VnCoreNLP and underthesea tokenise; LanguageTool has no
Vietnamese style rules). All 21 agent-style rules were compared against `writing-vi.md`; 19 were
already covered. The two that were not:

- **Repeated sentence openers** (RULE-C). Vietnamese makes this especially easy with "Việc X…" /
  "Điều này…" / "Nó…", and a reader spots machine prose immediately.
- **One name per thing, throughout** (RULE-F). Section 7 covers whether to translate a term; it
  says nothing about renaming the same thing mid-document. In an investigation dossier the reader
  cannot tell whether three names mean one thing or three.

## Ràng buộc
- The pitfall rewrite must key on the entry's own `## <title>`, matching what `--close` writes, and
  replace up to the next `## ` heading. `existing` is already read at line 124 — no second read.
- A rewrite must never lose a neighbouring entry. Pitfalls are the only record of traps already
  sprung; losing one costs the next person a session.
- The pitfall write stays inside its `try`: a failing write is reported as `pitfallWritten: false`,
  never thrown. That contract is what lets `investigate --close` work on a read-only checkout.
- `purposeOf` must not treat `-->` as a description. A line holding only the closer carries no
  text, the same reason `/*` and `*/` are already skipped.
- `OUT_MARKER` must keep working: an `@out:` declaration is not a description. It must NOT gain an
  `<!--` branch — inside a closed block the in-block `@out` check already handles it, and for an
  unterminated block the branch skips the opener and lets the next line through as a description.
- Subdirectories only. `scripts/` keeps its name and `compass scripts` keeps its spelling — renaming
  the directory breaks every project already using it, for a naming problem.
- Zero runtime dependency: `node:*` and relative imports only.
- Split lines with `/\r?\n/`. This pitfall has now recurred in five files.
- `writing-vi.md` additions follow the file's own form: paired ❌ → ✅ sentences, no rule names to
  memorise. Section 4 goes from twelve mistakes to fourteen, and its heading says so.

## Rủi ro hồi quy
- `investigate --close` currently appends. A task that closed before this change has an entry with
  no matching heading style, or a title later edited; the rewrite must leave those alone rather
  than deleting the wrong block.
- `pitfalls.md` holds 36 entries written by hand and by `--close`. Rewriting one must not reflow,
  reorder, or renumber the rest — the file is git-tracked and a spurious diff hides the real change.
- `purposeOf` feeds `compass scripts --list` for every existing `.mjs`. Adding `<!--` must not
  change what any current file reports; `port-holders.mjs` and the nine `cp32-*.mjs` are the corpus.
- `walk()` already recurses, so `--list` finds files in new subdirectories without change. What it
  must not do is print a directory as an entry, or lose the `README.md` exclusion one level down.
- `compass data <id> <file.sql>` takes a path argument, so moving `.sql` into `scripts/queries/`
  does not change the command. But SKILL.md's filename template example cites a path; it must match
  where the file now lives.
- `writing-vi.md` is loaded by the skill and cited from SKILL.md by section number ("Phần 8").
  Adding to Section 4 must not shift the later part numbers.

## Test cases

The dangerous direction for the pitfall fix is data loss, so E- and S-cases carry the weight: a
rewrite that eats a neighbour is worse than the duplicate it replaces.

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `--close` on an investigation whose pitfall is not yet in the file | Appended, exactly as today | P0 |
| H2 | Happy | `--close` twice on the same investigation | One entry, not two; the second run replaces the first | P0 |
| H3 | Happy | Closing again after the pitfall text changed | The file holds the new text, and only once | P0 |
| H4 | Happy | `scripts --list` on an `.html` file whose first line is `<!-- mô tả -->` | Prints that description | P0 |
| H5 | Happy | `scripts --list` on files in `scripts/queries/` and `scripts/tools/` | Both listed, with paths relative to `scripts/` | P0 |
| V1 | Validation | An `.html` file whose first comment line is `<!--` alone, description on the next line | Reads the next line, the way `/*` already behaves | P0 |
| V2 | Validation | A line holding only `-->` | Not read as a description | P0 |
| V3 | Validation | `<!-- @out: x-y-0909.csv -->` as the first comment | Not a description — a declaration names an export file | P0 |
| V4 | Validation | An `.html` file opening with `<!DOCTYPE html>` | Reported as having no description, not as one | P1 |
| E1 | Error | `pitfalls.md` is read-only when `--close` runs | `pitfallWritten: false`, gate still closes, no throw | P0 |
| E2 | Error | `pitfalls.md` holds a heading whose title matches but whose body is empty | Replaced cleanly, no stray blank block left behind | P1 |
| E3 | Error | `pitfalls.md` does not end in a newline and the entry must be replaced | No heading runs into the previous paragraph | P1 |
| EC1 | Edge | The entry to replace is the last one in the file | Replaced to end of file; nothing after it to preserve | P0 |
| EC2 | Edge | The entry to replace is the first one, right under the `#` title | The file's own title and intro survive | P0 |
| EC3 | Edge | `pitfalls.md` uses CRLF | Entry replaced, CRLF preserved, other entries untouched. Checking only "no `\r` in the heading" also passes when the whole file is converted to LF — which rewrites all 295 line endings of the real file in a spurious diff | P0 |
| EC4 | Edge | An investigation title containing regex metacharacters (`.`, `(`, `*`, `[`) | Matched literally, not as a pattern | P0 |
| EC5 | Edge | Two existing entries whose titles are prefixes of each other (`INV-1` and `INV-10`) | Only the exact title is replaced | P0 |
| EC6 | Edge | A `###` subheading inside the entry being replaced | Consumed with its entry; the scan stops at `## `, not at any heading | P1 |
| EC7 | Edge | An `.html` file using `<!--` with no space before the text | Description read | P2 |
| EC8 | Edge | A `README.md` inside `scripts/queries/` | Excluded, the same as the top-level one | P1 |
| S1 | Security | Replacing an entry preserves every other entry byte-for-byte | A diff of the file shows only the one block changed | P0 |
| S2 | Security | The rewritten file still parses as the same 36 entries plus or minus the one | Entry count is exactly as expected — no silent merge of two blocks | P0 |
| S3 | Security | An entry whose body contains a line starting with `## ` inside a fenced block | The neighbouring entry always survives. The new entry is truncated at that line — a deliberate tradeoff: guessing the other way scans to EOF and deletes every following entry, silently, at exit 0. Three attempts at reading fences to tell a real heading from an example all failed | P0 |
| S4 | Security | `scripts --list` never prints file contents beyond the one description line | Output holds no second line from any file | P1 |
| S5 | Security | An unterminated ``` fence inside the entry being replaced, with entries after it | Every following entry survives. A per-line flag sticks for the rest of the file, so no later `## ` is seen, the range runs to EOF, and neighbours are deleted silently at exit 0 | P0 |
| S6 | Security | An `.html` file whose `<!--` is never closed, with markup or data below | No description read. Accepting the next line prints the file body, and these tools read customer data | P0 |
| V5 | Validation | A bare `@out:` line inside an `<!-- … -->` block | Not a description. Continuation lines carry no comment prefix, so the `@out` guard above does not see them | P1 |
| EC9 | Edge | Appending a new entry to a CRLF file | No LF-only line introduced. Note this case does not isolate `appendBlock`'s EOL choice — eleven other cases already cover that function, so it guards the outcome rather than the line | P2 |
| S7 | Security | Two unterminated fences in different entries | Nothing between them is lost. Pairing fence markers by order makes one entry's stray opener pair with another's, and the whole span — real headings included — is treated as inside a code block | P0 |
| S8 | Security | An unterminated `<!--` followed by a data row (email, phone, amount) | Nothing from the file is printed. A guard that only rejects lines starting with `<` catches markup and lets data through | P0 |
| V6 | Validation | `<!-- -->` and `<!---->` — an empty comment | Not reported as a description. An optional-closer regex returns the literal `-->` | P0 |
| S9 | Security | A stray `-->` followed by a data row | Nothing printed. Matching only the bare closer lets `--> a@b.com,…` fall through to the comment regex, whose `--` branch captures the rest | P0 |
| S10 | Security | A line holding markup and data, with `<!--` appearing mid-line | Nothing printed. A block only counts when `<!--` opens the line; accepting one mid-line means that line had code before it, and returning it prints the file body | P0 |
| S11 | Security | A closed comment with a description, followed by data on the same line | Only the description is printed. Stripping just a trailing `-->` leaves the rest of the line, which is file body | P0 |
| S12 | Security | A `##<tab>Heading` inside the pitfall body | Not an entry boundary, and repeated closes stay byte-identical. `\s` matches a tab while the dossier parser breaks on a literal space — the mismatch lets that line reach the pitfall body and then act as a boundary, duplicating the tail on every close | P0 |
| S13 | Security | A file using a bare CR, U+2028, or U+2029 as its line break | Nothing from the file is printed. Regex `.` does not match those and the line splitter did not break on them, so the file collapsed to one line that opens a comment, contains its closer, counts as a closed block, and is returned whole | P0 |
| S14 | Security | A neighbouring entry whose lines use the minority line ending | It keeps its own line endings byte-for-byte. Joining the whole file with one shared ending rewrites lines nobody touched | P0 |
| S15 | Security | The same, for a line BEFORE the replaced entry | Also byte-for-byte — the before and after halves are rebuilt separately, so each needs its own case | P0 |
| S16 | Security | The blank separator line above the replaced entry, when the preceding entry uses the minority line ending | Kept byte-for-byte. That line is popped and rebuilt; rebuilding it with the shared ending takes a byte from an entry nobody touched | P0 |
| EC14 | Edge | A `//` or `--` comment whose text merely mentions the HTML opener | Its description is kept. The unclosed-block guard must be anchored to the line start, like its `-->` sibling; matching anywhere discards a real description | P1 |
| EC13 | Edge | One stray CRLF line inside an otherwise-LF file | The other line endings are left alone. Picking the EOL from "is there any CRLF" re-joins all 291 lines of the real file, the whole-file spurious diff this spec forbids twice | P1 |
| EC12 | Edge | Closing the same investigation six times | The file is byte-identical after the first close. Without the trailing-blank trim each close adds a blank line, and re-closing is routine | P0 |
| EC11 | Edge | A real `~~~` fence holding a `## ` line | The following entry survives. Truncation of the new entry is the accepted S3 tradeoff; what must never happen is losing a neighbour | P1 |
| EC10 | Edge | The investigation title is a true prefix of an existing entry's title | The longer entry is untouched and the new one is appended — matching by prefix in this direction replaces the wrong entry, and the real one is never written | P0 |
