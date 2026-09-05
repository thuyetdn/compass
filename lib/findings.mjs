// Findings come back from an agent that never saw the work being done. The
// format is rigid on purpose: a free-text review is one an author can argue
// with, and Compass has to be able to count what blocks the gate.

export const SEVERITIES = ['Critical', 'Major', 'Minor', 'Info'];
export const BLOCKING = ['Critical', 'Major'];

const REQUIRED = ['severity', 'title', 'detail'];

export function parseFindings(source) {
  let raw;
  try {
    raw = JSON.parse(source);
  } catch (err) {
    return { findings: null, errors: [`findings.json không phải JSON hợp lệ: ${err.message}`] };
  }

  // A bare array cannot carry the brief id, and findings that name no brief
  // answer no particular review. Say that here rather than letting the caller
  // report a missing id as "the code changed".
  if (Array.isArray(raw)) {
    return {
      findings: null,
      errors: ['findings.json phải là object có "brief" và "findings" — mảng trần không mang được id của brief'],
    };
  }

  const list = raw?.findings;
  if (!Array.isArray(list)) {
    return {
      findings: null,
      errors: ['findings.json phải có trường "findings" là mảng'],
    };
  }

  const errors = [];
  const findings = [];

  list.forEach((item, index) => {
    const label = `finding thứ ${index + 1}`;

    if (typeof item !== 'object' || item === null) {
      errors.push(`${label} không phải object`);
      return;
    }
    for (const field of REQUIRED) {
      if (typeof item[field] !== 'string' || item[field].trim() === '') {
        errors.push(`${label} thiếu trường "${field}"`);
      }
    }
    if (item.severity !== undefined && !SEVERITIES.includes(item.severity)) {
      errors.push(`${label} có severity "${item.severity}" không hợp lệ. Phải là: ${SEVERITIES.join(', ')}`);
    }
    if (errors.length) return;

    findings.push({
      severity: item.severity,
      title: item.title,
      detail: item.detail,
      file: typeof item.file === 'string' ? item.file : null,
      line: Number.isInteger(item.line) ? item.line : null,
    });
  });

  if (errors.length) return { findings: null, errors };

  return {
    findings,
    errors: [],
    blocking: findings.filter((f) => BLOCKING.includes(f.severity)),
  };
}

export function formatFinding(f) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : 'không nêu vị trí';
  return `[${f.severity}] ${f.title}\n      ${where}\n      ${f.detail}`;
}
