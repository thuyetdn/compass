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

  return { ok: errors.length === 0, errors, warnings };
}
