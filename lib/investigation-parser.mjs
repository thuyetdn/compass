import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// An investigation is closed on evidence, not on a story. This parser is what
// lets the machine tell one from the other: a hypothesis with no stated way to
// test it, a conclusion that cites nothing, a pitfall nobody wrote.

// A file edited on Windows arrives with CRLF, and a trailing CR defeats every
// end-of-line anchor below: the hypotheses vanished and a filled-in
// investigation could never close, while the error insisted none were written.
// spec-parser.mjs reads the same kind of markdown and already splits this way.
const LINES = /\r?\n/;

// Template text left in place, in either shape it takes: a bare `<hint>` line,
// or a labelled one like `**Gặp:** <ngày>`. Matching only the bare form let an
// investigation close with the whole Pitfall block untouched — every line
// started with `**`, so none of them looked like a placeholder.
// Chữ mẫu, có thể đứng sau dấu đầu dòng markdown. Bullet-hoá một danh sách năm
// dòng là thói quen bình thường, và không nhận ra thì cả năm dòng chữ mẫu được
// chép nguyên vào knowledge base — đúng thứ hai case V6/V8 sinh ra để chặn.
// Mọi cách người ta mở đầu một dòng danh sách trong markdown: dấu đầu dòng,
// đánh số, checkbox, trích dẫn — và tổ hợp của chúng.
//
// Lần trước chỉ thêm `[-*+]` vì "bullet-hoá là thói quen bình thường". Đánh số
// và blockquote cũng vậy, và cả hai vẫn lọt: hồ sơ để nguyên năm dòng chữ mẫu,
// chỉ thêm `1.` phía trước, là `--close` cho qua rồi chép cả năm dòng vào
// knowledge base. Vá một trong bốn cách viết không phải là vá.
// Moi lop khop NHIEU NHAT mot lan, va lop nao cung phai an it nhat mot ky tu.
//
// Ban truoc la `(X)+` ma moi nhanh trong X deu khop duoc chuoi rong, nen mot
// day khoang trang chia duoc giua hai cho an khoang trang theo so cach tang
// theo cap so nhan. Dong nao rot cuoc khong khop thi bo may thu het moi cach
// chia truoc khi chiu thua: 14 dau cach mat 1,1 giay, cu them hai dau lai nhan
// len khoang muoi hai lan. Mot danh sach long bon tang o muc thut 4 dau cach —
// mac dinh cua phan lon editor — lam `investigate --close` dung im hang phut.
//
// Viet thanh day lop tuy chon co dinh thi khong con nhanh rong nao de phan
// manh, va 13 cach mo dau dong van khop y nhu cu.
const DAU_DONG = '(?:[>\\s]+)?(?:(?:[-*+]|\\d+[.)])\\s*)?(?:\\[[ xX]\\]\\s*)?';

const PLACEHOLDER = new RegExp(
  '^' + DAU_DONG + '(?:\\*\\*[^*]+:\\*\\*\\s*)?<[^>]*>$');

// Shape alone cannot tell a hint from an answer. `**Vùng ảnh hưởng:**
// <SaveButton />` is a real answer that looks like a hint, and guessing by
// shape got it wrong in both directions: first refusing real content, then —
// with a "contains whitespace" rule — accepting every one-word hint the
// template ships, `<ngày>` and `<vì sao>` among them.
//
// The template wrote the hints, so they can be known exactly instead of
// inferred. Read them from the file and compare.
const HINTS = loadTemplateHints();

function loadTemplateHints() {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'investigation.md',
  );
  try {
    const matches = readFileSync(file, 'utf8').match(/<[^>]*>/g) ?? [];
    return new Set(matches);
  } catch {
    // No template to compare against: fall back to treating any bracketed text
    // as unfilled. Over-strict beats letting template text into the knowledge
    // base, and the author can always rephrase.
    return null;
  }
}

function isPlaceholder(line) {
  if (!PLACEHOLDER.test(line)) return false;
  const bracketed = line.slice(line.indexOf('<'), line.lastIndexOf('>') + 1);
  return HINTS === null || HINTS.has(bracketed);
}

function sectionBody(markdown, heading) {
  const lines = markdown.split(LINES);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return null;

  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}

// Text left as `<like this>` is the template speaking, not the author.
function isEmpty(text) {
  if (!text) return true;
  const meaningful = text
    .split(LINES)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !isPlaceholder(l));
  return meaningful.length === 0;
}

