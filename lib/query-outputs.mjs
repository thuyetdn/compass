// Reads `-- @out: <filename>` declarations out of a multi-query .sql script and
// pairs each one with the query it marks, so the author names an export file
// while writing the query instead of inventing a name at export time.

const MARKER = /^\s*--\s*@out\s*:(.*)$/i;

// The value that says "this query is run by hand, expect no file". Q1-style
// queries carry placeholders a person substitutes, so demanding a file for them
// would fail the gate for work nobody intended to run unattended.
const MANUAL = '-';

const EXTENSIONS = ['csv', 'tsv', 'json', 'txt'];

// Named so a mutation test can target the line-ending rule: a bare CR ends a
// line too, and missing that let one stray CR swallow a whole file.
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

// `<work>-<date>.<ext>` — what remains after the task id prefix is removed.
// The id is stripped by known prefix rather than matched here: task ids contain
// dashes themselves (`INV-4`), so no regex can find that boundary on its own.
const TAIL_SHAPE = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{4})\.([a-z]+)$/i;

// Anything shaped like an id followed by a dash, used only to report which id a
// name declared when it is not the task being run.
const ANY_ID_PREFIX = /^([a-z]+-?\d*)-/i;

export function validateOutputName(name, taskId) {
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, reason: 'Thiếu tên file sau @out:' };
  }

  const value = name.trim();

  // A declaration names a file inside data/, never a path. Checked before the
  // shape test so traversal and absolute paths get their own message.
  if (value.includes('/') || value.includes('\\')) {
    return { ok: false, reason: `"${value}" phải là tên file, không phải đường dẫn` };
  }
  if (value.includes('..')) {
    return { ok: false, reason: `"${value}" phải là tên file, không được chứa ..` };
  }
  if (/^[a-z]:/i.test(value)) {
    return { ok: false, reason: `"${value}" phải là tên file, không phải đường dẫn tuyệt đối` };
  }

  const prefix = `${taskId}-`;
  if (value.toLowerCase().startsWith(prefix.toLowerCase())) {
    const tail = value.slice(prefix.length).match(TAIL_SHAPE);
    if (!tail) {
      return {
        ok: false,
        reason: `"${value}" không theo khuôn <task-id>-<viec>-<ngay>.<duoi>, ví dụ ${taskId}-status-gap-0908.csv`,
      };
    }

    const ext = tail[3].toLowerCase();
    if (!EXTENSIONS.includes(ext)) {
      return { ok: false, reason: `"${value}" có đuôi .${tail[3]}; chỉ nhận ${EXTENSIONS.join(', ')}` };
    }

    return { ok: true, name: value, work: tail[1], date: tail[2], ext };
  }

  // Not this task's prefix. Say which id it does carry when the name is
  // otherwise well formed, so the fix is obvious.
  const other = value.match(ANY_ID_PREFIX);
  if (other && TAIL_SHAPE.test(value.slice(other[1].length + 1))) {
    return {
      ok: false,
      reason: `"${value}" khai task ${other[1]}, nhưng đang chạy cho ${taskId}`,
      kind: 'wrong-task',
    };
  }

  return {
    ok: false,
    reason: `"${value}" không theo khuôn <task-id>-<viec>-<ngay>.<duoi>, ví dụ ${taskId}-status-gap-0908.csv`,
  };
}

