import { parseSpec } from './spec-parser.mjs';
import { rulesFor, TASK_TYPES } from './task-types.mjs';

const PLACEHOLDERS = /\b(TBD|TODO|FIXME|XXX)\b/;

export function validateSpec(markdown) {
  const spec = parseSpec(markdown);
  const errors = [];
  const warnings = [];

  const rules = rulesFor(spec.type);
  if (!rules) {
    errors.push(`Loại task không hợp lệ: "${spec.type}". Phải là một trong: ${TASK_TYPES.join(', ')}`);
  }

  if (PLACEHOLDERS.test(markdown)) {
    errors.push('Spec còn placeholder (TBD/TODO/FIXME/XXX) — phải điền hết trước khi duyệt');
  }

  const regression = (spec.sections.get('Rủi ro hồi quy') ?? '').trim();
  if (regression === '') {
    errors.push('Mục "Rủi ro hồi quy" đang trống — bắt buộc phải điền');
  }

  for (const row of spec.malformedRows) {
    errors.push(`Dòng ${row.line} trong bảng Test cases không đúng định dạng (có ${row.cellCount} cột, cần 5): ${row.text}`);
  }

  if (spec.testCases.length === 0) {
    errors.push('Spec phải có ít nhất 1 test case');
  }

  const seen = new Set();
  for (const c of spec.testCases) {
    if (seen.has(c.id)) errors.push(`Test case ID bị trùng: ${c.id}`);
    seen.add(c.id);
    if (c.description === '') errors.push(`Test case ${c.id} thiếu mô tả`);
    if (c.expected === '') errors.push(`Test case ${c.id} thiếu kỳ vọng`);
  }

  if (rules) {
    if (spec.testCases.length < rules.minTests) {
      errors.push(
        `Loại "${spec.type}" cần tối thiểu ${rules.minTests} test cases, hiện có ${spec.testCases.length}`
      );
    }
    const layers = new Set(spec.testCases.map((c) => c.layer));
    for (const layer of rules.requiredLayers) {
      if (!layers.has(layer)) {
        errors.push(`Thiếu lớp test bắt buộc cho loại "${spec.type}": ${layer}`);
      }
    }
  }

  for (const ex of spec.migrationExceptions ?? []) {
    if (!ex.ok) {
      errors.push(`Dòng "Ngoại lệ migration:" ở dòng ${ex.line} ${ex.reason}. Viết dạng: Ngoại lệ migration: <đường dẫn> — <lý do>`);
    }
  }

  errors.push(...environmentErrors(spec));

  return { ok: errors.length === 0, errors, warnings };
}

// Mục `## Môi trường` (CP-108): sự thật ngoài diff mà người soi cần — migration đã chạy ở
// stage nào, cờ theo stage, PR của team khác. Bắt buộc từ feature-m; loại khác không bắt,
// nhưng có thì vẫn phải đúng dạng. Mỗi sự thật có nguồn và ngày, hay cả mục là một dòng
// `Không áp dụng: <lý do>`.
export const ENV_SECTION = 'Môi trường';
const ENV_REQUIRED = ['feature-m', 'feature-l'];
const ENV_FORMS = 'một bảng `| Sự thật | Nguồn | Ngày |` (ngày dạng YYYY-MM-DD, mỗi hàng đủ ba ô), hay một dòng `Không áp dụng: <lý do>`';

function validDate(text) {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function environmentErrors(spec) {
  const has = spec.sections.has(ENV_SECTION);
  if (!has) {
    return ENV_REQUIRED.includes(spec.type)
      ? [`Loại "${spec.type}" cần mục "## ${ENV_SECTION}": ${ENV_FORMS}.`]
      : [];
  }
  const body = spec.sections.get(ENV_SECTION).trim();
  const label = `Mục "## ${ENV_SECTION}"`;
  if (body === '') return [`${label} đang trống. Điền ${ENV_FORMS}.`];
  const na = body.match(/^Không áp dụng:(.*)$/);
  if (na) {
    if (body.includes('\n')) return [`${label}: "Không áp dụng:" phải đứng một mình, không kèm bảng hay dòng khác.`];
    return na[1].trim() === '' ? [`${label}: "Không áp dụng:" phải kèm lý do.`] : [];
  }
  const rows = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const cells = rows.map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  const data = cells.filter((c) => !c.every((x) => /^:?-{2,}:?$/.test(x)) && c[0] !== 'Sự thật');
  if (data.length === 0) return [`${label} chưa có hàng sự thật nào. Điền ${ENV_FORMS}.`];
  const errors = [];
  data.forEach((c, i) => {
    const where = `${label}, hàng ${i + 1}`;
    if (c.length !== 3) { errors.push(`${where}: cần ba ô (sự thật, nguồn, ngày), đang có ${c.length}.`); return; }
    const [fact, source, date] = c;
    if (fact === '') errors.push(`${where}: thiếu sự thật.`);
    if (source === '') errors.push(`${where} (${fact || 'không tên'}): thiếu nguồn.`);
    if (!validDate(date)) errors.push(`${where} (${fact || 'không tên'}): ngày "${date}" không phải ngày có thật dạng YYYY-MM-DD.`);
  });
  return errors;
}
