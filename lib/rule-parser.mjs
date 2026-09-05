// Conventions live in one file that people read and the machine enforces. The
// prose is for people; each ```rule block is the part Compass runs.

const SUPPORTED_TYPES = ['forbid-pattern'];
const REQUIRED_FIELDS = ['id', 'type', 'pattern', 'scope', 'severity'];
const SEVERITIES = ['error', 'warn'];

const RULE_BLOCK = /^```rule[ \t]*$([\s\S]*?)^```[ \t]*$/gm;

function unquote(value) {
  const first = value[0];
  const last = value[value.length - 1];
  if (value.length >= 2 && (first === '"' || first === "'") && last === first) {
    return value.slice(1, -1);
  }
  return value;
}

function parseBlock(body) {
  const fields = {};
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const sep = line.indexOf(':');
    if (sep === -1) continue;

    const key = line.slice(0, sep).trim();
    fields[key] = unquote(line.slice(sep + 1).trim());
  }
  return fields;
}

// A rule that cannot be checked is worse than no rule: it looks like coverage
// and provides none. Every problem is reported, never silently dropped.
function validate(fields, index) {
  const label = fields.id ? `luật "${fields.id}"` : `khối rule thứ ${index + 1}`;
  const problems = [];

  for (const field of REQUIRED_FIELDS) {
    if (!fields[field]) problems.push(`${label} thiếu trường "${field}"`);
  }
  if (problems.length) return problems;

  if (!SUPPORTED_TYPES.includes(fields.type)) {
    problems.push(
      `${label} dùng type "${fields.type}" chưa hỗ trợ. Hiện chỉ có: ${SUPPORTED_TYPES.join(', ')}`,
    );
  }
  if (!SEVERITIES.includes(fields.severity)) {
    problems.push(
      `${label} có severity "${fields.severity}" không hợp lệ. Phải là: ${SEVERITIES.join(' hoặc ')}`,
    );
  }
  try {
    new RegExp(fields.pattern);
  } catch (err) {
    problems.push(`${label} có pattern không hợp lệ: ${err.message}`);
  }

  return problems;
}

export function parseRules(source) {
  const rules = [];
  const errors = [];
  const seen = new Set();

  const blocks = [...source.matchAll(RULE_BLOCK)];

  blocks.forEach((match, index) => {
    const fields = parseBlock(match[1]);

    const problems = validate(fields, index);
    if (problems.length) {
      errors.push(...problems);
      return;
    }

    if (seen.has(fields.id)) {
      errors.push(`luật "${fields.id}" bị khai báo trùng id`);
      return;
    }
    seen.add(fields.id);

    rules.push({
      id: fields.id,
      type: fields.type,
      pattern: fields.pattern,
      scope: fields.scope,
      severity: fields.severity,
      message: fields.message,
    });
  });

  return { rules, errors };
}
