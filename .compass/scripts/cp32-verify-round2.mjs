// CP-32: reproduce round-2 blind-review findings before fixing.
import { parseQueryOutputs, matchDeclaredFile } from '../../lib/query-outputs.mjs';

console.log('=== CRITICAL: trailing comment on a code line overrides the real declaration ===');
const trailing = [
  '-- @out: INV-4-status-gap-0908.csv',
  'select * from t where x=1 -- @out: -',
  ';',
].join('\n');
const r1 = parseQueryOutputs(trailing, 'INV-4');
console.log('queries:', JSON.stringify(r1.queries));
console.log('-> manual?', r1.queries[0]?.manual, '(must be false)');

console.log('\n=== MAJOR: greedy match steals a file an exact declaration needs ===');
const two = [
  '-- @out: INV-4-status-gap-0908.csv',
  'select 1;',
  '-- @out: INV-4-status-gap-0915.csv',
  'select 2;',
].join('\n');
const r2 = parseQueryOutputs(two, 'INV-4');
const actual = ['INV-4-status-gap-0915.csv'];
const taken = new Set();
for (const q of r2.queries) {
  const m = matchDeclaredFile(q, actual, taken);
  if (m.found) taken.add(m.found.toLowerCase());
  console.log(q.out, '->', JSON.stringify(m));
}

console.log('\n=== MAJOR: which of two declarations above one query wins ===');
const twoDecls = [
  '-- @out: INV-4-newer-name-0915.csv',
  '-- @out: INV-4-older-name-0908.csv',
  'select 1;',
].join('\n');
console.log(JSON.stringify(parseQueryOutputs(twoDecls, 'INV-4').queries));
