import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CP-57 — the guide forbids rewriting that adds facts, so its own ❌ → ✅ pairs must not
// add any. And SKILL.md tells the reader how many pairs there are; that number has to be true.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const GUIDE = read('skills/compass/references/writing-vi.md');
const SECTION = '### Xếp lại thứ tự, đừng chỉ cắt';

// Lines of one section, from its heading to the next heading of the same or higher level.
function sectionLines(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `không thấy mục "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3} /.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

// A pair is a quoted block: lines from `> ❌` up to `> ✅` are the draft, the quoted lines
// after it are the rewrite.
function pairs(lines) {
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('> ❌')) { cur = { bad: [], good: [], side: 'bad' }; out.push(cur); }
    else if (!line.startsWith('>')) { cur = null; continue; }
    if (!cur) continue;
    if (line.startsWith('> ✅')) cur.side = 'good';
    cur[cur.side].push(line.replace(/^(>\s?)+/, '').replace(/^[❌✅]\s*/u, ''));
  }
  return out;
}

const digits = (text) => text.match(/\d+/g) ?? [];

// Capitalised words that are not the first word of a sentence, bullet or bold run.
function properNames(text) {
  const names = [];
  for (const piece of text.split(/[.!?:—]\s+|\*\*|^\s*-\s+/mu)) {
    const words = piece.trim().split(/[\s,;()]+/u).filter(Boolean);
    for (const w of words.slice(1)) if (/^\p{Lu}/u.test(w)) names.push(w.replace(/[^\p{L}\p{N}]+$/u, ''));
  }
  return names;
}

const found = pairs(sectionLines(GUIDE, SECTION));

test('CP-57-H1 SKILL.md states the real number of ❌ → ✅ pairs in writing-vi.md', () => {
  const claim = read('skills/compass/SKILL.md').match(/(\d+) cặp câu/u);
  assert.ok(claim, 'SKILL.md không còn câu "<n> cặp câu"');
  const actual = (GUIDE.match(/^> ❌/gmu) ?? []).length;
  assert.equal(Number(claim[1]), actual);
});

test('CP-57-H2 every number in a rewrite of "Xếp lại thứ tự" already appears in its draft', () => {
  assert.ok(found.length > 0, 'không đọc được cặp câu nào trong mục');
  for (const [i, p] of found.entries()) {
    const bad = new Set(digits(p.bad.join(' ')));
    const added = digits(p.good.join(' ')).filter((d) => !bad.has(d));
    assert.deepEqual(added, [], `cặp ${i + 1}: ✅ có số mà ❌ không có`);
  }
});

test('CP-57-H3 every proper name in a rewrite of "Xếp lại thứ tự" already appears in its draft', () => {
  for (const [i, p] of found.entries()) {
    const bad = p.bad.join(' ');
    const added = properNames(p.good.join('\n')).filter((n) => !bad.includes(n));
    assert.deepEqual(added, [], `cặp ${i + 1}: ✅ có tên mà ❌ không có`);
  }
});
