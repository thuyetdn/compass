// Trang xem knowledge: một file HTML tự chứa, mở bằng trình duyệt, không cần
// cài gì và không gọi mạng.
//
// Hai thứ trang này làm mà ba file rời không làm được. Nó đặt tài liệu người
// viết cạnh kết quả máy quét, nên không ai phải nhớ mở `components.json` song
// song với `conventions.md`. Và nó in cảnh báo `confident: false` ngay cạnh
// component — đúng lúc người đọc đang định tin vào danh sách prop đó.
//
// Mọi giá trị trong trang đều đến từ file nguồn của dự án đích: tên component,
// đường dẫn, tên prop. Đó là text không ai kiểm duyệt, nên tất cả đi qua
// `escapeHtml` trước khi vào markup. Một dự án có component tên
// `<img onerror=...>` phải ra chữ, không ra thẻ.

// Năm ký tự, một lượt. Dấu nháy cũng escape: trang này chỉ nhúng text vào thân
// thẻ, nhưng một lần sửa sau có thể đặt nó vào attribute, và lúc đó thiếu nháy
// là lỗ XSS.
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// CSS nhúng thẳng, không font ngoài: trang phải mở được khi máy không có mạng.
// Hai bộ màu, theo `prefers-color-scheme`, vì người đọc code thường để tối.
const STYLE = `
:root {
  --bg: #fbfbfa; --fg: #1a1a18; --muted: #6b6b66; --line: #e3e3df;
  --card: #ffffff; --warn-bg: #fff8e6; --warn-fg: #7a5b00; --warn-line: #e8d9a8;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15151a; --fg: #e8e8e4; --muted: #9a9a93; --line: #2d2d35;
    --card: #1c1c22; --warn-bg: #2b2415; --warn-fg: #e8c86a; --warn-line: #4a3d1c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px 20px 64px; background: var(--bg); color: var(--fg);
  font: 15px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
.wrap { max-width: 860px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
.sub { color: var(--muted); font-size: 13px; margin: 0 0 32px; }
h2 { font-size: 16px; margin: 36px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.empty { color: var(--muted); font-style: italic; }
.card {
  background: var(--card); border: 1px solid var(--line); border-radius: 8px;
  padding: 14px 16px; margin: 0 0 10px;
}
.name { font-family: var(--mono); font-size: 14px; font-weight: 600; }
.path { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-top: 2px; word-break: break-all; }
.props { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
.props li {
  font-family: var(--mono); font-size: 12px; background: var(--bg);
  border: 1px solid var(--line); border-radius: 4px; padding: 2px 7px;
}
.meta { font-size: 12px; color: var(--muted); margin-top: 8px; }
.warn {
  background: var(--warn-bg); color: var(--warn-fg); border: 1px solid var(--warn-line);
  border-radius: 6px; padding: 8px 11px; margin-top: 10px; font-size: 13px;
}
pre {
  background: var(--card); border: 1px solid var(--line); border-radius: 8px;
  padding: 14px 16px; overflow-x: auto; font-family: var(--mono); font-size: 13px;
  line-height: 1.55; white-space: pre-wrap; word-break: break-word; margin: 0 0 16px;
}
`.trim();

function componentCard(name, info) {
  const props = Object.keys(info?.props ?? {});
  const lines = [
    '      <div class="card">',
    `        <div class="name">${escapeHtml(name)}</div>`,
    `        <div class="path">${escapeHtml(info?.path ?? '—')}</div>`,
  ];

  if (props.length) {
    lines.push('        <ul class="props">');
    for (const prop of props) lines.push(`          <li>${escapeHtml(prop)}</li>`);
    lines.push('        </ul>');
  } else {
    lines.push('        <div class="meta">Không có prop nào đọc được.</div>');
  }

  const usedIn = info?.usedIn;
  if (Number.isInteger(usedIn)) {
    lines.push(
      `        <div class="meta">${usedIn === 0 ? 'Không nơi nào dùng.' : `Dùng ở ${usedIn} chỗ.`}</div>`
    );
  }

  // Lời cảnh báo nằm trong text, không phải chỉ một class CSS: người đọc trang
  // bằng screen reader, hay copy phần này đi chỗ khác, vẫn phải thấy nó.
  if (info && info.confident === false) {
    lines.push(
      '        <div class="warn">Prop không đọc được hết — đừng tin danh sách này, mở file gốc ra xem.</div>'
    );
  }

  lines.push('      </div>');
  return lines.join('\n');
}

// Tài liệu người viết hiện nguyên văn trong `<pre>`, không render markdown.
// Lý do là an toàn chứ không phải lười: render markdown nghĩa là sinh HTML từ
// text của dự án đích, và một file `.md` chứa `<script>` sẽ chạy. Đọc markdown
// thô vẫn dễ, còn một trang XSS thì không sửa được bằng cách đọc kỹ.
function decidedSection(doc) {
  return [
    `      <h2>${escapeHtml(doc.name)}</h2>`,
    `      <pre>${escapeHtml(doc.text)}</pre>`,
  ].join('\n');
}

// Dựng trang. Hàm thuần: nhận dữ liệu, trả chuỗi, không đọc và không ghi file.
// Nhờ vậy test dựng được mọi trường hợp hiểm mà không cần bày ra thư mục thật.
export function renderKnowledgePage({ components, decided = [], scanned = true, generatedAt = null }) {
  const names = Object.keys(components ?? {}).sort((a, b) => a.localeCompare(b));
  const unsure = names.filter((n) => components[n]?.confident === false).length;

  const head = [
    '<!doctype html>',
    '<html lang="vi">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Knowledge — Compass</title>',
    `<style>\n${STYLE}\n</style>`,
    '</head>',
    '<body>',
    '  <div class="wrap">',
    '    <h1>Knowledge</h1>',
  ];

  const subtitle = generatedAt
    ? `Máy sinh lúc ${escapeHtml(generatedAt)}. Phần "decided" do người viết; phần component do máy quét.`
    : 'Phần "decided" do người viết; phần component do máy quét.';
  head.push(`    <p class="sub">${subtitle}</p>`);

  const body = [];

  if (decided.length) {
    for (const doc of decided) body.push(decidedSection(doc));
  } else {
    body.push('      <h2>Quyết định</h2>');
    body.push('      <p class="empty">Chưa có file nào trong .knowledge/decided/.</p>');
  }

  body.push(`      <h2>Component (${names.length})</h2>`);

  if (!scanned) {
    body.push('      <p class="empty">Máy quét chưa chạy lần nào — chạy: compass knowledge --sync</p>');
  } else if (names.length === 0) {
    body.push('      <p class="empty">Chưa có component nào được tìm thấy.</p>');
  } else {
    if (unsure) {
      body.push(
        `      <div class="warn">${unsure} component có prop không đọc được. Chỗ nào ghi "đừng tin" thì mở file gốc.</div>`
      );
    }
    for (const name of names) body.push(componentCard(name, components[name]));
  }

  return [...head, ...body, '  </div>', '</body>', '</html>', ''].join('\n');
}

export { escapeHtml };
