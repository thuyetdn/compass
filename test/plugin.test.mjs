import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Skill nằm một chỗ duy nhất: `skills/compass/`. Plugin Claude Code nạp thẳng
// từ đó, và npm cũng đóng gói đúng thư mục ấy — hai kênh phát hành, một bản
// nội dung, nên không có bản sao nào để trôi. Suite này canh phần còn lại:
// manifest hợp lệ, frontmatter Claude đọc được, và không có link gãy.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const json = (rel) => JSON.parse(read(rel));

test('CP-43-H1 the plugin manifests are valid JSON and name the plugin compass', () => {
  const plugin = json('.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'compass', 'tên plugin phải là compass');
  assert.ok(plugin.version, 'thiếu version — Claude Code không cài được');

  const market = json('.claude-plugin/marketplace.json');
  const entry = market.plugins.find((p) => p.name === 'compass');
  assert.ok(entry, 'marketplace.json không khai plugin compass');
  assert.equal(entry.version, plugin.version,
    'version ở marketplace.json lệch plugin.json — người cài nhận bản sai');
});

test('CP-43-H2 the skill the plugin ships carries frontmatter Claude Code can read', () => {
  const text = read('skills/compass/SKILL.md');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(fm, 'SKILL.md của plugin không có frontmatter — skill sẽ không hiện');
  assert.match(fm[1], /^name:\s*compass\s*$/m, 'frontmatter thiếu `name: compass`');
  assert.match(fm[1], /^description:\s*\S/m,
    'frontmatter thiếu description — Claude không biết lúc nào nên dùng skill');
});

test('CP-43-H3 the skill ships the writing guide it tells the agent to read', () => {
  // SKILL.md trỏ sang references/writing-vi.md. Thiếu file đó thì agent đọc
  // vào chỗ trống mà gate nào cũng xanh — hỏng im lặng.
  const ref = 'skills/compass/references/writing-vi.md';
  assert.ok(existsSync(path.join(ROOT, ref)),
    `SKILL.md trỏ tới ${ref} nhưng file không có`);
  assert.match(read('skills/compass/SKILL.md'), /\]\(references\/writing-vi\.md\)/,
    'SKILL.md không còn trỏ tới hướng dẫn viết — bỏ link thì không ai đọc nó nữa');
});

test('CP-43-H5 every relative link in the shipped skill resolves inside the plugin', () => {
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

test('CP-43-H6 the manifests stay in English — they are release metadata, not skill content', () => {
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

test('CP-43-H7 the skill frontmatter stays Vietnamese so it triggers on Vietnamese prompts', () => {
  // Mặt kia của H6. Đổi description sang tiếng Anh thì skill khớp kém hẳn khi
  // người dùng gõ tiếng Việt — hỏng âm thầm, không ai thấy lỗi.
  const CO_DAU = /[À-ɏḀ-ỿ]/u;
  for (const rel of ['skills/compass/SKILL.md']) {
    const fm = read(rel).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    const desc = fm[1].match(/^description:\s*(.+)$/m);
    assert.ok(desc, `${rel} thiếu description`);
    assert.ok(CO_DAU.test(desc[1]),
      `${rel} description mất tiếng Việt — skill sẽ khó khớp với prompt tiếng Việt`);
  }
});

test('CP-43-H8 the command the skill tells the agent to run exists at the plugin root', () => {
  // Skill bảo gõ `node "${CLAUDE_PLUGIN_ROOT}/cli.mjs"`. Plugin khai
  // `source: "./"` nên plugin root là gốc repo — dòng đó chỉ đúng chừng nào
  // cli.mjs còn nằm ở đấy. Dời file đi mà quên sửa skill thì agent gõ vào chỗ
  // trống, và không test nào khác bắt được.
  const skill = read('skills/compass/SKILL.md');
  const goi = skill.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'`\s)]+)/g) ?? [];
  assert.ok(goi.length, 'skill không còn nói cách gọi CLI qua ${CLAUDE_PLUGIN_ROOT}');

  const source = json('.claude-plugin/marketplace.json').plugins
    .find((p) => p.name === 'compass').source;
  assert.equal(source, './',
    'plugin root không còn là gốc repo — mọi đường dẫn ${CLAUDE_PLUGIN_ROOT} trong skill phải tính lại');

  for (const m of goi) {
    const rel = m.replace('${CLAUDE_PLUGIN_ROOT}/', '');
    assert.ok(existsSync(path.join(ROOT, rel)),
      `skill gọi ${m} nhưng ${rel} không có ở gốc repo`);
  }
});
