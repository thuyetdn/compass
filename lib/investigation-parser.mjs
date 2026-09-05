// An investigation is closed on evidence, not on a story. This parser is what
// lets the machine tell one from the other: a hypothesis with no stated way to
// test it, a conclusion that cites nothing, a pitfall nobody wrote.

// Template text left in place, in either shape it takes: a bare `<hint>` line,
// or a labelled one like `**Gặp:** <ngày>`. Matching only the bare form let an
// investigation close with the whole Pitfall block untouched — every line
// started with `**`, so none of them looked like a placeholder.
const PLACEHOLDER = /^(?:\*\*[^*]+:\*\*\s*)?<[^>]*>$/;

function sectionBody(markdown, heading) {
  const lines = markdown.split('\n');
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
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !PLACEHOLDER.test(l));
  return meaningful.length === 0;
}

function parseHypotheses(markdown) {
  const lines = markdown.split('\n');
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

    const method = line.match(/^\*\*Cách kiểm:\*\*\s*(.*)$/);
    if (method) { current.method = method[1].trim(); continue; }
    const result = line.match(/^\*\*Kết quả:\*\*\s*(.*)$/);
    if (result) { current.result = result[1].trim(); }
  }
  if (current) hypotheses.push(current);

  return hypotheses;
}

export function parseInvestigation(markdown) {
  const hypotheses = parseHypotheses(markdown);
  return {
    title: (markdown.split('\n')[0] ?? '').replace(/^#\s*/, '').trim(),
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
    if (isEmpty(h.method)) errors.push(`Giả thuyết ${h.id} không nêu cách kiểm`);
    if (isEmpty(h.result) || /chưa kiểm/i.test(h.result)) {
      errors.push(`Giả thuyết ${h.id} chưa có kết quả kiểm`);
    }
  }

  // Rule three: a conclusion without evidence is a guess wearing a suit.
  if (isEmpty(parsed.evidence)) errors.push('Mục "Bằng chứng" còn trống — kết luận phải dẫn về số liệu thật');
  if (isEmpty(parsed.conclusion)) errors.push('Mục "Kết luận" còn trống');

  // An investigation that leaves no lesson lets the next person fall in the
  // same hole. This is the whole point of the feedback loop.
  if (isEmpty(parsed.pitfall)) errors.push('Mục "Pitfall" còn trống — bắt buộc, để lần sau không sập lại');
  if (isEmpty(parsed.nextSteps)) errors.push('Mục "Việc cần làm tiếp" còn trống — ghi "không cần" nếu thật sự không cần');

  return { ok: errors.length === 0, errors };
}
