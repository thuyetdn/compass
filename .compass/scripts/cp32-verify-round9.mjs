// CP-32: reproduce round-9 findings — a declaration travelling from a disabled query, and bare CR.
import { parseQueryOutputs } from '../../lib/query-outputs.mjs';

const CR = String.fromCharCode(13);

console.log('=== MAJOR 1: query disabled with a -- prefix, no ; in code position ===');
const dashed = [
  '-- Q3 (temporarily disabled, too slow)',
  '-- @out: INV-4-q3-work-0908.csv',
  '-- select 3 from huge_table;',
  '',
  '-- Q4 the one we actually need to export',
  'select Email from mastercontact where Bounced=1;',
].join('\n');
const r1 = parseQueryOutputs(dashed, 'INV-4');
console.log('queries:', JSON.stringify(r1.queries));
console.log('errors :', JSON.stringify(r1.errors));
console.log('-> Q4 credited with:', r1.queries[0]?.out, '| declLine', r1.queries[0]?.declLine, 'vs line', r1.queries[0]?.line);

console.log('\n=== MAJOR 1b: ; inside the comment rather than in code position ===');
const inside = [
  '-- @out: INV-4-q3-work-0908.csv',
  '/* select 3 from huge_table; */',
  '',
  'select Email from mastercontact;',
].join('\n');
const r1b = parseQueryOutputs(inside, 'INV-4');
console.log('queries:', JSON.stringify(r1b.queries));
console.log('errors :', JSON.stringify(r1b.errors));

console.log('\n=== MAJOR 2: a bare CR ending the declaration line ===');
const cr = ['-- @out: INV-4-status-gap-0908.csv' + CR, 'select 1;'].join('\n');
const r2 = parseQueryOutputs(cr, 'INV-4');
console.log('queries:', r2.queries.length, '| errors:', JSON.stringify(r2.errors.map((e) => e.kind)));

console.log('\n=== MAJOR 2b: CR as the only line separator ===');
const allCr = ['-- @out: INV-4-status-gap-0908.csv', 'select 1;'].join(CR);
const r2b = parseQueryOutputs(allCr, 'INV-4');
console.log('queries:', r2b.queries.length, '| errors:', JSON.stringify(r2b.errors.map((e) => e.kind)));

console.log('\n=== MINOR: a lone ; steals the declaration ===');
const lone = ['-- @out: INV-4-status-gap-0908.csv', ';', 'select 1;'].join('\n');
const r3 = parseQueryOutputs(lone, 'INV-4');
console.log('queries:', JSON.stringify(r3.queries.map((q) => q.out)), '| errors:', JSON.stringify(r3.errors.map((e) => e.kind)));
