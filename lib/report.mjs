export function pass(gate, detail = '') {
  return detail ? `✓ Gate ${gate} PASSED — ${detail}` : `✓ Gate ${gate} PASSED`;
}

export function fail(gate, lines = []) {
  const body = lines.map((line) => `  ${line}`).join('\n');
  return body ? `✗ Gate ${gate} FAILED\n${body}` : `✗ Gate ${gate} FAILED`;
}

export function info(text) {
  return text;
}

export function hint(text) {
  return `→ ${text}`;
}