function parseHypotheses(markdown) {
  const lines = markdown.split(LINES);
  const hypotheses = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^###\s+([A-Za-z0-9]+):\s*(.*)$/);
    if (heading) {
      if (current) hypotheses.push(current);
      current = { id: heading[1], title: heading[2].trim(), method: '', result: '' };
      continue;
    }
    if (/^## /.test(line) && current) {
      hypotheses.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    // Cùng luật với PLACEHOLDER: bullet-hoá một dòng không làm nó thành dòng
    // khác. Không nhận thì gate bảo người viết bỏ trống ô họ vừa điền.
    const method = line.match(new RegExp('^' + DAU_DONG + '\\*\\*Cách kiểm(?: tra)?:\\*\\*\\s*(.*)$'));
    if (method) { current.method = method[1].trim(); continue; }
    // Cùng hằng với `Cách kiểm tra`. Vá một dòng mà bỏ dòng kia thì hồ sơ bullet-hoá
    // cả hai — cách viết markdown tự nhiên nhất — parse được nửa này, mất nửa kia,
    // và gate báo "chưa có kết quả kiểm tra" cho ô người ta vừa điền.
    const result = line.match(new RegExp('^' + DAU_DONG + '\\*\\*Kết quả:\\*\\*\\s*(.*)$'));
    if (result) { current.result = result[1].trim(); }
  }
  if (current) hypotheses.push(current);

  return hypotheses;
}

export function parseInvestigation(markdown) {
  const hypotheses = parseHypotheses(markdown);
  return {
    title: (markdown.split(LINES)[0] ?? '').replace(/^#\s*/, '').trim(),
    symptom: sectionBody(markdown, 'Triệu chứng'),
    hypotheses,
    evidence: sectionBody(markdown, 'Bằng chứng'),
    conclusion: sectionBody(markdown, 'Kết luận'),
    pitfall: sectionBody(markdown, 'Pitfall'),
    nextSteps: sectionBody(markdown, 'Việc cần làm tiếp'),
  };
}

export function validateForClose(parsed) {
  const errors = [];

  // The title becomes the heading in the pitfall library, so a template title
  // files the lesson where nobody will find it.
  const titleBody = (parsed.title ?? '').replace(/^[A-Za-z0-9-]+:\s*/, '');
  if (isEmpty(titleBody)) errors.push('Dòng tiêu đề còn là chữ mẫu — đặt tên thật cho điều tra');

  if (isEmpty(parsed.symptom)) errors.push('Mục "Triệu chứng" còn trống');

  if (parsed.hypotheses.length === 0) {
    errors.push('Chưa nêu giả thuyết nào');
  }
  for (const h of parsed.hypotheses) {
    if (isEmpty(h.title)) errors.push(`Giả thuyết ${h.id} chưa có nội dung`);
    // Rule two of the three: state how you will test before you test.
    if (isEmpty(h.method)) errors.push(`Giả thuyết ${h.id} không nêu cách kiểm tra`);
    if (isEmpty(h.result) || /chưa kiểm(?: tra)?/i.test(h.result)) {
      errors.push(`Giả thuyết ${h.id} chưa có kết quả kiểm tra`);
    }
  }

  // Rule three: a conclusion without evidence is a guess wearing a suit.
  if (isEmpty(parsed.evidence)) errors.push('Mục "Bằng chứng" còn trống — kết luận phải dẫn về số liệu thật');
  if (isEmpty(parsed.conclusion)) errors.push('Mục "Kết luận" còn trống');

  // An investigation that leaves no lesson lets the next person fall in the
  // same hole. This is the whole point of the feedback loop.
  if (isEmpty(parsed.pitfall)) {
    errors.push('Mục "Pitfall" còn trống — bắt buộc, để lần sau không sập lại');
  } else {
    // Every line, not just one: the block goes verbatim into the pitfall
    // library, so a half-filled one files template text there forever.
    for (const raw of parsed.pitfall.split(LINES)) {
      const line = raw.trim();
      if (line === '' || !isPlaceholder(line)) continue;
      const label = line.match(new RegExp('^' + DAU_DONG + '\\*\\*([^*]+):\\*\\*'));
      errors.push(label
        ? `Mục "Pitfall" còn chữ mẫu ở dòng "${label[1]}"`
        : 'Mục "Pitfall" còn dòng chữ mẫu chưa điền');
    }
  }
  if (isEmpty(parsed.nextSteps)) errors.push('Mục "Việc cần làm tiếp" còn trống — ghi "không cần" nếu thật sự không cần');

  return { ok: errors.length === 0, errors };
}
