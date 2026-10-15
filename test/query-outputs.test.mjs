import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueryOutputs, validateOutputName, matchDeclaredFile } from '../lib/query-outputs.mjs';
import { measureGrowth, assertLinear, QUERY_GROWTH, queryScript } from './helpers/growth.mjs';

// A declaration marks the query that follows it. Splitting on ';' is wrong when
// the ';' sits inside a string literal or a comment, so the fixtures below carry
// exactly those shapes rather than well-behaved SQL.

test('CP-32-H1 parses one @out declaration per query', () => {
  const sql = [
    '-- @out: INV-4-first-0908.csv',
    'select 1;',
    '',
    '-- @out: INV-4-second-0908.csv',
    'select 2;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 2);
  assert.equal(queries[0].out, 'INV-4-first-0908.csv');
  assert.equal(queries[1].out, 'INV-4-second-0908.csv');
  assert.equal(queries[0].line, 2);
  assert.equal(queries[1].line, 5);
});

test('CP-32-H2 counts b-variants as their own queries', () => {
  // INV-4's real shape: Q1 and Q1b are separate statements under one heading.
  const sql = [
    '-- ============================',
    '-- Q1 - one contact',
    '-- ============================',
    '-- @out: INV-4-q1-contact-0908.csv',
    'select 1;',
    '',
    '-- Q1b - every contact of that company',
    '-- @out: INV-4-q1b-company-0908.csv',
    'select 2;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries.map((q) => q.out), [
    'INV-4-q1-contact-0908.csv',
    'INV-4-q1b-company-0908.csv',
  ]);
});

test('CP-32-H3 treats @out: - as a manual case exempt from file matching', () => {
  const sql = ['-- @out: -', "select 1 where email = '<EMAIL>';"].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].manual, true);
  assert.equal(queries[0].out, null);
});

test('CP-32-H6 does not turn a header comment block into a query', () => {
  const sql = [
    '-- INV-4: compare two contact sets',
    '--',
    '-- Run on PROD, read-only.',
    '',
    '-- @out: INV-4-only-0908.csv',
    'select 1;',
  ].join('\n');

  const { queries } = parseQueryOutputs(sql, 'INV-4');

  assert.equal(queries.length, 1);
  assert.equal(queries[0].out, 'INV-4-only-0908.csv');
});

test('CP-32-V1 rejects a name that breaks the task-work-date template', () => {
  const sql = ['-- @out: results.csv', 'select 1;'].join('\n');

  const { errors } = parseQueryOutputs(sql, 'INV-4');

  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'malformed');
  assert.match(errors[0].message, /results\.csv/);
});

test('CP-32-V2 reports a duplicate filename with both line numbers', () => {
  const sql = [
    '-- @out: INV-4-same-0908.csv',
    'select 1;',
    '-- @out: INV-4-same-0908.csv',
    'select 2;',
  ].join('\n');

  const { errors } = parseQueryOutputs(sql, 'INV-4');

  const dup = errors.find((e) => e.kind === 'duplicate');
  assert.ok(dup, 'expected a duplicate error');
  assert.match(dup.message, /INV-4-same-0908\.csv/);
  assert.deepEqual(dup.lines, [2, 4]);
});

test('CP-32-V3 reports a query with no declaration at all', () => {
  const sql = ['select 1;', '', '-- @out: INV-4-second-0908.csv', 'select 2;'].join('\n');

  const { errors } = parseQueryOutputs(sql, 'INV-4');

  const undeclared = errors.find((e) => e.kind === 'undeclared');
  assert.ok(undeclared, 'expected an undeclared error');
  assert.equal(undeclared.line, 1);
});

test('CP-32-V4 rejects a declaration carrying a different task id', () => {
  const sql = ['-- @out: INV-9-work-0908.csv', 'select 1;'].join('\n');

  const { errors } = parseQueryOutputs(sql, 'INV-4');

  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'wrong-task');
  assert.match(errors[0].message, /INV-9/);
  assert.match(errors[0].message, /INV-4/);
});

test('CP-32-V5 treats an empty @out value as malformed, not manual', () => {
  const sql = ['-- @out:', 'select 1;'].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'malformed');
  assert.notEqual(queries[0]?.manual, true);
});

