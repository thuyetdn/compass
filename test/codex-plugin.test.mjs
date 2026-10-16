import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// CP-76 — Compass cài vào Codex như một plugin, như bên Claude Code. Hình dạng
// hai file khai báo chép từ một plugin Codex thật sự cài được (superpowers),
// và đã cài thử bằng `codex plugin marketplace add` + `codex plugin add` trong
// một CODEX_HOME tạm. Các test dưới giữ ba bản khai báo nói cùng một điều.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const codex = () => json('.codex-plugin/plugin.json');
const market = () => json('.agents/plugins/marketplace.json');
const claude = () => json('.claude-plugin/plugin.json');
const pkg = () => json('package.json');
const skill = () => readFileSync(path.join(ROOT, 'skills', 'compass', 'SKILL.md'), 'utf8');

test('CP-76-H1 the Codex plugin manifest exists and names compass', () => {
  assert.ok(existsSync(path.join(ROOT, '.codex-plugin', 'plugin.json')), 'thiếu .codex-plugin/plugin.json');
  assert.equal(codex().name, 'compass');
});

test('CP-76-H2 the declared skills path holds the compass skill', () => {
  assert.equal(codex().skills, './skills/');
  assert.ok(existsSync(path.join(ROOT, 'skills', 'compass', 'SKILL.md')), 'skills/compass/SKILL.md phải có');
});

test('CP-76-H3 the marketplace lists compass from the repo root', () => {
  const entry = market().plugins.find((p) => p.name === 'compass');
  assert.ok(entry, 'marketplace.json không liệt kê plugin compass');
  assert.deepEqual(entry.source, { source: 'url', url: './' });
});

test('CP-76-H4 every manifest carries the same version', () => {
  const v = pkg().version;
  assert.equal(claude().version, v, '.claude-plugin lệch phiên bản');
  assert.equal(codex().version, v, '.codex-plugin lệch phiên bản');
});

test('CP-76-H5 SKILL.md points Codex at the CLI that came with the plugin', () => {
  const text = skill();
  assert.match(text, /\.\.\/\.\.\/cli\.mjs/, 'SKILL.md phải chỉ đường ../../cli.mjs cho Codex');
  // Đường tương đối đó phải thật sự tới cli.mjs khi đứng ở thư mục skill.
  const resolved = path.resolve(ROOT, 'skills', 'compass', '..', '..', 'cli.mjs');
  assert.equal(resolved, path.join(ROOT, 'cli.mjs'));
  assert.ok(existsSync(resolved));
});

test('CP-76-V1 description, licence and author agree across manifests', () => {
  const c = codex();
  assert.equal(c.description, pkg().description);
  assert.equal(c.description, claude().description);
  assert.equal(c.license, pkg().license);
  assert.equal(c.author?.name, claude().author?.name);
  assert.equal(c.author?.name, pkg().author);
});

test('CP-76-V2 the README gives the two Codex install commands', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const section = readme.match(/## [^\n]*Codex[^\n]*\n([\s\S]*?)(?=\n## )/);
  assert.ok(section, 'README thiếu mục Codex');
  assert.match(section[1], /codex plugin marketplace add thuyetdn\/compass/);
  assert.match(section[1], /codex plugin add compass@compass/);
});

test('CP-76-V3 the marketplace entry name equals the plugin name', () => {
  const names = market().plugins.map((p) => p.name);
  assert.deepEqual(names, [codex().name]);
});

test('CP-76-V4 homepage and repository point at the project', () => {
  const c = codex();
  assert.match(c.repository, /^https:\/\/github\.com\/thuyetdn\/compass/);
  assert.match(c.homepage, /^https:\/\/(github\.com\/thuyetdn\/compass|thuyetdn\.github\.io\/compass)/);
});

test('CP-76-E1 SKILL.md gives a fallback when the CLI cannot be found', () => {
  assert.match(skill(), /npm install -g github:thuyetdn\/compass/);
});

test('CP-76-EC1 both harnesses know the plugin by the same name', () => {
  assert.equal(codex().name, claude().name);
  assert.equal(market().name, 'compass', 'marketplace tên compass để id là compass@compass');
});

test('CP-76-EC2 the Codex interface block names and files the plugin', () => {
  const ui = codex().interface;
  assert.equal(ui.displayName, 'Compass');
  assert.equal(ui.category, 'Developer Tools');
});

test('CP-76-S1 installing the plugin starts nothing', () => {
  const c = codex();
  for (const key of ['hooks', 'mcpServers', 'apps']) {
    const value = c[key];
    const empty = value === undefined || (typeof value === 'object' && Object.keys(value).length === 0);
    assert.ok(empty, `.codex-plugin khai ${key} — cài plugin không được chạy gì`);
  }
});
