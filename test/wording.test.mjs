import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CP-39 — readers hear "kiểm" and "ca" as clipped words. Every Vietnamese text a
// reader sees says "kiểm tra" and "case". Complete words built on "kiểm" stay.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A bare "kiểm" is one not followed by a syllable that completes a real word.
const CLIPPED_KIEM = /[kK]iểm(?! tra| chứng| soát| định| duyệt| toán| kê|\(\?)/gu;
// "ca" standing alone, not inside "cách", "cả", "các". Sentence-initial "Ca" counts too —
// a review caught one at SKILL.md:495 that a lowercase-only pattern let through.
const STANDALONE_CA = /(?<![\p{L}\p{N}])[cC]a(?![\p{L}\p{N}])/gu;

const DOCS = ['SKILL.md', 'writing-vi.md', 'README.md', '.knowledge/decided/pitfalls.md'];
const TEMPLATE = 'templates/investigation.md';

const listMjs = (dir) => readdirSync(path.join(ROOT, dir))
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => path.posix.join(dir, f));

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const hits = (text, re) => {
  const out = [];
  text.split('\n').forEach((line, i) => { if (re.test(line)) out.push(`${i + 1}: ${line.trim()}`); re.lastIndex = 0; });
  return out;
};

const assertClean = (rel, re, label) => {
  const found = hits(read(rel), re);
  assert.deepEqual(found, [], `${rel} còn ${found.length} chỗ "${label}":\n${found.slice(0, 5).join('\n')}`);
};

test('CP-39-H6 the investigation template uses the full-word keyword and no clipped words', () => {
  const text = read(TEMPLATE);
  assert.match(text, /\*\*Cách kiểm tra:\*\*/);
  assertClean(TEMPLATE, CLIPPED_KIEM, 'kiểm');
  assertClean(TEMPLATE, STANDALONE_CA, 'ca');
});

test('CP-39-H7 the four reader docs contain no clipped "kiểm"', () => {
  for (const f of DOCS) assertClean(f, CLIPPED_KIEM, 'kiểm');
});

test('CP-39-H8 the four reader docs contain no standalone "ca"', () => {
  for (const f of DOCS) assertClean(f, STANDALONE_CA, 'ca');
});

test('CP-39-H9 every module under lib/ and commands/ is free of both words', () => {
  for (const f of [...listMjs('lib'), ...listMjs('commands')]) {
    assertClean(f, CLIPPED_KIEM, 'kiểm');
    assertClean(f, STANDALONE_CA, 'ca');
  }
});

test('CP-39-EC2 complete words built on "kiểm" are not flagged', () => {
  const sample = 'kiểm chứng kiểm soát kiểm định kiểm duyệt kiểm toán kiểm kê kiểm tra kiểm(?: tra)?';
  assert.deepEqual(hits(sample, CLIPPED_KIEM), []);
});

test('CP-39-EC3 "ca" inside another word is not flagged, standalone "ca" is', () => {
  const sample = 'cách cả các ca, ca. ca';
  assert.equal((sample.match(STANDALONE_CA) ?? []).length, 3);
  assert.equal(('cách cả các'.match(STANDALONE_CA) ?? []).length, 0);
  assert.equal(('Ca nguy hiểm nhất. Cách khác.'.match(STANDALONE_CA) ?? []).length, 1, 'sentence-initial Ca');
  assert.equal(('Kiểm xem. Kiểm tra xong.'.match(CLIPPED_KIEM) ?? []).length, 1, 'sentence-initial Kiểm');
});

test('CP-39-EC4 writing-vi.md keeps its 53 ❌ examples — pairs were rewritten, not dropped', () => {
  const text = read('writing-vi.md');
  assert.equal((text.match(/^> ❌/gmu) ?? []).length, 53);
});

test('CP-39-EC6 an uppercase heading like "KIỂM TRA" is not flagged', () => {
  assert.deepEqual(hits('## KIỂM TRA\nKIỂM', CLIPPED_KIEM), []);
});

test('CP-39-S2 the guard reads only the files the spec names — never evidence or dated notes', () => {
  const scanned = [TEMPLATE, ...DOCS, ...listMjs('lib'), ...listMjs('commands')];
  for (const f of scanned) {
    assert.ok(!f.startsWith('.compass/'), `${f} là bằng chứng, không quét`);
    assert.ok(!f.startsWith('docs/superpowers/'), `${f} là ghi chép có ngày, không quét`);
  }
  const spec = read('.compass/CP-39/spec.md');
  const scopeLine = spec.match(/^Phạm vi:\s*(.+)$/mu)?.[1] ?? '';
  assert.ok(scopeLine, 'spec CP-39 phải có dòng Phạm vi');
  const scope = scopeLine.split(',').map((s) => s.trim());
  for (const f of [TEMPLATE, ...DOCS]) assert.ok(scope.includes(f), `${f} không nằm trong Phạm vi của spec`);
  for (const f of [...listMjs('lib'), ...listMjs('commands')]) {
    assert.match(f, /^(lib|commands)\/[^/]+\.mjs$/, `${f} không nằm ngay dưới lib/ hay commands/`);
  }
});

test('CP-39-P1 scanning every in-scope file takes under 500 ms', () => {
  const files = [TEMPLATE, ...DOCS, ...listMjs('lib'), ...listMjs('commands')];
  const t0 = performance.now();
  for (const f of files) { hits(read(f), CLIPPED_KIEM); hits(read(f), STANDALONE_CA); }
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `scan took ${ms.toFixed(0)} ms over ${files.length} files`);
});