test('CP-32-V6 rejects an extension outside the accepted list', () => {
  const sql = ['-- @out: INV-4-work-0908.xlsx', 'select 1;'].join('\n');

  const { errors } = parseQueryOutputs(sql, 'INV-4');

  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'malformed');
  assert.match(errors[0].message, /csv/);
});

test('CP-32-EC1 does not split on a semicolon inside a string literal', () => {
  const sql = ['-- @out: INV-4-literal-0908.csv', "select * from t where s = 'a;b';"].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
});

test('CP-32-EC2 does not split on a semicolon inside a line comment', () => {
  const sql = [
    '-- @out: INV-4-linecomment-0908.csv',
    'select 1 -- note; not a boundary',
    ';',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
});

test('CP-32-EC3 does not split on a semicolon inside a block comment', () => {
  // A trailing query proves the comment also *ends*: without one, code that
  // never closes a block comment counts one query here and looks correct.
  const sql = [
    '-- @out: INV-4-blockcomment-0908.csv',
    'select 1 /* spanning',
    '   a ; boundary',
    '   here */ + 2;',
    '',
    '-- @out: INV-4-after-block-0908.csv',
    'select 3;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 2);
  assert.equal(queries[0].out, 'INV-4-blockcomment-0908.csv');
  assert.equal(queries[1].out, 'INV-4-after-block-0908.csv');
});

test('CP-32-EC4 handles CRLF input with no trailing carriage return in names', () => {
  const lines = ['-- @out: INV-4-crlf-0908.csv', 'select 1;'];

  const crlf = parseQueryOutputs(lines.join('\r\n'), 'INV-4');

  // Absolute assertion first: comparing CRLF against LF output would pass even
  // when both are wrong in the same way (CP-15 pitfall).
  assert.deepEqual(crlf.errors, []);
  assert.equal(crlf.queries.length, 1);
  assert.equal(crlf.queries[0].out, 'INV-4-crlf-0908.csv');
  assert.equal(crlf.queries[0].line, 2);

  const lf = parseQueryOutputs(lines.join('\n'), 'INV-4');
  assert.deepEqual(crlf.queries, lf.queries);
});

test('CP-32-EC5 produces no phantom query from trailing comments', () => {
  const sql = [
    '-- @out: INV-4-last-0908.csv',
    'select 1;',
    '',
    '-- done for today',
    '   ',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
});

test('CP-32-EC6 counts a final query with no trailing semicolon', () => {
  const sql = ['-- @out: INV-4-nosemi-0908.csv', 'select 1'].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].out, 'INV-4-nosemi-0908.csv');
});

test('CP-32-EC7 accepts varied spacing and casing of the marker', () => {
  const variants = [
    '--@out:INV-4-tight-0908.csv',
    '-- @OUT:   INV-4-tight-0908.csv',
    '--   @Out: INV-4-tight-0908.csv',
  ];

  for (const marker of variants) {
    const { queries, errors } = parseQueryOutputs([marker, 'select 1;'].join('\n'), 'INV-4');
    assert.deepEqual(errors, [], `unexpected errors for ${marker}`);
    assert.equal(queries[0].out, 'INV-4-tight-0908.csv', `wrong name for ${marker}`);
  }
});

test('CP-32-EC8 attributes a mid-query declaration to that query', () => {
  const sql = [
    'select 1,',
    '-- @out: INV-4-midway-0908.csv',
    '       2;',
    '',
    '-- @out: INV-4-next-0908.csv',
    'select 3;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 2);
  assert.equal(queries[0].out, 'INV-4-midway-0908.csv');
  assert.equal(queries[1].out, 'INV-4-next-0908.csv');
});

test('CP-32-S1 rejects a traversal segment in a declared name', () => {
  const { ok, reason } = validateOutputName('../../etc/passwd', 'INV-4');

  assert.equal(ok, false);
  assert.match(reason, /tên file/i);
});

test('CP-32-S2 rejects a path separator in a declared name', () => {
  for (const name of ['sub/dir/INV-4-work-0908.csv', 'sub\\INV-4-work-0908.csv']) {
    const { ok } = validateOutputName(name, 'INV-4');
    assert.equal(ok, false, `should reject ${name}`);
  }
});

test('CP-32-S4 rejects an absolute path as a declared name', () => {
  for (const name of ['C:\\INV-4-work-0908.csv', '/tmp/INV-4-work-0908.csv']) {
    const { ok } = validateOutputName(name, 'INV-4');
    assert.equal(ok, false, `should reject ${name}`);
  }
});

test('CP-32-P1 parse cost stays linear in query count', () => {
  // Measure the shape, not a wall-clock threshold, so the ratio holds on a slow
  // machine too (CP-10). One sample per size used to read 72x on linear code
  // when a few-ms stall hit the large sample (CP-62); the CP-55 harness takes
  // the smallest ratio of five interleaved pairs instead. 8x the queries reads
  // 6–7 when linear and 47–50 for the historical lastIndexOf regression.
  const { small, large, warmup, pairs, limit } = QUERY_GROWTH;
  const sqls = { [small]: queryScript(small), [large]: queryScript(large) };
  // A fixture that parses to nothing times an empty loop; pin it before timing.
  for (const n of [small, large]) assert.equal(parseQueryOutputs(sqls[n], 'INV-4').queries.length, n);

  const result = measureGrowth({ run: (n) => parseQueryOutputs(sqls[n], 'INV-4'), small, large, warmup, pairs });
  assertLinear(result, limit);
});

test('CP-32-S5 ignores a marker that only looks like one inside a comment', () => {
  // The real declaration is a filename; the block comment shows a person how to
  // write a manual case. Treating the example as a declaration would make the
  // gate stop demanding the file — a green gate over absent evidence.
  const sql = [
    '-- @out: INV-4-status-gap-0908.csv',
    'select * from contacts /* how to declare:',
    '-- @out: -',
    '*/ where 1=1;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].manual, false);
  assert.equal(queries[0].out, 'INV-4-status-gap-0908.csv');
});

test('CP-32-S6 ignores a marker inside a string literal', () => {
  const sql = [
    '-- @out: INV-4-status-gap-0908.csv',
    "select '-- @out: -' as example from t;",
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries[0].manual, false);
  assert.equal(queries[0].out, 'INV-4-status-gap-0908.csv');
});

test('CP-32-EC9 does not split on a semicolon inside a dollar-quoted string', () => {
  const plain = parseQueryOutputs(['-- @out: INV-4-dollar-plain-0908.csv', 'select $$a;b$$;'].join('\n'), 'INV-4');
  assert.deepEqual(plain.errors, []);
  assert.equal(plain.queries.length, 1);

  const tagged = parseQueryOutputs(['-- @out: INV-4-dollar-tag-0908.csv', 'select $tag$a;b$tag$;'].join('\n'), 'INV-4');
  assert.deepEqual(tagged.errors, []);
  assert.equal(tagged.queries.length, 1);
});

test('CP-32-EC10 reports a trailing declaration with no query after it', () => {
  const sql = [
    '-- @out: INV-4-first-work-0908.csv',
    'select 1;',
    '',
    '-- @out: INV-4-orphan-work-0908.csv',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.equal(queries.length, 1);
  const orphan = errors.find((e) => e.kind === 'orphan');
  assert.ok(orphan, 'expected an orphan error');
  assert.equal(orphan.line, 4);
});

test('CP-32-EC11 matches a file differing only in extension case', () => {
  const { queries } = parseQueryOutputs(['-- @out: INV-4-work-here-0908.csv', 'select 1;'].join('\n'), 'INV-4');

  const match = matchDeclaredFile(queries[0], ['INV-4-work-here-0908.CSV']);

  assert.equal(match.found, 'INV-4-work-here-0908.CSV');
  assert.equal(match.dateDiffers, false, 'same date must not report as drift');
});

test('CP-32-EC12 lets one file satisfy only one declaration', () => {
  const sql = [
    '-- @out: INV-4-status-gap-0908.csv',
    'select 1;',
    '-- @out: INV-4-status-gap-0909.csv',
    'select 2;',
  ].join('\n');
  const { queries } = parseQueryOutputs(sql, 'INV-4');
  const actual = ['INV-4-status-gap-0915.csv'];

  const taken = new Set();
  const results = queries.map((q) => {
    const m = matchDeclaredFile(q, actual, taken);
    if (m.found) taken.add(m.found.toLowerCase());
    return m;
  });

  assert.equal(results[0].found, 'INV-4-status-gap-0915.csv');
  assert.equal(results[1].found, null, 'a single file cannot satisfy both declarations');
});

test('CP-32-S7 ignores a marker trailing real code on the same line', () => {
  // The comment is real, but text after code annotates that code. Reading it as
  // a declaration let it override the author's own — a gate green over evidence
  // nobody ever demanded.
  const sql = [
    '-- @out: INV-4-status-gap-0908.csv',
    'select * from t where x=1 -- @out: -',
    ';',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].manual, false);
  assert.equal(queries[0].out, 'INV-4-status-gap-0908.csv');
});

test('CP-32-V8 rejects two declarations above one query', () => {
  const sql = [
    '-- @out: INV-4-newer-name-0915.csv',
    '-- @out: INV-4-older-name-0908.csv',
    'select 1;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.equal(queries.length, 0, 'an ambiguous query must not be counted as declared');
  const amb = errors.find((e) => e.kind === 'ambiguous');
  assert.ok(amb, 'expected an ambiguous error');
  assert.deepEqual(amb.lines, [1, 2]);
});

test('CP-32-EC17 closes the right comment when block comments nest', () => {
  // Postgres nests block comments, and the depth counter can fail in either
  // direction. A boolean ends the outer comment at the inner `*/`, so the `;`
  // fabricates a boundary and the count goes UP. A missing decrement never
  // closes the comment, so the second query is swallowed and the count goes
  // DOWN — with no error, meaning a declared file is silently never demanded.
  // A one-query fixture cannot tell the second case from a correct parse, so a
  // second query after the nested comment is what gives this test teeth.
  const sql = [
    '-- @out: INV-4-nested-work-0908.csv',
    'select 1 /* a /* b */ ; c */ + 2;',
    '',
    '-- @out: INV-4-after-nested-0908.csv',
    'select 3;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries.map((q) => q.out), [
    'INV-4-nested-work-0908.csv',
    'INV-4-after-nested-0908.csv',
  ]);
});

test('CP-32-S9 accepts only a four-digit date as the drifting segment', () => {
  // Date tolerance exists so re-running a query on another day needs no edit to
  // the .sql file. Accepting any tail instead would let an unrelated leftover
  // — a draft, a hand-named export — stand in as the declared evidence.
  const { queries } = parseQueryOutputs(
    ['-- @out: INV-4-status-gap-0908.csv', 'select 1;'].join('\n'),
    'INV-4',
  );

  for (const leftover of [
    'INV-4-status-gap-final.csv',
    'INV-4-status-gap-draft.csv',
    'INV-4-status-gap-091.csv',
    'INV-4-status-gap-09155.csv',
  ]) {
    const match = matchDeclaredFile(queries[0], [leftover]);
    assert.equal(match.found, null, `${leftover} must not satisfy the declaration`);
  }

  // A real date still matches, so the tolerance itself is intact.
  assert.equal(matchDeclaredFile(queries[0], ['INV-4-status-gap-0915.csv']).found,
    'INV-4-status-gap-0915.csv');
});

test('CP-32-S10 reports a file ending mid-construct instead of dropping declarations', () => {
  // Everything after an unterminated opener is eaten as comment or literal,
  // declarations included. Silence here is the one outcome this feature exists
  // to prevent: a green gate over a file nobody ever produced.
  const cases = [
    ['block comment', ['-- @out: INV-4-q1-work-0908.csv', 'select 1;', '/* commented out', '-- @out: INV-4-q2-work-0908.csv', 'select 2;']],
    ['string literal', ['-- @out: INV-4-q1-work-0908.csv', "select 1 where n = 'O'Brien';", '-- @out: INV-4-q2-work-0908.csv', 'select 2;']],
    ['dollar quote', ['-- @out: INV-4-q1-work-0908.csv', 'select $$unterminated;', '-- @out: INV-4-q2-work-0908.csv', 'select 2;']],
  ];

  for (const [label, lines] of cases) {
    const { queries, errors } = parseQueryOutputs(lines.join('\n'), 'INV-4');
    const found = errors.find((e) => e.kind === 'unterminated');
    assert.ok(found, `${label}: expected an unterminated error, got ${JSON.stringify(errors)}`);
    assert.equal(queries.length, 0, `${label}: a partial verdict is worse than none`);
  }
});

test('CP-32-S11 reports a closed comment that contains a second opener', () => {
  // Only Postgres nests block comments, so `/* a /* b */` is a complete comment
  // in most dialects while the depth counter still reads depth 1. The two cases
  // are indistinguishable from the text, so the file must be reported rather
  // than parsed on a guess.
  const sql = [
    '/* Q1: superseded the /* old */',
    '-- @out: INV-4-q1-work-0908.csv',
    'select 1;',
    '',
    '-- @out: INV-4-q2-status-gap-0908.csv',
    'select 2;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.equal(queries.length, 0);
  assert.ok(errors.some((e) => e.kind === 'unterminated'), JSON.stringify(errors));
});

test('CP-32-S12 keeps a commented-out statement from exempting the next query', () => {
  // Commenting a query out and leaving its `-- @out: -` above is ordinary
  // editing. If that exemption travels to the next query, a real production
  // export is marked "run by hand" and its file is never demanded — the one
  // outcome this gate exists to prevent.
  const sql = [
    '-- @out: -',
    '/* select Status, count(*) from crmlaaspackages group by Status */;',
    '',
    '-- Q2 - the bounce list we must export',
    'select Email from mastercontact where Bounced = 1;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  // The real query must be named. Several errors are expected here — the
  // stranded exemption, and the commented-out statement itself — so this looks
  // for the one about line 5 rather than taking whichever came first.
  const forQ2 = errors.filter((e) => e.kind === 'undeclared' && e.line === 5);
  assert.equal(forQ2.length, 1, `Q2 must be reported undeclared, got ${JSON.stringify(errors)}`);
  // The exemption belongs to the commented-out statement, which sits above it.
  assert.ok(queries.every((q) => q.line < 5), 'no query at line 5 may count as declared');
});

test('CP-32-EC18 reads a closed literal that ends in a backslash', () => {
  // Backslash escaping is MySQL-only; Postgres 9.1+, SQL Server, Oracle and
  // SQLite treat it as an ordinary character. Honouring it ran off the end of
  // this closed literal and reported valid SQL as unterminated.
  const bs = String.fromCharCode(92);
  const sql = [
    '-- @out: INV-4-paths-work-0908.csv',
    `select * from FileLog where Path = 'D:${bs}exports${bs}';`,
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].out, 'INV-4-paths-work-0908.csv');
});

test('CP-32-EC19 does not read a trailing $ in an identifier as a quote opener', () => {
  for (const body of ['select v$session from x;', 'select t$a$ from x;']) {
    const { queries, errors } = parseQueryOutputs(
      ['-- @out: INV-4-ident-work-0908.csv', body].join('\n'),
      'INV-4',
    );
    assert.deepEqual(errors, [], `${body} is valid SQL`);
    assert.equal(queries.length, 1, body);
  }

  // Real dollar quoting still works, so the narrowing did not disable it.
  for (const body of ['select $$a;b$$;', 'select $tag$a;b$tag$;']) {
    const { queries, errors } = parseQueryOutputs(
      ['-- @out: INV-4-dollar-work-0908.csv', body].join('\n'),
      'INV-4',
    );
    assert.deepEqual(errors, [], body);
    assert.equal(queries.length, 1, `${body} must not split at the inner ;`);
  }
});

test('CP-32-S13 warns when a declaration sits a gap above a dash-disabled query', () => {
  // Commenting a query out line by line is the commonest way to disable one.
  // Its declaration must not travel to the next query and name a file that
  // query never produces.
  const sql = [
    '-- Q3 (temporarily disabled, too slow)',
    '-- @out: INV-4-q3-work-0908.csv',
    '-- select 3 from huge_table;',
    '',
    '-- Q4 the one we actually need to export',
    'select Email from mastercontact where Bounced=1;',
  ].join('\n');

  const { errors, warnings } = parseQueryOutputs(sql, 'INV-4');

  // A warning, never a failure: three attempts at deciding ownership from the
  // text all erred in both directions, so the gate reports and a person judges.
  assert.deepEqual(errors, [], 'a gap must not fail the gate');
  assert.ok(
    warnings.some((w) => w.kind === 'detached' && w.line === 2),
    `expected a detached warning, got ${JSON.stringify(warnings)}`,
  );
});

test('CP-32-S14 warns when a declaration sits a gap above a block-disabled query', () => {
  const sql = [
    '-- @out: INV-4-q3-work-0908.csv',
    '/* select 3 from huge_table; */',
    '',
    'select Email from mastercontact;',
  ].join('\n');

  const { errors, warnings } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.ok(
    warnings.some((w) => w.kind === 'detached' && w.line === 1),
    `expected a detached warning, got ${JSON.stringify(warnings)}`,
  );
});

test('CP-32-S15 keeps prose above a query attached to it', () => {
  // The inverse of S13/S14: a comment describing the next query must NOT strand
  // the declaration. INV-4's real file is full of these headings, and breaking
  // the tie would fail every well-formed script.
  const sql = [
    '-- ============================================',
    '-- Q1b — every contact of that company, and who is PIC',
    '-- Answers: does this company still have an order?',
    '-- ============================================',
    '-- @out: INV-4-q1b-company-0908.csv',
    'select 1;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].out, 'INV-4-q1b-company-0908.csv');
});

test('CP-32-EC20 treats a bare CR as a line ending', () => {
  const CR = String.fromCharCode(13);

  // One stray CR: without CR handling the `--` comment ran to end of file and
  // both the declaration and its query disappeared with no error at all.
  const stray = ['-- @out: INV-4-status-gap-0908.csv' + CR, 'select 1;'].join('\n');
  const one = parseQueryOutputs(stray, 'INV-4');
  assert.deepEqual(one.errors, []);
  assert.equal(one.queries.length, 1);
  assert.equal(one.queries[0].out, 'INV-4-status-gap-0908.csv');

  // A CR-only file (classic Mac endings) must parse the same way.
  const crOnly = ['-- @out: INV-4-status-gap-0908.csv', 'select 1;'].join(CR);
  const two = parseQueryOutputs(crOnly, 'INV-4');
  assert.deepEqual(two.errors, []);
  assert.equal(two.queries.length, 1);
  assert.equal(two.queries[0].out, 'INV-4-status-gap-0908.csv');
});

test('CP-32-EC21 does not let a lone semicolon pass a declaration along', () => {
  // An empty statement is still a statement. Without that, the declaration
  // above it travels to the next real query and names its file — the same
  // misattribution as a commented-out query, by a shorter route.
  const sql = ['-- @out: INV-4-a-work-0908.csv', ';', 'select 1;'].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  const claimed = queries.find((q) => q.out === 'INV-4-a-work-0908.csv');
  assert.ok(claimed, 'the empty statement keeps the declaration');
  assert.equal(claimed.line, 2, 'and it stays on line 2, not the query on line 3');
  assert.ok(
    errors.some((e) => e.kind === 'undeclared' && e.line === 3),
    `the real query must be reported, got ${JSON.stringify(errors)}`,
  );
});

test('CP-32-S16 warns however the query below the declaration was disabled', () => {
  // Ownership is decided by layout, not by reading the comment. Deciding it from
  // wording missed every one of these: none begins with a SQL keyword, yet each
  // is a disabled query whose declaration must not travel.
  const shapes = [
    ['parenthesised', ["-- (select * from mastercontact where Email = '<E>')"]],
    ['union branch', ['-- union all select 1 from t']],
    ['values list', ['-- values (1,2)']],
    ['merge', ['-- merge into t using s on 1=1']],
    ['continuation only', ['--   from mastercontact', '--   where Bounced = 1']],
    ['block opening with a heading', ['/* Q1 disabled', 'select 1;', '*/']],
  ];

  for (const [label, disabled] of shapes) {
    const sql = ['-- @out: -', ...disabled, '', 'select Email from mastercontact;'].join('\n');
    const { errors, warnings } = parseQueryOutputs(sql, 'INV-4');

    assert.deepEqual(errors, [], `${label}: a gap must not fail the gate`);
    assert.ok(
      warnings.some((w) => w.kind === 'detached'),
      `${label}: expected a detached warning, got ${JSON.stringify(warnings)}`,
    );
  }
});

test('CP-32-S17 keeps a declaration when the comment merely reads like SQL', () => {
  // The inverse of S16. Judging by wording blocked all of these, and the author's
  // only remedy was to reword their own comment.
  const prose = [
    '-- Select the right threshold first',
    '-- update: Konsta changed this 2026-09',
    '-- set of contacts we care about',
    '-- Show which packages drift',
    '-- Call Heikki before running this',
    '-- Delete nothing here',
  ];

  for (const note of prose) {
    const sql = ['-- @out: INV-4-status-gap-0908.csv', note, 'select 1;'].join('\n');
    const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

    assert.deepEqual(errors, [], `${note} must not strand the declaration`);
    assert.equal(queries.length, 1, note);
    assert.equal(queries[0].out, 'INV-4-status-gap-0908.csv', note);
  }
});

test('CP-32-S18 does not strand on a comment below the start of the query', () => {
  // A comment after the query has begun cannot be a disabled query that the
  // declaration above belonged to.
  const sql = [
    '-- @out: INV-4-status-gap-0908.csv',
    'select a.Id',
    '  from t a',
    '-- update: join changed 2026-09',
    '  join u b on b.Id = a.Id;',
  ].join('\n');

  const { queries, errors } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].out, 'INV-4-status-gap-0908.csv');
});

test('CP-32-S19 warns even with no blank line before the next query', () => {
  // The signal is "content came between the declaration and the query". An
  // earlier version required a blank line, which every file written without one
  // slipped past silently — no warning at all, which is worse than the
  // documented hole.
  const shapes = [
    ['dash-disabled', ['-- @out: -', '-- select * from huge_table;', 'select Email from mastercontact;']],
    ['block-disabled', ['-- @out: -', '/* select 1; */', 'select 2;']],
    ['paren-disabled', ['-- @out: -', '-- (select * from t)', 'select 1;']],
  ];

  for (const [label, lines] of shapes) {
    const { errors, warnings } = parseQueryOutputs(lines.join('\n'), 'INV-4');
    assert.deepEqual(errors, [], `${label}: still only a warning`);
    assert.ok(
      warnings.some((w) => w.kind === 'detached'),
      `${label}: expected a detached warning, got ${JSON.stringify(warnings)}`,
    );
  }
});

test('CP-32-S20 stays quiet when only a blank line separates declaration and query', () => {
  // A false warning here would train people to skip the ⚠ line, and that line
  // is the only thing standing between them and the accepted residual hole.
  const sql = ['-- @out: INV-4-status-gap-0908.csv', '', 'select 1;'].join('\n');

  const { queries, errors, warnings } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [], 'a blank line alone is formatting');
  assert.equal(queries[0].out, 'INV-4-status-gap-0908.csv');
});

test('CP-32-S21 warns when disabled SQL shares a line with the real query', () => {
  // Checked at the first character of a line, this was missed entirely: the
  // line already had content by the time the query's code began, so nothing was
  // reported at all — the same silent-hole class as the round-12 defect.
  const sql = [
    '-- @out: -',
    '/* select 3 from huge_table; */ select Email from mastercontact where Bounced=1;',
  ].join('\n');

  const { errors, warnings } = parseQueryOutputs(sql, 'INV-4');

  assert.deepEqual(errors, [], 'still only a warning');
  assert.ok(
    warnings.some((w) => w.kind === 'detached'),
    `expected a detached warning, got ${JSON.stringify(warnings)}`,
  );
});

test('CP-32-S22 stays silent on every well-formed layout', () => {
  // A false ⚠ is not harmless: it trains people to skip the line, and that line
  // is the only thing standing between them and the accepted residual hole.
  const quiet = [
    ['flush against the query', ['-- @out: INV-4-a-work-0908.csv', 'select 1;']],
    ['after a heading block', ['-- ====', '-- Q2 - the gap', '-- ====', '-- @out: INV-4-a-work-0908.csv', 'select 1;']],
    ['after a blank line', ['-- @out: INV-4-a-work-0908.csv', '', 'select 1;']],
    ['note inside the body', ['-- @out: INV-4-a-work-0908.csv', 'select a', '-- note', '  from t;']],
    ['block comment inside the body', ['-- @out: INV-4-a-work-0908.csv', 'select 1 /* note', '  spanning */ + 2;']],
    ['mid-query declaration', ['select 1,', '-- @out: INV-4-a-work-0908.csv', '       2;']],
  ];

  for (const [label, lines] of quiet) {
    const { errors, warnings } = parseQueryOutputs(lines.join('\n'), 'INV-4');
    assert.deepEqual(errors, [], `${label}: no error`);
    assert.deepEqual(warnings, [], `${label}: no warning either`);
  }
});
