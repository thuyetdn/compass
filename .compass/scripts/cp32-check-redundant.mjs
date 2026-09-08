// CP-32: are the two surviving-mutation guards genuinely redundant, or is a
// test simply missing? Anything that still differs means they are load-bearing.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'lib', 'query-outputs.mjs');
const BACKUP = path.join(tmpdir(), 'cp32-redundant.bak');
const CR = String.fromCharCode(13);

const inputs = [
  ['CRLF file', ['-- @out: INV-4-crlf-work-0908.csv', 'select 1;'].join(CR + '\n')],
  ['bare CR', ['-- @out: INV-4-crlf-work-0908.csv' + CR, 'select 1;'].join('\n')],
  ['CR only', ['-- @out: INV-4-crlf-work-0908.csv', 'select 1;'].join(CR)],
  ['CRLF, two queries', ['-- @out: INV-4-a-work-0908.csv', 'select 1;', '-- @out: INV-4-b-work-0908.csv', 'select 2;'].join(CR + '\n')],
  ['CRLF at EOF only', '-- @out: INV-4-eof-work-0908.csv\nselect 1;' + CR],
  ['commented-out with ;', ['-- @out: -', '/* select 1 */;', '', 'select 2;'].join('\n')],
  ['commented-out, string body', ['-- @out: -', "'just a literal';", '', 'select 2;'].join('\n')],
  ['empty statement', ['-- @out: INV-4-a-work-0908.csv', ';', 'select 1;'].join('\n')],
];

async function snapshot(label) {
  // Cache-bust so each variant is re-imported rather than served from cache.
  const mod = await import(`file:///${FILE.replace(/\\/g, '/')}?v=${label}-${Date.now()}`);
  return inputs.map(([name, sql]) => {
    const r = mod.parseQueryOutputs(sql, 'INV-4');
    return `${name}: q=${JSON.stringify(r.queries.map((q) => [q.out, q.line, q.manual]))} e=${JSON.stringify(r.errors.map((x) => [x.kind, x.line]))}`;
  });
}

const MUTATIONS = [
  ['CR strip in declaration line', ".replace(/\\r$/, '')", ''],
  ['markContent at the semicolon', "if (ch === ';') { markContent(line); push(i + 1); continue; }", "if (ch === ';') { push(i + 1); continue; }"],
];

copyFileSync(FILE, BACKUP);
const original = readFileSync(FILE, 'utf8');
const base = await snapshot('base');

for (const [name, from, to] of MUTATIONS) {
  if (!original.includes(from)) {
    console.log(`SKIP ${name}: target not found — proves nothing`);
    continue;
  }
  writeFileSync(FILE, original.replace(from, to));
  const after = await snapshot(name.replace(/\W/g, ''));
  const diffs = base.map((b, i) => (b === after[i] ? null : `    ${b}\n -> ${after[i]}`)).filter(Boolean);
  console.log(`\n--- ${name}`);
  console.log(diffs.length === 0 ? '    no observable difference — redundant' : diffs.join('\n'));
  writeFileSync(FILE, original);
}

copyFileSync(BACKUP, FILE);
try { unlinkSync(BACKUP); } catch { /* leave it */ }
console.log('\nrestored:', readFileSync(FILE, 'utf8') === original);
