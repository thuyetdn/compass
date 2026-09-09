# CP-32: Name each query's export file inside the .sql script
Loại: feature-m
Phạm vi: lib/query-outputs.mjs (mới), commands/data.mjs (mới), cli.mjs, SKILL.md, .compass/scripts/README.md

## Mục tiêu
An investigation `.sql` file holding many queries must name the export file for each
one, so the author fills in a template once while writing the query instead of inventing
a filename at export time. A new gate reads those declarations, rejects malformed or
duplicate names, and reports which declared files are actually present in
`.compass/<id>/data/`.

## Ràng buộc
- Zero runtime dependency: `node:*` and relative imports only (convention `no-bare-import`).
- `lib/` returns values, never calls `process.exit` or `console.log` (conventions
  `no-exit-in-lib`, `no-console-in-lib`).
- Split lines with `/\r?\n/` — CRLF pitfall from CP-15 recurred across three files already.
- Read-only: the gate never writes into `data/` and never runs SQL.
- Existing filename template `<task-id>-<viec>-<ngay>.<duoi>` from SKILL.md:387 stays;
  this task extends it to multi-query files, it does not replace it.
- No new gate wired into `check`/`done` — `data` runs on demand, because a gate that
  demands production query results would block every task that touches no database.

## Rủi ro hồi quy
- `compass scripts` reads the first comment line of every file to describe it. Adding
  `-- @out:` lines must not change what it prints for existing scripts, and must not make
  it treat an `@out:` line as a file's purpose.
- `cli.mjs` dispatch: adding a `data` case must not shadow or reorder existing commands;
  `compass scripts` and `compass investigate` keep working unchanged.
- `.compass/<id>/data/` is `.gitignore`-covered because it holds customer emails. The new
  command lists filenames only — it must never read or print file contents.
- SKILL.md edits touch the section `investigate` depends on; the wording change must not
  invalidate the existing `<task-id>-<viec>-<ngay>` template that INV-4's header cites.

## Test cases

