// CP-32: reproduce round-10 findings — SQL_START is both too narrow and too wide.
import { parseQueryOutputs } from '../../lib/query-outputs.mjs';

const run = (label, lines) => {
  const r = parseQueryOutputs(lines.join('\n'), 'INV-4');
  const kinds = r.errors.map((e) => e.kind);
  console.log(`  ${label.padEnd(46)} q=${r.queries.length} manual=${r.queries.filter((q) => q.manual).length} errors=${JSON.stringify(kinds)}`);
  return r;
};

console.log('=== MAJOR 1: disabled SQL that does not start with a listed keyword ===');
console.log('  (expected: stranded — the exemption must not travel)');
run('(select ...) wrapped in parens', [
  '-- @out: -',
  "-- (select * from customers where Email = '<EMAIL>')",
  '',
  'select o.Status, count(*) from orders o group by o.Status;',
]);
run('union all continuation', ['-- @out: -', '-- union all select 1', '', 'select 2;']);
run('values list', ['-- @out: -', '-- values (1,2)', '', 'select 2;']);
run('merge into', ['-- @out: -', '-- merge into t using s on 1=1', '', 'select 2;']);
run('continuation lines only', ['-- @out: -', '--   from customers', '--   where Bounced = 1', '', 'select 2;']);
run('block opening with a heading line', ['-- @out: -', '/* Q1 disabled', 'select 1;', '*/', '', 'select 2;']);

console.log('\n=== MAJOR 3: prose that begins with a SQL keyword ===');
console.log('  (expected: no error — this is a comment, not disabled SQL)');
for (const prose of [
  '-- Select the right threshold first',
  '-- update: Konsta changed this',
  '-- set of contacts we care about',
  '-- Show which packages drift',
  '-- Call Heikki before running',
]) {
  run(prose, ['-- @out: INV-4-status-gap-0908.csv', prose, 'select 1;']);
}

console.log('\n=== MAJOR 2: a comment BELOW the query strands its declaration ===');
console.log('  (expected: no error — the comment comes after the query started)');
run('note inside the query body', [
  '-- @out: INV-4-status-gap-0908.csv',
  'select a.Id',
  '  from t a',
  '-- update: join changed 2026-09',
  '  join u b on b.Id = a.Id;',
]);