// Walks the text once, tracking whether the cursor sits inside a string literal
// or a comment. A ';' only ends a statement in plain code, and a declaration only
// counts inside a real `--` line comment — CP-15's pitfall is that deciding a
// character's role from the character alone is always wrong. Everything the
// caller needs comes out of this single pass: re-scanning the text afterwards
// would throw the state away and re-open exactly that hole.
function scan(text) {
  const statements = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let quote = null;
  let dollarTag = null;
  let inLineComment = false;
  // A depth counter, not a boolean: Postgres nests block comments, and a boolean
  // ends the outer one at the inner `*/`, then reads comment text as code.
  let blockDepth = 0;

  // Declarations found so far, each tagged with the statement it belongs to.
  // A declaration seen before any code belongs to the statement that follows.
  let decls = [];
  let hasCode = false;
  let codeLine = 0;

  // A declaration reads as belonging to whatever follows it immediately. When
  // anything sits between it and the query — a comment, a blank line — it may
  // instead have been written for a query since commented out, whose `@out: -`
  // would then exempt this one by accident.
  //
  // This is only ever a warning. Three attempts at deciding ownership from the
  // text failed in both directions: a SQL-keyword list missed six ways of
  // disabling a query and blocked ordinary English ("-- update: Konsta changed
  // this"), and requiring a blank line missed every shape written without one.
  // So the scan records the gap and a person judges it.
  //
  // `detachedFrom` is the line after which a declaration no longer sits flush
  // against its query.
  let detachedFrom = 0;
  let commentLinesSinceDecl = 0;
  let lastDeclLine = 0;
  let lineStart = 0;
  let lineHasContent = false;
  // Whether this line already held something before the character being read.
  // `lineHasContent` is set before `markContent` runs, so it always reads true
  // there; this is the value the detachment check actually needs.
  let contentBeforeHere = false;

  // Marks this chunk as a statement rather than a comment block. Called from
  // every branch that consumes content — a string literal and a commented-out
  // body are content too, and a statement made only of those still ends at its
  // `;`, so its declarations must not travel on to the next query.
  const markContent = (atLine) => {
    if (hasCode) return;
    hasCode = true;
    codeLine = atLine;

    // Checked here, at the one moment the query starts, so it fires wherever on
    // the line that happens to be — a query sharing a line with the disabled SQL
    // above it was previously missed entirely.
    //
    // `commentLinesSinceDecl` counts full comment lines that were not
    // declarations; `lineHasContent` catches content earlier on this same line.
    if (lastDeclLine > 0 && (commentLinesSinceDecl > 0 || contentBeforeHere)) {
      detachedFrom = Math.max(detachedFrom, lastDeclLine);
      lastDeclLine = 0;
    }
    commentLinesSinceDecl = 0;
  };

  const push = (endIndex) => {
    const raw = text.slice(start, endIndex);
    if (raw.trim() !== '' && hasCode) {
      // Every declaration still belongs to this statement — deciding otherwise
      // from the text erred in both directions. `stranded` only records which
      // ones sat a gap away, so the caller can say so without failing the gate.
      const stranded = decls.filter((d) => d.line <= detachedFrom);
      statements.push({ text: raw, startLine, codeLine, decls, stranded });
      decls = [];
    }
    // A comment-only chunk carries its declarations forward to the next query.
    start = endIndex;
    startLine = line;
    hasCode = false;
    codeLine = 0;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    // A bare CR ends a line too. Only `\n` used to count, so one stray CR made
    // a `--` comment swallow the rest of the file — the declaration and its
    // query vanished with no error, and a CR-only file parsed as nothing at all.
    if (ch === LF || ch === CR) {
      // CRLF is one line ending, not two.
      if (ch === CR && next === LF) { inLineComment = false; continue; }

      // Counting happens at the comment branch instead, which knows whether a
      // line was a declaration, a heading, or SQL that got commented out.
      // Counting every content line here flagged ordinary headings too.

      line++;
      lineStart = i + 1;
      lineHasContent = false;
      inLineComment = false;
      continue;
    }

    if (!/\s/.test(ch)) {
      // Only bookkeeping here. The detachment check lives in `markContent`,
      // which runs exactly once per statement, at the character where the query
      // begins — wherever on the line that happens to be.
      contentBeforeHere = lineHasContent;
      lineHasContent = true;
    }

    if (inLineComment) continue;

    if (blockDepth > 0) {
      if (ch === '/' && next === '*') { blockDepth++; i++; continue; }
      if (ch === '*' && next === '/') { blockDepth--; i++; }
      continue;
    }

    if (dollarTag !== null) {
      if (ch === '$' && text.startsWith(dollarTag, i)) { i += dollarTag.length - 1; dollarTag = null; }
      continue;
    }

    if (quote !== null) {
      // Doubling is how every dialect escapes a quote, so that is the only rule
      // applied here. Backslash escaping is MySQL-only — Postgres (since 9.1),
      // SQL Server, Oracle and SQLite all treat `\` as an ordinary character,
      // so honouring it ran off the end of a closed literal like
      // `'D:\exports\'` and reported valid SQL as unterminated.
      if (ch === quote) {
        if (next === quote) i++;
        else quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') { markContent(line); quote = ch; continue; }

    // Postgres dollar quoting: $$…$$ or $tag$…$tag$. Without this a ';' inside
    // such a literal fabricates a query the author never wrote.
    if (ch === '$') {
      // A `$` glued to the end of a name is part of that name, not a quote
      // opener: Oracle is full of `v$session` and `col$a`, and reading those as
      // openers reported valid SQL as unterminated.
      const prev = i > 0 ? text[i - 1] : '';
      const partOfName = /[A-Za-z0-9_]/.test(prev);
      const tag = partOfName ? null : /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(i));
      if (tag) { markContent(line); dollarTag = tag[0]; i += tag[0].length - 1; continue; }
    }

    if (ch === '-' && next === '-') {
      // A declaration occupies a line of its own. A `--` trailing real code opens
      // a comment too, but text there annotates that code — reading it as a
      // declaration would let it override the author's real one. What separates
      // them is whether anything precedes the `--` on this physical line, not
      // whether the query has code yet: a declaration may sit between two lines
      // of one statement (EC8).
      // `lineStart` is carried by the loop rather than searched for: calling
      // lastIndexOf here scanned back to the file start on every comment, which
      // made parsing quadratic (P1 caught it at 154x instead of 16x).
      const before = text.slice(lineStart, i);
      let lineEnd = i;
      while (lineEnd < text.length && text[lineEnd] !== LF && text[lineEnd] !== CR) lineEnd++;
      // No CR strip needed: `lineEnd` stops at CR as well as LF, so the slice
      // never carries one. MARKER anchors on `$`, and a stray \r reaching it
      // would make every declaration in a CRLF file invisible — CP-15's
      // recurring pitfall, handled here by where the line ends rather than by
      // trimming afterwards.
      const rest = text.slice(i, lineEnd);
      const ownLine = before.trim() === '';
      const marker = ownLine ? rest.match(MARKER) : null;
      if (marker) {
        decls.push({ raw: marker[1].trim(), line });
        // Start counting from this declaration: anything between it and the
        // query means it no longer sits flush against one.
        lastDeclLine = line;
        commentLinesSinceDecl = 0;
      } else if (ownLine && lastDeclLine > 0 && line > lastDeclLine) {
        // A full-line comment sitting *after* a declaration. A heading belongs
        // above its declaration, so anything below one is either a note the
        // author put in the wrong place or a query they commented out — both
        // worth a person checking.
        commentLinesSinceDecl++;
      }
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      // A `/* … */` block opening a line, below a declaration, counts the same
      // as a `--` line: it may be a query the author wrapped out.
      const before = text.slice(lineStart, i);
      if (before.trim() === '' && lastDeclLine > 0 && line > lastDeclLine) commentLinesSinceDecl++;
      blockDepth = 1;
      i++;
      continue;
    }

    // A `;` ends a statement even when the body before it was commented out.
    // Such a chunk owns its declarations: letting them travel to the next query
    // would attach a name — or an `@out: -` exemption — to a query written for
    // something else, and nothing downstream can tell.
    if (ch === ';') { markContent(line); push(i + 1); continue; }

    // Whitespace is not code; the first real character is what makes this chunk
    // a query, and its line is what a message should point at.
    if (!/\s/.test(ch)) markContent(line);
  }

  push(text.length);

  // Ending mid-construct means everything after the opener was eaten as comment
  // or literal — including any declaration in it. Staying silent here is the one
  // outcome this whole feature exists to prevent: a green gate over a declared
  // file that was never demanded. Note the opener need not be a mistake: `/*`
  // inside a comment leaves depth at 1 in every dialect but Postgres.
  let unterminated = null;
  if (blockDepth > 0) unterminated = 'khối comment /* … */';
  else if (quote !== null) unterminated = `chuỗi mở bằng ${quote}`;
  else if (dollarTag !== null) unterminated = `chuỗi mở bằng ${dollarTag}`;

  return { statements, trailingDecls: decls, unterminated };
}

export function parseQueryOutputs(sql, taskId) {
  const text = typeof sql === 'string' ? sql : '';
  const { statements, trailingDecls, unterminated } = scan(text);

  const queries = [];
  const errors = [];
  // Things worth a look that must not fail the gate.
  const warnings = [];
  const seen = new Map();

  // Reported before anything else, and on its own: whatever the scan managed to
  // read after an unterminated opener is not trustworthy, so a partial verdict
  // would be worse than saying the file cannot be read as written.
  if (unterminated !== null) {
    return {
      queries: [],
      errors: [{
        kind: 'unterminated',
        line: text.split(/\r?\n/).length,
        message: `File kết thúc khi còn ${unterminated} chưa đóng — mọi @out: sau đó bị bỏ qua, không đối chiếu được`,
      }],
    };
  }

  for (const chunk of statements) {
    const all = chunk.decls;

    // The query's line is its first line carrying code, so a message points at
    // the query rather than at the comment block above it.
    const queryLine = chunk.codeLine;

    // A declaration sitting a gap away from its query is worth a look: it may
    // have been written for a query since commented out, in which case an
    // `@out: -` would exempt this one by accident. It is only a warning, never
    // a failure — three attempts at deciding ownership from the text all erred
    // in both directions (see pitfalls), so the gate says what it saw and
    // leaves the judgement to a person.
    for (const d of chunk.stranded ?? []) {
      warnings.push({
        kind: 'detached',
        line: d.line,
        queryLine: queryLine,
        message: `Dòng ${d.line}: khai "${d.raw}" cách query ở dòng ${queryLine} một khoảng — kiểm xem nó thuộc query nào`,
      });
    }

    if (all.length === 0) {
      errors.push({
        kind: 'undeclared',
        line: queryLine,
        message: `Query ở dòng ${queryLine} chưa khai @out:`,
      });
      continue;
    }

    // Two declarations for one query is ambiguous, and no tie-break rule is
    // right: appending a name above the old one and below it are both natural,
    // so guessing would silently pick the stale one half the time. CP-15's
    // pitfall — when the data cannot answer the question, change the question.
    if (all.length > 1) {
      errors.push({
        kind: 'ambiguous',
        lines: all.map((d) => d.line),
        message: `Query ở dòng ${queryLine} có ${all.length} dòng @out: (dòng ${all
          .map((d) => d.line)
          .join(', ')}) — giữ lại một`,
      });
      continue;
    }

    const decl = all[0];

    if (decl.raw === MANUAL) {
      queries.push({ out: null, manual: true, line: queryLine, declLine: decl.line });
      continue;
    }

    const check = validateOutputName(decl.raw, taskId);
    if (!check.ok) {
      errors.push({
        kind: check.kind ?? 'malformed',
        line: decl.line,
        message: `Dòng ${decl.line}: ${check.reason}`,
      });
      continue;
    }

    const prior = seen.get(check.name.toLowerCase());
    if (prior !== undefined) {
      errors.push({
        kind: 'duplicate',
        lines: [prior, queryLine],
        message: `"${check.name}" được khai hai lần, ở dòng ${prior} và ${queryLine}`,
      });
      continue;
    }
    seen.set(check.name.toLowerCase(), queryLine);

    queries.push({
      out: check.name,
      manual: false,
      line: queryLine,
      declLine: decl.line,
      work: check.work,
      date: check.date,
      ext: check.ext,
    });
  }

  // A declaration with no query after it names a file nothing produces. Silently
  // dropping it would hide a typo — or a traversal value — that never got checked.
  for (const decl of trailingDecls) {
    errors.push({
      kind: 'orphan',
      line: decl.line,
      message: `Dòng ${decl.line}: khai "${decl.raw}" nhưng không có query nào theo sau`,
    });
  }

  return { queries, errors, warnings };
}

// Matching ignores the date so re-running a query tomorrow does not mean editing
// the .sql file. The caller still reports the drift, so evidence stays traceable
// to a day. Case is ignored throughout — Windows filesystems do not distinguish
// it, and having the three layers disagree produced nonsense like "khai 0908,
// thấy 0908".
export function matchDeclaredFile(declared, actualNames, taken = new Set()) {
  const free = (name) => !taken.has(name.toLowerCase());
  const exact = actualNames.find((n) => n.toLowerCase() === declared.out.toLowerCase() && free(n));
  if (exact !== undefined) return { found: exact, dateDiffers: false };

  const cut = declared.out.toLowerCase().lastIndexOf(`-${declared.date}.`);
  const stem = `${declared.out.slice(0, cut)}-`.toLowerCase();
  const suffix = `.${declared.ext}`.toLowerCase();

  for (const name of actualNames) {
    const lower = name.toLowerCase();
    if (!lower.startsWith(stem) || !lower.endsWith(suffix) || !free(name)) continue;
    const middle = lower.slice(stem.length, lower.length - suffix.length);
    if (/^\d{4}$/.test(middle)) return { found: name, dateDiffers: true, actualDate: middle };
  }

  return { found: null, dateDiffers: false };
}
