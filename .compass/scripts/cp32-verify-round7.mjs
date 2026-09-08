// CP-32: reproduce the round-7 Major — a declaration lost inside an unterminated construct.
import { parseQueryOutputs } from '../../lib/query-outputs.mjs';

const cases = [
  ['closed comment containing /* (non-Postgres SQL)', [
    '/* Q1: superseded the /* old */',
    '-- @out: INV-4-q1-work-0908.csv',
    'select 1;',
    '',
    '-- @out: INV-4-q2-status-gap-0908.csv',
    'select 2;',
  ]],
  ['apostrophe typo in a string literal', [
    '-- @out: INV-4-q1-work-0908.csv',
    "select 1 where Name = 'O'Brien Ltd';",
    '',
    '-- @out: INV-4-q2-status-gap-0908.csv',
    'select 2;',
  ]],
  ['forgotten */ after commenting a block out', [
    '-- @out: INV-4-q1-work-0908.csv',
    'select 1;',
    '/* commented out for now',
    '-- @out: INV-4-q2-status-gap-0908.csv',
    'select 2;',
  ]],
];

for (const [name, lines] of cases) {
  const r = parseQueryOutputs(lines.join('\n'), 'INV-4');
  console.log(`\n--- ${name}`);
  console.log('  queries:', r.queries.length, '| declared:', JSON.stringify(r.queries.map((q) => q.out)));
  console.log('  errors  :', JSON.stringify(r.errors.map((e) => e.kind)));
  console.log('  ->', r.errors.length === 0 ? 'SILENT: gate would exit 0' : 'reported');
}
