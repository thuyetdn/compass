// CP-32: mutation-test each blind-review fix — a fix without a test that dies is a fix that will regress.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BS = String.fromCharCode(92);
const TARGETS = {
  parser: 'lib/query-outputs.mjs',
  data: 'commands/data.mjs',
  scripts: 'commands/scripts.mjs',
};

const MUTATIONS = [
  {
    name: 'CRITICAL: accept markers anywhere, not just in real comments',
    file: TARGETS.parser,
    from: 'decls.push({ raw: marker[1].trim(), line });',
    to: 'if (marker) decls.push({ raw: marker[1].trim(), line });\n      // mutated',
    expectSurvive: true, // a no-op control: proves the harness reports survival correctly
  },
  {
    name: 'CRLF/CR: line ends stop at both CR and LF',
    file: TARGETS.parser,
    from: "while (lineEnd < text.length && text[lineEnd] !== LF && text[lineEnd] !== CR) lineEnd++;",
    to: "while (lineEnd < text.length && text[lineEnd] !== LF) lineEnd++;",
  },
  {
    name: 'query line points at code, not at the comment above',
    file: TARGETS.parser,
    from: 'if (!/' + BS + 's/.test(ch)) markContent(line);',
    to: 'if (!/' + BS + 's/.test(ch)) { if (!hasCode) { hasCode = true; codeLine = startLine; } }',
  },
  {
    name: 'dollar-quote tracking',
    file: TARGETS.parser,
    from: "if (tag) { markContent(line); dollarTag = tag[0]; i += tag[0].length - 1; continue; }",
    to: 'if (tag) { markContent(line); i += tag[0].length - 1; continue; }',
  },
  {
    name: 'orphan declaration reporting',
    file: TARGETS.parser,
    from: "kind: 'orphan',",
    to: "kind: 'ignored-orphan',",
  },
  {
    name: 'one file satisfies one declaration (taken set)',
    file: TARGETS.data,
    from: 'const match = matchDeclaredFile(q, actual, taken);',
    to: 'const match = matchDeclaredFile(q, actual);',
  },
  {
    name: 'scripts skips the @out marker',
    file: TARGETS.scripts,
    from: 'if (OUT_MARKER.test(line)) continue;',
    to: '',
  },
  {
    name: 'round2 CRITICAL: marker must start its own line',
    file: TARGETS.parser,
    from: "const ownLine = before.trim() === '';",
    to: "const ownLine = true;",
  },
  {
    name: 'round2: ambiguous declarations rejected',
    file: TARGETS.parser,
    from: 'if (all.length > 1) {',
    to: 'if (false) {',
  },
  {
    name: 'round2: exact match claims a file before drift',
    file: TARGETS.data,
    from: "if (phase === 'exact' && match.dateDiffers) continue;",
    to: '',
  },
  {
    name: 'round2: orphan not counted as a query',
    file: TARGETS.data,
    from: "errors.filter((e) => !NOT_A_QUERY.has(e.kind)).length",
    to: "errors.length",
  },
  {
    name: 'round3: manual queries excluded from expected',
    file: TARGETS.data,
    from: 'const expected = queries.length - manual;',
    to: 'const expected = queries.length;',
  },
  {
    name: 'round3: only regular files count as evidence',
    file: TARGETS.data,
    from: '.filter((e) => e.isFile())',
    to: '',
  },
  {
    name: 'round3: unreadable data/ is not treated as absent',
    file: TARGETS.data,
    from: "if (err.code === 'ENOENT') return { names: [], absent: true };",
    to: 'return { names: [], absent: true };',
  },
  {
    name: 'round4: nested block comments use a depth counter',
    file: TARGETS.parser,
    from: "if (ch === '/' && next === '*') { blockDepth++; i++; continue; }",
    to: '',
  },
  {
    name: 'round7: unterminated construct is reported',
    file: TARGETS.parser,
    from: 'if (unterminated !== null) {',
    to: 'if (false) {',
  },
  {
    name: 'round7: block depth counts as unterminated',
    file: TARGETS.parser,
    from: "if (blockDepth > 0) unterminated = 'khối comment /* … */';",
    to: '',
  },
  {
    name: 'round8: a commented-out statement owns its declarations',
    file: TARGETS.parser,
    from: "if (ch === ';') { markContent(line); push(i + 1); continue; }",
    to: "if (ch === ';') { push(i + 1); continue; }",
  },
  {
    name: 'round8: backslash is not an escape',
    file: TARGETS.parser,
    from: 'if (ch === quote) {',
    to: 'if (ch === String.fromCharCode(92) && next !== undefined) { i++; continue; } if (ch === quote) {',
  },
  {
    name: 'round8: trailing $ in a name is not an opener',
    file: TARGETS.parser,
    from: 'const tag = partOfName ? null :',
    to: 'const tag = false ? null :',
  },
  {
    name: 'round9: stranded declarations are reported',
    file: TARGETS.parser,
    from: "const stranded = decls.filter((d) => d.line <= detachedFrom);",
    to: "const own = decls;",
  },
  {
    name: 'round9: bare CR ends a line',
    file: TARGETS.parser,
    from: "ch === LF || ch === CR",
    to: "ch === LF",
  },
  {
    name: 'round10: a blank line then content strands the declaration',
    file: TARGETS.parser,
    from: "if (lastDeclLine > 0 && (commentLinesSinceDecl > 0 || contentBeforeHere)) {",
    to: "if (false) {",
  },
  {
    name: 'round10: a blank line opens the gap',
    file: TARGETS.parser,
    from: "contentBeforeHere = lineHasContent;",
    expectSurvive: true, // equivalent mutant: commentLinesSinceDecl covers every case
    to: "contentBeforeHere = false;",
  },
  {
    name: 'round11: detached declarations are surfaced as warnings',
    file: TARGETS.parser,
    from: "warnings.push({",
    to: "[].push({",
  },
  {
    name: 'round11: warnings reach the gate output',
    file: TARGETS.data,
    from: "const warnLines = warnings.map((w) => `  ⚠ ${w.message}`);",
    to: "const warnLines = [];",
  },
];