Query splitting is the risky part: `;` inside a string literal or a comment is not a
statement boundary, and CP-15's pitfall warns against deciding a line's role from a single
character. EC1–EC4 cover exactly those.

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Parse a file where every query carries one `-- @out: <name>.csv` line | Returns one entry per query, each with its declared filename and the query's start line | P0 |
| H2 | Happy | Parse INV-4's real 11-query file shape (Q0–Q6 plus Q1b/Q2b/Q4b variants) | Finds 11 queries, not 6 — a `b` variant counts as its own query | P0 |
| H3 | Happy | `@out: -` marks a query as manual, exempt from file matching | Entry is flagged manual; gate counts it as declared but expects no file | P0 |
| H4 | Happy | Gate output lists each declared file and whether it exists in `data/` | Exit 0; every declared name printed with present/missing state | P0 |
| H5 | Happy | Declared `…-0908.csv` matches an actual `…-0915.csv` in `data/` | Counted as present, and the output states the date differs (0908 declared, 0915 found) | P0 |
| H6 | Happy | Header comment lines above the first query are not mistaken for a query | No entry produced for the header block | P1 |
| V1 | Validation | `@out:` names a file whose stem breaks the `<task-id>-<viec>-<ngay>` template | Exit 1, names the offending file and shows the expected template | P0 |
| V2 | Validation | Two queries declare the same filename | Exit 1, reports the duplicate name and both query line numbers, at the parser layer | P0 |
| V7 | Validation | The gate itself surfaces a duplicate declaration | Exit 1 and the printed text says the name was declared twice (V2 checks the same case at the parser layer) | P0 |
| V3 | Validation | A query has no `@out:` line at all | Exit 1, reports the query's line number as undeclared | P0 |
| V4 | Validation | `@out:` declares a task id different from the task the gate runs for | Exit 1, states the declared id and the expected id | P1 |
| V5 | Validation | `@out:` line present but the value is empty | Exit 1, treated as malformed rather than as manual | P1 |
| V6 | Validation | Declared extension is not one of csv/tsv/json/txt | Exit 1, lists the accepted extensions | P2 |
| E1 | Error | Target `.sql` file does not exist | Exit 2 with the path, distinct from a validation failure | P0 |
| E2 | Error | `.compass/<id>/data/` does not exist yet | Exit 1 listing every declared file as missing, and says the directory is absent — not a crash | P0 |
| E3 | Error | The `.sql` file is unreadable (permission denied) | Exit 2 naming the file; no partial verdict | P1 |
| E4 | Error | Run outside a Compass root (no `.compass/config.json`) | Exit 2 with the same message other commands use | P1 |
| EC1 | Edge | A `;` inside a single-quoted string literal (`where Email = 'a;b'`) | Does not split the query there — one entry, not two | P0 |
| EC2 | Edge | A `;` inside a `--` line comment | Not a statement boundary; one entry | P0 |
| EC3 | Edge | A `;` inside a `/* … */` block comment spanning lines | Not a statement boundary; one entry | P0 |
| EC4 | Edge | File uses CRLF line endings throughout | Same entries as the LF version, and the declared names carry no trailing `\r` | P0 |
| EC5 | Edge | Trailing content after the last `;` (whitespace and comments only) | Produces no phantom final query | P1 |
| EC6 | Edge | A query with no trailing `;` at end of file | Still counted as a query | P1 |
| EC7 | Edge | `@out:` written with varied spacing/case (`--@out:x`, `-- @OUT: x`) | All recognised, yielding the same filename | P2 |
| EC8 | Edge | An `@out:` line appearing after the query's own text, before the `;` | Attributed to that query, not to the next one | P2 |
| S1 | Security | Declared name contains a path traversal segment (`../../etc/passwd`) | Exit 1, rejected as malformed; no filesystem access outside `data/` | P0 |
| S2 | Security | Declared name contains a path separator (`sub/dir/x-y-0908.csv`) | Exit 1; declarations name a file, never a path | P0 |
| S3 | Security | Gate output for a present file shows the filename only | Output contains no bytes from inside the file — `data/` holds customer emails | P0 |
| S4 | Security | Declared name is an absolute path (`C:\x.csv`, `/tmp/x.csv`) | Exit 1, rejected as malformed | P1 |
| S5 | Security | A line that looks like `-- @out: -` but sits inside a block comment or a string literal | Ignored; the real declaration above the query still wins, and the file is still demanded | P0 |
| EC9 | Edge | A dollar-quoted string containing a semicolon (`select $$a;b$$;`) | One query, no fabricated second query | P1 |
| EC10 | Edge | A declaration at end of file with no query following it | Exit 1, reported as an orphan naming the line — not silently dropped | P1 |
| EC11 | Edge | Declared `…-0908.csv` versus an actual file differing only in extension case | Matched, and reported as an exact match rather than a date difference | P2 |
| EC12 | Edge | Two declarations sharing a work stem against a single file in `data/` | Only the first is satisfied; the second is reported missing, at the matcher layer | P0 |
| EC14 | Edge | The same case through the gate itself | Exit 1 and the summary reads `1/2 file có trong data/` (EC12 checks the matcher directly) | P0 |
| S6 | Security | A marker inside a string literal (`select '-- @out: -'`) | Ignored; the real declaration above the query still wins | P0 |
| EC13 | Edge | `compass scripts` listing a `.sql` file whose first comment is a declaration | Prints the author's description, never the `@out:` line | P0 |
| S7 | Security | A marker trailing real code (`select 1 -- @out: -`) | Ignored; the real declaration on its own line above still wins, and the file is still demanded | P0 |
| V8 | Validation | Two `@out:` lines above one query | Exit 1, reports both line numbers and asks for one — no silent tie-break | P0 |
| EC15 | Edge | Declarations `…-0908` and `…-0915` against a `data/` holding only `…-0915` | The exact declaration claims the file; the other is reported missing, and no filename is printed both present and absent | P0 |
| EC16 | Edge | Error summary counts an orphan declaration | Says `1 query trong file` for one query plus one orphan, not 2 | P2 |
| H7 | Happy | Summary counting with a mix of manual, present and missing queries | `expected` excludes manual queries, so 1 manual + 1 present + 1 missing reads `1/2 file có trong data/ · 1 chạy tay` | P0 |
| E5 | Error | `data/` exists but cannot be listed (permission denied) | Exit 2 naming the directory — never "re-run the queries", whose results may already be on disk | P1 |
| S8 | Security | A directory inside `data/` named exactly like a declared file | Not counted as present; only regular files are evidence | P1 |
| EC17 | Edge | A nested block comment containing a semicolon (Postgres syntax: /* a /* b */ ; c */) | One query, no spurious undeclared error — a depth counter closes the right comment | P2 |
| S9 | Security | A leftover file whose stem matches but whose tail is not a date (`INV-4-status-gap-final.csv`) | Not accepted for a declared `…-0908.csv`; only a four-digit date counts as the same evidence on another day | P1 |
| S10 | Security | A file ending with an unterminated block comment, string literal, or dollar quote | Exit 1 naming the unterminated construct — never exit 0, because every @out: after the opener was swallowed | P0 |
| S11 | Security | A closed comment that contains a second /* (legal outside Postgres) | Exit 1: the depth counter cannot tell it from a real nesting, so declarations after it are unreadable and must be reported, not dropped | P0 |
| E6 | Error | Gate output for an unterminated construct | Says what to close and does not print a query count, which would be a number the scan never established | P1 |
| S12 | Security | A commented-out statement that still ends in `;` carries its own `@out: -` | The exemption stays with that statement; the next real query is reported undeclared, not silently exempted | P0 |
| EC18 | Edge | A closed literal ending in a backslash (`Path = 'D:\exports\'`) | Parsed as one query — backslash escaping is MySQL-only, so honouring it reported valid SQL as unterminated | P1 |
| EC19 | Edge | A `$` glued to the end of an identifier (`v$session`, `t$a$`) | Not read as a dollar-quote opener; real `$$…$$` and `$tag$…$tag$` still parse | P1 |
| S13 | Security | A query disabled by prefixing its lines with `--`, its declaration left above | A `detached` warning naming both lines; the gate does not fail — three attempts at deciding ownership from the text erred in both directions, so the gate reports and a person judges | P0 |
| S14 | Security | The same, disabled by wrapping the query in `/* … */` | A `detached` warning, same reasoning | P0 |
| EC20 | Edge | A bare CR ends a line (one stray CR, and a CR-only file) | The declaration and its query are still found — a CR must not make a `--` comment swallow the rest of the file | P0 |
| S15 | Security | A comment block describing the next query (INV-4 heading style) | Stays attached: the declaration below it is NOT stranded — the inverse of S13/S14, or every well-formed script would fail | P0 |
| EC21 | Edge | A lone `;` (empty statement) between a declaration and its query | The declaration stays with the empty statement; the real query is reported undeclared rather than silently taking the name | P1 |
| S16 | Security | A query disabled in six shapes that begin with no SQL keyword (`-- (select …)`, `-- union all …`, `-- values (…)`, `-- merge into`, continuation lines only, a `/*` block opening with a heading) | All six warn rather than fail; ownership is never inferred from the comment wording | P0 |
| S17 | Security | Prose beginning with a SQL keyword (`-- update: Konsta changed this`, `-- Select the right threshold`) | No error, and the verdict never depends on wording. A full comment line below the declaration does draw a `⚠` — position is measurable, wording is not | P0 |
| S18 | Security | A note inside the query body, or a blank line inside it, below the line where the query starts | No warning: once the query has started, a gap is formatting, so a correct declaration is never questioned | P0 |
| EC22 | Edge | A declaration left above a disabled query, with a second declaration on the real query | Exit 1 as `ambiguous`, naming both declaration lines — the dangerous case is caught by a measurable rule, not by a guess | P0 |
| EC23 | Edge | A detached declaration with no second one to make it ambiguous | Exit 0 with a `⚠` line naming both the declaration line and the query line — the gate says what it cannot adjudicate rather than guessing | P0 |
| EC24 | Edge | A detached declaration in a file that ALSO has an error (an undeclared query) | The `⚠` still prints alongside the error. Fixing the error is the moment the author may unknowingly settle the ambiguity, so a warning withheld until the error clears is a warning that arrives too late to read | P0 |
| S19 | Security | A disabled query and the real one with NO blank line between them | Still warns: the signal is "content came between", not "a blank line appeared" — requiring one missed every file written without it | P0 |
| S20 | Security | A declaration, a blank line, then its own query and nothing else | No warning: blank lines alone are formatting, and a false warning trains people to ignore the real ones | P1 |
| S21 | Security | Disabled SQL and the real query sharing one physical line (`/* select … */ select Email …`) | Still warns: the check runs where the query starts, not at the first character of a line, so a query mid-line is not missed | P0 |
| S22 | Security | Layouts that must stay silent: declaration flush against its query, after a heading block, after a blank line, a note or block comment inside the query body, and a mid-query declaration (EC8) | No warning in any of them — a false ⚠ trains people to skip the real ones | P0 |
| P1 | Performance | Parse cost stays linear in file size: run at 4× and 16× the query count and compare ratios | Time ratio tracks the size ratio within 2×; a quadratic split would show ≈16× at 4× input | P1 |
