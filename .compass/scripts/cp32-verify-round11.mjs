// CP-32: reproduce round-11 findings — the layout rule depends on a blank line
// the author may simply not have typed, and fires inside a query body.
import { parseQueryOutputs } from '../../lib/query-outputs.mjs';

// Detachment became a non-blocking warning after round 12, so that is what this
// script judges now — reading `errors` here reported false failures.
const run = (label, lines, want) => {
  const r = parseQueryOutputs(lines.join('\n'), 'INV-4');
  const kinds = r.errors.map((e) => e.kind);
  const warns = (r.warnings ?? []).map((w) => w.kind);
  const ok = want === 'stranded' ? warns.includes('detached') : kinds.length === 0;
  console.log(
    `  ${ok ? 'ok   ' : 'WRONG'} ${label.padEnd(44)} q=${r.queries.length} errors=${JSON.stringify(kinds)} warnings=${JSON.stringify(warns)}`,
  );
};

console.log('=== MAJOR 1: same disabled query, no blank line before the next one ===');
console.log('  (want a detached warning — the exemption must not travel silently)');
run('block-disabled, no blank line', [
  '-- Q1 - THAY <EMAIL> roi chay tay.',
  '-- @out: -',
  '/* select * from customers where Email = 1; */',
  'select o.Status, count(*) from orders o group by o.Status;',
], 'stranded');
run('dash-disabled, no blank line', [
  '-- @out: -',
  '-- select * from customers;',
  'select o.Status from orders o;',
], 'stranded');
run('paren-disabled, no blank line', [
  '-- @out: -',
  '-- (select * from t)',
  'select 1;',
], 'stranded');

console.log('\n=== MAJOR 2: a blank line INSIDE the query body ===');
console.log('  (want no error — the declaration is correct and its file exists)');
run('blank line inside the query', [
  '-- Q2 - status gap',
  '-- @out: INV-4-q2-status-gap-0908.csv',
  'select o.Id, o.Status',
  '  from orders o',
  '  join customers c on c.Id = o.CustomerId',
  '',
  ' where o.Status is null',
  ' group by o.Id;',
], 'clean');
run('blank line between decl and query', [
  '-- @out: INV-4-status-gap-0908.csv',
  '',
  'select 1;',
], 'clean');
