import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRules } from '../lib/rule-parser.mjs';

const ONE_RULE = `# Conventions

### Không hardcode màu

Dùng semantic token để theme đổi được.

\`\`\`rule
id: no-hex-color
type: forbid-pattern
pattern: "#[0-9a-fA-F]{3,8}"
scope: src/**/*.jsx
severity: error
\`\`\`
`;

test('H1 parses a complete rule block', () => {
  const result = parseRules(ONE_RULE);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rules.length, 1);
  assert.deepEqual(result.rules[0], {
    id: 'no-hex-color',
    type: 'forbid-pattern',
    pattern: '#[0-9a-fA-F]{3,8}',
    scope: 'src/**/*.jsx',
    severity: 'error',
    message: undefined,
  });
});

test('H2 parses several rule blocks in order', () => {
  const source = ONE_RULE + `
### Không dùng console.log

\`\`\`rule
id: no-console
type: forbid-pattern
pattern: "console\\\\.log"
scope: src/**/*.js
severity: warn
\`\`\`
`;
  const result = parseRules(source);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rules.map((r) => r.id), ['no-hex-color', 'no-console']);
  assert.equal(result.rules[1].severity, 'warn');
});

test('V1 reports a rule block missing a required field', () => {
  const source = `\`\`\`rule
id: no-id-only
type: forbid-pattern
severity: error
\`\`\`
`;
  const result = parseRules(source);
  assert.equal(result.rules.length, 0);
  // pattern and scope are both absent — every missing field is named, so the
  // author fixes the block in one pass instead of one error at a time.
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((e) => e.includes('no-id-only')));
  assert.ok(result.errors.some((e) => e.includes('pattern')));
  assert.ok(result.errors.some((e) => e.includes('scope')));
});

test('V2 reports an unsupported rule type', () => {
  const source = `\`\`\`rule
id: needs-ast
type: require-import
pattern: "x"
scope: src/**
severity: error
\`\`\`
`;
  const result = parseRules(source);
  assert.equal(result.rules.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /require-import/);
});

test('V3 reports an invalid regex pattern', () => {
  const source = `\`\`\`rule
id: bad-regex
type: forbid-pattern
pattern: "([unclosed"
scope: src/**
severity: error
\`\`\`
`;
  const result = parseRules(source);
  assert.equal(result.rules.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /bad-regex/);
});

test('a file with no rule blocks yields no rules and no errors', () => {
  const result = parseRules('# Chỉ là văn bản\n\nKhông có luật máy nào ở đây.\n');
  assert.deepEqual(result.rules, []);
  assert.deepEqual(result.errors, []);
});

test('a rule may carry an optional message', () => {
  const source = `\`\`\`rule
id: no-hex
type: forbid-pattern
pattern: "#fff"
scope: src/**
severity: error
message: Dùng token thay vì mã màu
\`\`\`
`;
  const result = parseRules(source);
  assert.equal(result.rules[0].message, 'Dùng token thay vì mã màu');
});

test('an unquoted pattern is read literally', () => {
  const source = `\`\`\`rule
id: no-todo
type: forbid-pattern
pattern: TODO
scope: src/**
severity: warn
\`\`\`
`;
  const result = parseRules(source);
  assert.equal(result.rules[0].pattern, 'TODO');
});

test('a duplicate rule id is reported', () => {
  const result = parseRules(ONE_RULE + ONE_RULE);
  assert.equal(result.rules.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /no-hex-color/);
});
