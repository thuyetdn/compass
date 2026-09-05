function escapeForRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractRanIds(output, knownIds) {
  const found = new Set();
  for (const id of knownIds) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeForRegex(id)}([^A-Za-z0-9]|$)`, 'm');
    if (pattern.test(output)) found.add(id);
  }
  return [...found];
}

export function compareWithSpec(specIds, ranIds) {
  const ran = new Set(ranIds);
  const spec = new Set(specIds);
  const missing = specIds.filter((id) => !ran.has(id));
  const extra = ranIds.filter((id) => !spec.has(id));
  return { missing, extra, ok: missing.length === 0 };
}
