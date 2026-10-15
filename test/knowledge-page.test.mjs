import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { knowledgeCommand } from '../commands/knowledge.mjs';
import { renderKnowledgePage } from '../lib/knowledge-page.mjs';

function makeProject({ components, decided = {}, knowledge = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-page-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'npm test' }));

  if (knowledge) {
    mkdirSync(path.join(root, '.knowledge', 'derived'), { recursive: true });
    mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });
    if (components !== undefined) {
      const body = typeof components === 'string' ? components : JSON.stringify(components, null, 2);
      writeFileSync(path.join(root, '.knowledge', 'derived', 'components.json'), body);
    }
    for (const [name, body] of Object.entries(decided)) {
      writeFileSync(path.join(root, '.knowledge', 'decided', name), body);
    }
  }
  return root;
}

const pageFile = (root) => path.join(root, '.knowledge', 'derived', 'index.html');
const readPage = (root) => readFileSync(pageFile(root), 'utf8');

test('CP-67-H1 --page writes index.html into derived', () => {
  const root = makeProject({ components: { Button: { path: 'src/Button.jsx', props: {}, confident: true, usedIn: 2 } } });

  const result = knowledgeCommand({ cwd: root, page: true });
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(existsSync(pageFile(root)));
});

test('CP-67-H2 a component name, path and props appear in the page', () => {
  const root = makeProject({
    components: {
      Button: { path: 'src/Button.jsx', props: { label: 'string', onClick: 'func' }, confident: true, usedIn: 3 },
    },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root);
  assert.match(html, /Button/);
  assert.match(html, /src\/Button\.jsx/);
  assert.match(html, /label/);
  assert.match(html, /onClick/);
});

test('CP-67-H3 decided documents appear in the page', () => {
  const root = makeProject({
    components: {},
    decided: {
      'conventions.md': '# Quy ước\n\nKhông hardcode màu.',
      'pitfalls.md': '# Bẫy\n\nGate đỏ khi thiếu git.',
    },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root);
  assert.match(html, /Quy ước/);
  assert.match(html, /Bẫy/);
  assert.match(html, /Không hardcode màu/);
});

test('CP-67-H4 an unconfident component is marked in text, not only by class', () => {
  const root = makeProject({
    components: {
      Mystery: { path: 'src/Mystery.jsx', props: {}, confident: false, usedIn: 1 },
      Clear: { path: 'src/Clear.jsx', props: {}, confident: true, usedIn: 1 },
    },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root).replace(/class="[^"]*"/g, '');
  assert.match(html, /Mystery/);
  assert.match(html, /không đọc được|đừng tin|không chắc/i);
});

test('CP-67-H5 the page references nothing over the network', () => {
  const root = makeProject({
    components: { Button: { path: 'src/Button.jsx', props: {}, confident: true, usedIn: 1 } },
    decided: { 'conventions.md': '# Quy ước' },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root);
  assert.ok(!/src\s*=\s*["']https?:/i.test(html), 'không được có script ngoài');
  assert.ok(!/href\s*=\s*["']https?:/i.test(html), 'không được có stylesheet/link ngoài');
  assert.ok(!/@import\s+url\(\s*["']?https?:/i.test(html), 'không được import font ngoài');
});

test('CP-67-V1 a project with no .knowledge writes nothing', () => {
  const root = makeProject({ knowledge: false });

  const result = knowledgeCommand({ cwd: root, page: true });
  assert.equal(result.exitCode, 0);
  assert.ok(!existsSync(pageFile(root)));
});

test('CP-67-V2 decided present but no scan yet still produces a page', () => {
  const root = makeProject({ decided: { 'conventions.md': '# Quy ước\n\nMột luật.' } });

  const result = knowledgeCommand({ cwd: root, page: true });
  assert.equal(result.exitCode, 0, result.output);
  const html = readPage(root);
  assert.match(html, /Quy ước/);
  assert.match(html, /chưa chạy|chưa sinh/i);
});

test('CP-67-V3 an empty component set says so', () => {
  const root = makeProject({ components: {} });

  assert.equal(knowledgeCommand({ cwd: root, page: true }).exitCode, 0);
  assert.match(readPage(root), /không có component|chưa có component/i);
});

test('CP-67-E1 malformed components.json is refused without a partial page', () => {
  const root = makeProject({ components: '{ not json' });

  const result = knowledgeCommand({ cwd: root, page: true });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /components\.json/);
  assert.ok(!existsSync(pageFile(root)), 'không được để lại trang dở');
});

test('CP-67-E2 an unwritable derived directory is reported, not thrown', () => {
  const root = makeProject({ components: {} });

  // Thay thư mục `derived/` bằng một file: ghi vào đó chắc chắn hỏng trên cả
  // Windows lẫn Linux, còn chmod thì người chạy với quyền admin vẫn ghi được.
  rmSync(path.join(root, '.knowledge', 'derived'), { recursive: true, force: true });
  writeFileSync(path.join(root, '.knowledge', 'derived'), 'không phải thư mục');

  const result = knowledgeCommand({ cwd: root, page: true });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /index\.html|không ghi được/i);
});

test('CP-67-EC5 --page after --sync lists exactly what the scan wrote', () => {
  const root = makeProject({ knowledge: false });

  // Một component thật trên đĩa, để lần quét có cái mà tìm.
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'Badge.jsx'),
    'export function Badge({ tone, children }) {\n  return <span className={tone}>{children}</span>;\n}\n'
  );
  mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });

  assert.equal(knowledgeCommand({ cwd: root, sync: true }).exitCode, 0);
  assert.equal(knowledgeCommand({ cwd: root, page: true }).exitCode, 0);

  const written = JSON.parse(
    readFileSync(path.join(root, '.knowledge', 'derived', 'components.json'), 'utf8')
  );
  const html = readPage(root);
  for (const name of Object.keys(written)) {
    assert.match(html, new RegExp(name), `trang thiếu component ${name}`);
  }
  assert.match(html, /Component \(/);
});

test('CP-67-EC1 angle brackets in a component name are escaped', () => {
  const root = makeProject({
    components: { '<img onerror=alert(1)>': { path: 'src/X.jsx', props: {}, confident: true, usedIn: 0 } },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root);
  assert.ok(!html.includes('<img onerror'), 'thẻ thô không được lọt vào trang');
  assert.match(html, /&lt;img/);
});

test('CP-67-EC2 a closing script sequence in a prop is escaped', () => {
  const root = makeProject({
    components: {
      Button: { path: 'src/Button.jsx', props: { evil: '</script><script>alert(1)</script>' }, confident: true, usedIn: 1 },
    },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root);
  assert.ok(!/<\/script><script>/.test(html), 'chuỗi đóng script không được giữ nguyên');
});

test('CP-67-EC3 markdown tables and fences survive as text', () => {
  const root = makeProject({
    components: {},
    decided: { 'conventions.md': '# Quy ước\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1 < 2;\n```\n' },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root);
  assert.match(html, /const x = 1 &lt; 2/);
});

test('CP-67-EC4 two identical runs produce identical bytes', () => {
  const root = makeProject({
    components: { Button: { path: 'src/Button.jsx', props: { a: 'string' }, confident: true, usedIn: 1 } },
    decided: { 'conventions.md': '# Quy ước' },
  });

  knowledgeCommand({ cwd: root, page: true });
  const first = readPage(root);
  knowledgeCommand({ cwd: root, page: true });
  assert.equal(readPage(root), first);
});

test('CP-67-S1 an absolute path outside the project is shown as text, not linked', () => {
  const root = makeProject({
    components: { Leak: { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts', props: {}, confident: true, usedIn: 0 } },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root);
  assert.ok(!/href\s*=\s*["']file:/i.test(html), 'không được tạo link file:// ra ngoài');
  assert.ok(!/href\s*=\s*["'][A-Za-z]:\\/.test(html), 'không được link đường dẫn tuyệt đối');
});

test('CP-67-S2 a prop named like an event handler renders as text', () => {
  const root = makeProject({
    components: { Button: { path: 'src/Button.jsx', props: { 'onload=alert(1)': 'any' }, confident: true, usedIn: 1 } },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root);
  assert.ok(!/<[^>]*\sonload\s*=/i.test(html), 'không được thành attribute thật');
  assert.match(html, /onload/);
});

test('CP-67-S3 a raw script block inside a decided file is escaped', () => {
  const root = makeProject({
    components: {},
    decided: { 'pitfalls.md': '# Bẫy\n\n<script>alert(1)</script>\n' },
  });

  knowledgeCommand({ cwd: root, page: true });
  const html = readPage(root);
  assert.ok(!/<script>alert\(1\)<\/script>/.test(html), 'script của tài liệu không được chạy');
  assert.match(html, /&lt;script&gt;/);
});

test('CP-67-H6 renderKnowledgePage is pure: it returns html and writes nothing', () => {
  const html = renderKnowledgePage({
    components: { Button: { path: 'src/Button.jsx', props: {}, confident: true, usedIn: 1 } },
    decided: [],
    scanned: true,
  });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Button/);
});

test('CP-67-R1 --page does not change what the plain gate returns', () => {
  const root = makeProject({ components: {} });

  const plain = knowledgeCommand({ cwd: root });
  const afterPage = (knowledgeCommand({ cwd: root, page: true }), knowledgeCommand({ cwd: root }));
  assert.equal(afterPage.exitCode, plain.exitCode);
});
