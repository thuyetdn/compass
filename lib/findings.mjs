// Findings come back from an agent that never saw the work being done. The
// format is rigid on purpose: a free-text review is one an author can argue
// with, and Compass has to be able to count what blocks the gate.

export const SEVERITIES = ['Critical', 'Major', 'Minor', 'Info'];
export const BLOCKING = ['Critical', 'Major'];

// Mười việc người soi phải xét (CP-78). Brief in ra danh sách này, và
// `findings.json` phải có kết luận cho từng khóa: một bản soi bỏ qua bảo mật thì
// không còn trông giống một bản soi sạch.
export const CRITERIA = [
  { key: 'spec', question: 'Code có làm đúng từng case trong spec, và không làm gì ngoài phạm vi?' },
  { key: 'convention', question: 'Code có theo convention của repo?' },
  { key: 'impact', question: 'Code vừa đổi đang được những chỗ nào dùng, và những chỗ đó còn chạy đúng không?' },
  { key: 'tests', question: 'Test của từng case có kiểm tra kết quả thật, hay chỉ kiểm tra code chạy được?' },
  { key: 'regression', question: 'Mỗi rủi ro trong mục "Rủi ro hồi quy" của spec đã có test chặn chưa?' },
  { key: 'performance', question: 'Có gọi IO hay truy vấn trong vòng lặp, có đọc cả file lớn vào bộ nhớ không?' },
  { key: 'security', question: 'Input từ ngoài có được escape, có đường dẫn thoát khỏi repo, có lộ secret không?' },
  { key: 'errors', question: 'Input rỗng, file hỏng, đường dẫn Windows, lỗi giữa chừng đã được xử lý chưa?' },
  { key: 'reuse', question: 'Repo đã có helper làm đúng việc này chưa?' },
  { key: 'docs', question: 'README, hướng dẫn và skill còn mô tả đúng hành vi vừa đổi không?' },
];

export const VERDICTS = ['clean', 'findings', 'insufficient'];

// Brief luôn mang đủ spec và diff, nên hai tiêu chí này không có lý do để thiếu dữ liệu.
export const NEVER_INSUFFICIENT = ['spec', 'tests'];

export const BASES = ['declared', 'inferred'];

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
      criterion: typeof item.criterion === 'string' ? item.criterion : null,
      basis: typeof item.basis === 'string' ? item.basis : null,
    });
  });

  if (errors.length) return { findings: null, errors };

  return {
    findings,
    errors: [],
    blocking: findings.filter((f) => BLOCKING.includes(f.severity)),
    coverage: raw.coverage === undefined ? undefined : raw.coverage,
  };
}

// Luật của CP-78, tách khỏi `parseFindings` để hàm đó vẫn chỉ lo một việc: đọc
// đúng định dạng từng finding. Lệnh `review` gọi cả hai.
//
// Trả về `errors` rỗng khi mọi tiêu chí có kết luận hợp lệ và kết luận khớp với
// các finding. `insufficient` không phải lỗi; nó được trả về để gate in ra.
export function checkCoverage(coverage, findings, { conventionsDeclared }) {
  const errors = [];
  const keys = CRITERIA.map((c) => c.key);

  if (typeof coverage !== 'object' || coverage === null || Array.isArray(coverage)) {
    return {
      errors: [`findings.json thiếu "coverage": cần một kết luận cho mỗi tiêu chí (${keys.join(', ')})`],
      insufficient: [],
      counts: null,
    };
  }

  for (const key of Object.keys(coverage)) {
    if (!keys.includes(key)) errors.push(`coverage có tiêu chí lạ "${key}". Tiêu chí hợp lệ: ${keys.join(', ')}`);
  }

  const counts = { clean: 0, findings: 0, insufficient: 0 };
  const insufficient = [];

  for (const key of keys) {
    const entry = coverage[key];
    if (entry === undefined) {
      errors.push(`coverage thiếu tiêu chí "${key}" — mỗi tiêu chí phải có kết luận, kể cả khi không thấy gì`);
      continue;
    }
    const verdict = entry?.verdict;
    if (!VERDICTS.includes(verdict)) {
      errors.push(`coverage.${key} có verdict ${JSON.stringify(verdict)} không hợp lệ. Phải là: ${VERDICTS.join(', ')}`);
      continue;
    }
    counts[verdict] += 1;

    const own = findings.filter((f) => f.criterion === key);
    if (verdict === 'findings' && own.length === 0) {
      errors.push(`coverage.${key} ghi "findings" nhưng không có finding nào mang criterion "${key}"`);
    }
    if (verdict === 'clean' && own.length > 0) {
      errors.push(`coverage.${key} ghi "clean" nhưng có ${own.length} finding mang criterion "${key}"`);
    }
    if (verdict === 'insufficient') {
      if (NEVER_INSUFFICIENT.includes(key)) {
        errors.push(`coverage.${key} không được là "insufficient": brief luôn có spec và diff, đủ để xét tiêu chí này`);
      } else if (typeof entry.note !== 'string' || entry.note.trim() === '') {
        errors.push(`coverage.${key} là "insufficient" thì phải có "note" nói thiếu dữ liệu gì`);
      } else {
        insufficient.push({ key, note: entry.note.trim() });
      }
    }
  }

  findings.forEach((f, index) => {
    const label = `finding thứ ${index + 1}`;
    if (f.criterion === null) {
      errors.push(`${label} thiếu trường "criterion" — mỗi finding phải thuộc một tiêu chí`);
      return;
    }
    if (!keys.includes(f.criterion)) {
      errors.push(`${label} có criterion "${f.criterion}" không hợp lệ. Phải là: ${keys.join(', ')}`);
      return;
    }
    if (f.criterion === 'convention') {
      if (!BASES.includes(f.basis)) {
        errors.push(`${label} thuộc convention thì phải có "basis": declared (theo luật đã khai) hoặc inferred (suy ra từ code)`);
      } else if (f.basis === 'declared' && !conventionsDeclared) {
        errors.push(`${label} ghi basis "declared" nhưng repo chưa khai convention nào — dùng "inferred"`);
      }
    }
  });

  return { errors, insufficient, counts };
}

export function formatFinding(f) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : 'không nêu vị trí';
  return `[${f.severity}] ${f.title}\n      ${where}\n      ${f.detail}`;
}
