// CP-32: reproduce round-8 findings — misattributed declaration, and backslash false positive.
import { parseQueryOutputs } from '../../lib/query-outputs.mjs';

console.log('=== MAJOR 1: declaration of a commented-out query lands on the next query ===');
const commentedOut = [
  '-- @out: -',
  '/* select Status, count(*) from crmlaaspackages group by Status */;',
  '',
  '-- Q2 - the bounce list we must export',
  'select Email from mastercontact where Bounced = 1;',
].join('\n');
const r1 = parseQueryOutputs(commentedOut, 'INV-4');
console.log('queries:', JSON.stringify(r1.queries));
console.log('errors :', JSON.stringify(r1.errors));
console.log('-> Q2 marked manual?', r1.queries[0]?.manual, '(it has no declaration of its own)');
console.log('-> declLine', r1.queries[0]?.declLine, 'vs query line', r1.queries[0]?.line);

console.log('\n=== MAJOR 2: backslash treated as escape blocks valid non-MySQL SQL ===');
const bs = String.fromCharCode(92);
const winPath = [
  '-- @out: INV-4-paths-work-0908.csv',
  "select * from FileLog where Path = 'D:" + bs + "exports" + bs + "';",
].join('\n');
const r2 = parseQueryOutputs(winPath, 'INV-4');
console.log('input line 2:', winPath.split('\n')[1]);
console.log('queries:', r2.queries.length, '| errors:', JSON.stringify(r2.errors.map((e) => e.kind)));

console.log('\n=== MINOR: $ in an identifier read as a dollar quote ===');
for (const sql of ['select t$a$ from x;', 'select * from x where a=$x$;']) {
  const r = parseQueryOutputs(['-- @out: INV-4-ident-work-0908.csv', sql].join('\n'), 'INV-4');
  console.log(' ', sql, '->', JSON.stringify(r.errors.map((e) => e.kind)));
}