const backups = new Map();
for (const file of Object.values(TARGETS)) {
  // Backups go outside the repo: package.json publishes lib/ and commands/
  // wholesale, so a stray .bak beside its source ships to npm.
  const backup = path.join(tmpdir(), `cp32-${path.basename(file)}.mutbak`);
  copyFileSync(file, backup);
  backups.set(file, backup);
}

const restore = () => {
  for (const [file, backup] of backups) copyFileSync(backup, file);
};

let survived = 0;

for (const m of MUTATIONS) {
  restore();
  const before = readFileSync(m.file, 'utf8');

  if (!before.includes(m.from)) {
    console.log(`SKIP  ${m.name}\n      target string not found — mutation proves nothing`);
    survived++;
    continue;
  }

  const after = before.replace(m.from, m.to);
  writeFileSync(m.file, after);

  // Print the actual change: a mutation that silently failed to apply reads as
  // "test survived" and hides a real hole (CP-15 pitfall).
  const changedLine = after.split('\n').findIndex((l, i) => l !== before.split('\n')[i]);
  console.log(`\n--- ${m.name}`);
  console.log(`    file: ${m.file}  line ~${changedLine + 1}`);

  let killed = false;
  try {
    execSync('node --test test/query-outputs.test.mjs test/data-command.test.mjs', {
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch {
    killed = true;
  }

  if (m.expectSurvive) {
    console.log(killed ? '    UNEXPECTED: control mutation was killed' : '    ok (control survived, as expected)');
  } else if (killed) {
    console.log('    KILLED — a test catches this');
  } else {
    console.log('    SURVIVED — nothing catches this');
    survived++;
  }
}

restore();
for (const backup of backups.values()) {
  try { execSync(`node -e "require('fs').unlinkSync('${backup.replace(/\\/g, '/')}')"`); } catch { /* leave it */ }
}

console.log(`\n${MUTATIONS.filter((m) => !m.expectSurvive).length} real mutations, ${survived} survived`);
