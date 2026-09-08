// CP-32: reproduce each blind-review finding against the real parser before fixing.
// Reproduce each reported finding against the real modules before fixing anything.
import { parseQueryOutputs, matchDeclaredFile } from '../../lib/query-outputs.mjs';

console.log('=== CRITICAL: marker inside a block comment wins ===');
const inComment = [
  '-- @out: INV-4-status-gap-0908.csv',
  'select * from contacts /* how to declare:',
  '-- @out: -',
  '*/ where 1=1;',
].join('\n');
const r1 = parseQueryOutputs(inComment, 'INV-4');
console.log('queries:', JSON.stringify(r1.queries));
console.log('errors:', JSON.stringify(r1.errors));
console.log('-> manual?', r1.queries[0]?.manual, '(expected false: the real decl is a filename)');

console.log('\n=== MAJOR: reported line points at the comment block ===');
const withHeader = [
  '-- ============================',
  '-- Q1 - one contact',
  '-- ============================',
  '-- @out: INV-4-q1-contact-0908.csv',
  'select 1;',
  '',
  '-- Q1b - every contact',
  '-- @out: INV-4-q1b-company-0908.csv',
  'select 2;',
].join('\n');
const r2 = parseQueryOutputs(withHeader, 'INV-4');
console.log('lines reported:', r2.queries.map((q) => q.line), '(expected [5, 9])');

console.log('\n=== MAJOR: undeclared query line number ===');
const undeclared = ['-- a header', '-- more header', '', 'select 1;'].join('\n');
const r3 = parseQueryOutputs(undeclared, 'INV-4');
console.log('errors:', JSON.stringify(r3.errors), '(query is on line 4)');

console.log('\n=== MAJOR: one file satisfies two declarations ===');
const two = [
  '-- @out: INV-4-status-gap-0908.csv',
  'select 1;',
  '-- @out: INV-4-status-gap-0909.csv',
  'select 2;',
].join('\n');
const r4 = parseQueryOutputs(two, 'INV-4');
const actual = ['INV-4-status-gap-0915.csv'];
for (const q of r4.queries) {
  console.log(q.out, '->', JSON.stringify(matchDeclaredFile(q, actual)));
}

console.log('\n=== MINOR: dollar-quoted string splits a query ===');
const dollar = ['-- @out: INV-4-dollar-work-0908.csv', 'select $$a;b$$;'].join('\n');
const r5 = parseQueryOutputs(dollar, 'INV-4');
console.log('queries:', r5.queries.length, 'errors:', JSON.stringify(r5.errors.map((e) => e.kind)));

console.log('\n=== MINOR: case-only difference in extension ===');
const one = parseQueryOutputs(['-- @out: INV-4-work-here-0908.csv', 'select 1;'].join('\n'), 'INV-4');
console.log(JSON.stringify(matchDeclaredFile(one.queries[0], ['INV-4-work-here-0908.CSV'])));

console.log('\n=== MINOR: trailing declaration with no query is dropped ===');
const trailing = ['-- @out: INV-4-first-work-0908.csv', 'select 1;', '', '-- @out: ../../etc/passwd'].join('\n');
const r6 = parseQueryOutputs(trailing, 'INV-4');
console.log('queries:', r6.queries.length, 'errors:', JSON.stringify(r6.errors));

console.log('\n=== MAJOR (gate layer): one file must satisfy only one declaration ===');
const taken = new Set();
for (const q of r4.queries) {
  const m = matchDeclaredFile(q, actual, taken);
  if (m.found) taken.add(m.found.toLowerCase());
  console.log(q.out, '->', JSON.stringify(m));
}
