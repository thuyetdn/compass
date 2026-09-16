import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Plugin Claude Code nạp skill từ `skills/<tên>/`, còn npm đóng gói CLI từ gốc
// repo. Hai kênh phát hành khác nhau nên skill phải có mặt ở cả hai chỗ. Bản
// trong plugin là BẢN SAO — sửa một bên mà quên bên kia thì agent cài qua
// `/plugin` đọc hướng dẫn cũ mà không ai biết. Suite này khoá hai bản lại.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
// So sánh bỏ qua CRLF/LF: khác line-ending không phải là nội dung trôi.
const lines = (rel) => read(rel).replace(/\r\n/g, '\n').split('\n');

const json = (rel) => JSON.parse(read(rel));

test('CP-42-H1 the plugin manifests are valid JSON and name the plugin compass', () => {
  const plugin = json('.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'compass', 'tên plugin phải là compass');
  assert.ok(plugin.version, 'thiếu version — Claude Code không cài được');

  const market = json('.claude-plugin/marketplace.json');
  const entry = market.plugins.find((p) => p.name === 'compass');
  assert.ok(entry, 'marketplace.json không khai plugin compass');
  assert.equal(entry.version, plugin.version,
    'version ở marketplace.json lệch plugin.json — người cài nhận bản sai');
});

test('CP-42-H2 the skill the plugin ships carries frontmatter Claude Code can read', () => {
  const text = read('skills/compass/SKILL.md');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(fm, 'SKILL.md của plugin không có frontmatter — skill sẽ không hiện');
  assert.match(fm[1], /^name:\s*compass\s*$/m, 'frontmatter thiếu `name: compass`');
  assert.match(fm[1], /^description:\s*\S/m,
    'frontmatter thiếu description — Claude không biết lúc nào nên dùng skill');
});

test('CP-42-H3 the shipped skill matches the root SKILL.md apart from the reference link', () => {
  const root = lines('SKILL.md');
  const shipped = lines('skills/compass/SKILL.md');
  assert.equal(shipped.length, root.length,
    'hai bản SKILL.md lệch số dòng — một bên đã sửa mà bên kia chưa');

  const drift = [];
  for (let i = 0; i < root.length; i += 1) {
    if (root[i] === shipped[i]) continue;
    // Dòng duy nhất được phép khác: link tới writing-vi.md. Ở gốc repo file
    // nằm cạnh SKILL.md, trong plugin nó nằm ở references/.
    const chiKhacDuongDan = root[i].replace('](writing-vi.md)', '](references/writing-vi.md)');
    if (chiKhacDuongDan === shipped[i]) continue;
    drift.push(`${i + 1}:\n  gốc:    ${root[i]}\n  plugin: ${shipped[i]}`);
  }
  assert.deepEqual(drift, [],
    `SKILL.md trong plugin đã trôi khỏi bản gốc:\n${drift.join('\n')}`);
});

test('CP-42-H4 the skill ships the writing guide it tells the agent to read', () => {
  const ref = 'skills/compass/references/writing-vi.md';
  assert.ok(existsSync(path.join(ROOT, ref)),
    `SKILL.md trỏ tới ${ref} nhưng file không có — agent cài qua plugin đọc vào chỗ trống`);
  assert.deepEqual(lines(ref), lines('writing-vi.md'),
    'writing-vi.md trong plugin đã trôi khỏi bản gốc');
});

test('CP-42-H5 every relative link in the shipped skill resolves inside the plugin', () => {
  const text = read('skills/compass/SKILL.md');
  const treo = [];
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1];
    // Chỉ soi link tương đối tới file trong plugin — bỏ qua URL và anchor.
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const rel = path.posix.join('skills/compass', target.split('#')[0]);
    if (!existsSync(path.join(ROOT, rel))) treo.push(`${target} → không có ${rel}`);
  }
  assert.deepEqual(treo, [], `link gãy trong SKILL.md của plugin:\n${treo.join('\n')}`);
});

test('CP-42-H6 the manifests stay in English — they are release metadata, not skill content', () => {
  // Description trong manifest là thứ người duyệt marketplace và người cài đọc
  // trước khi biết plugin này dành cho ai, nên viết tiếng Anh. Khác với
  // frontmatter của SKILL.md: chỗ đó phải tiếng Việt vì Claude đọc nó để đoán
  // lúc nào người dùng gõ tiếng Việt cần tới skill.
  const CO_DAU = /[À-ɏḀ-ỿ]/u;
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    const text = read(rel);
    const dinh = [];
    text.split('\n').forEach((line, i) => {
      if (CO_DAU.test(line)) dinh.push(`${i + 1}: ${line.trim()}`);
    });
    assert.deepEqual(dinh, [],
      `${rel} còn chữ có dấu — manifest phải viết tiếng Anh:\n${dinh.join('\n')}`);
  }
});

test('CP-42-H7 the skill frontmatter stays Vietnamese so it triggers on Vietnamese prompts', () => {
  // Mặt kia của H6. Đổi description sang tiếng Anh thì skill khớp kém hẳn khi
  // người dùng gõ tiếng Việt — hỏng âm thầm, không ai thấy lỗi.
  const CO_DAU = /[À-ɏḀ-ỿ]/u;
  for (const rel of ['SKILL.md', 'skills/compass/SKILL.md']) {
    const fm = read(rel).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    const desc = fm[1].match(/^description:\s*(.+)$/m);
    assert.ok(desc, `${rel} thiếu description`);
    assert.ok(CO_DAU.test(desc[1]),
      `${rel} description mất tiếng Việt — skill sẽ khó khớp với prompt tiếng Việt`);
  }
});
