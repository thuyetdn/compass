import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TASK_TYPES, rulesFor } from '../lib/task-types.mjs';

// CP-75 — đội dùng Codex không nạp được skill của Claude Code. Codex đọc
// AGENTS.md, nên Compass mang sẵn một đoạn AGENTS.md để dán vào dự án. Đoạn đó
// chép một phần SKILL.md và bảng loại task; các test dưới giữ phần chép bằng
// nguồn của nó, vì một bản chép không ai canh là một bản sẽ lệch.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(ROOT, 'templates', 'AGENTS.md');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const template = () => readFileSync(TEMPLATE, 'utf8');

test('CP-75-H1 the AGENTS.md template exists', () => {
  assert.ok(existsSync(TEMPLATE), 'thiếu templates/AGENTS.md');
  assert.match(template(), /^#{1,2} .*Compass/m, 'đoạn mẫu phải mở bằng một heading nói về Compass');
});

test('CP-75-H2 every command the template names is one the CLI dispatches', () => {
  const cli = read('cli.mjs');
  const dispatched = new Set([...cli.matchAll(/^\s*case\s+'([a-z-]+)'\s*:/gm)].map((m) => m[1]));
  const named = [...template().matchAll(/(?<![\w/-])compass[ \t]+([a-z][a-z-]*)/g)].map((m) => m[1]);
  assert.ok(named.length >= 4, 'đoạn mẫu phải chỉ đủ các lệnh của vòng đời task');
  const unknown = [...new Set(named.filter((c) => !dispatched.has(c)))];
  assert.deepEqual(unknown, [], `đoạn mẫu nhắc lệnh cli.mjs không có: ${unknown.join(', ')}`);
});

test('CP-75-H3 the rules an agent must not break match SKILL.md', () => {
  const skill = read('skills/compass/SKILL.md');
  const section = skill.match(/## Luật tối cao\n([\s\S]*?)\n## /);
  assert.ok(section, 'SKILL.md không còn mục Luật tối cao');
  const rules = [...section[1].matchAll(/^\d+\. \*\*(.+?)\*\*/gm)].map((m) => m[1]);
  assert.equal(rules.length, 5, 'SKILL.md đổi số luật — cập nhật đoạn mẫu theo');
  for (const rule of rules) {
    assert.ok(template().includes(rule), `đoạn mẫu thiếu luật: ${rule}`);
  }
});

test('CP-75-H4 the task-type table equals lib/task-types.mjs', () => {
  const rows = new Map();
  for (const m of template().matchAll(/^\| `([a-z-]+)` \|[^|]*\| (\d+) \| ([^|]+) \|$/gm)) {
    rows.set(m[1], { min: Number(m[2]), layers: m[3].trim() });
  }
  assert.deepEqual([...rows.keys()], TASK_TYPES, 'bảng phải có đúng các loại task, đúng thứ tự');
  for (const type of TASK_TYPES) {
    const rule = rulesFor(type);
    assert.equal(rows.get(type).min, rule.minTests, `${type}: số test tối thiểu lệch`);
    assert.equal(rows.get(type).layers, rule.requiredLayers.join(', '), `${type}: lớp bắt buộc lệch`);
  }
});

test('CP-75-H5 the README tells a Codex team how to start', () => {
  const readme = read('README.md');
  const section = readme.match(/## [^\n]*Codex[^\n]*\n([\s\S]*?)(?=\n## )/);
  assert.ok(section, 'README thiếu mục cho Codex');
  assert.match(section[1], /npm install -g github:thuyetdn\/compass/);
  assert.match(section[1], /templates\/AGENTS\.md/);

  // Windows PowerShell 5.1 đọc UTF-8 không BOM theo bảng mã ANSI: thiếu cờ là
  // "Quy trình" thành "Quy trÃ¬nh" trong AGENTS.md của người dùng. Đã đo.
  const ps = section[1].match(/Get-Content[^\n]*Add-Content[^\n]*/);
  assert.ok(ps, 'mục Codex phải có lệnh PowerShell');
  assert.equal((ps[0].match(/-Encoding utf8/g) ?? []).length, 2, 'cả Get-Content lẫn Add-Content phải khai -Encoding utf8');
});

test('CP-75-V1 the template carries no Claude-only instruction', () => {
  const text = template();
  for (const bad of ['CLAUDE_PLUGIN_ROOT', '/plugin', 'Skill tool', 'Agent tool', 'subagent']) {
    assert.ok(!text.includes(bad), `đoạn mẫu có chỉ dẫn chỉ Claude Code hiểu: ${bad}`);
  }
});

test('CP-75-V2 npm ships the template', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const files = JSON.parse(out)[0].files.map((f) => f.path.replace(/\\/g, '/'));
  assert.ok(files.includes('templates/AGENTS.md'), 'bản cài thiếu templates/AGENTS.md');
});

test('CP-75-V3 the install command matches the package', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.bin && pkg.bin.compass, 'package.json phải khai bin compass');
  assert.match(pkg.repository.url, /github\.com\/thuyetdn\/compass/);
});

test('CP-75-E1 the template stops the agent for approval after the spec gate', () => {
  const text = template();
  assert.match(text, /compass spec/);
  assert.match(text, /DỪNG/, 'phải nói rõ là dừng');
  assert.match(text, /duyệt/);
});

test('CP-75-E2 the template sends a red gate back to fixing, never to a report', () => {
  const text = template();
  assert.match(text, /đỏ/);
  assert.match(text, /chạy lại/);
  assert.match(text, /compass done/);
});

test('CP-75-EC1 the template explains naming tests with the task id', () => {
  assert.match(template(), /CP-12-H1/, 'phải có ví dụ tên test kèm task id');
});

test('CP-75-EC2 the template sends the review brief to a separate session', () => {
  const text = template();
  assert.match(text, /review-brief\.md/);
  assert.match(text, /phiên( \S+)? (mới|khác)/);
  assert.match(text, /lịch sử chat/);
});

test('CP-75-S1 the template forbids touching the evidence', () => {
  const text = template();
  assert.match(text, /evidence\//);
  assert.match(text, /gate\.json/);
});
