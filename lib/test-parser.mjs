function escapeForRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPassLine(line) {
  const trimmed = line.trimStart();
  // Check for non-pass markers first (including # SKIP in TAP output)
  if (/[#\s](SKIP|SKIPPED|TODO|PENDING)/.test(trimmed)) {
    return false;
  }
  return /^(ok\s+\d+|✔|✓|PASS|PASSED|√)/.test(trimmed);
}

function isNonPassLine(line) {
  return /^(not\s+ok|✗|✕|×|FAIL|FAILED|SKIP|SKIPPED|TODO|PENDING)/.test(line.trimStart()) ||
         /[#\s](SKIP|SKIPPED|TODO|PENDING)/.test(line) ||
         /^(Error|error:|at\s)/.test(line);
}

export function extractRanIds(output, knownIds) {
  const ran = new Set();
  const seenOnNonPassLines = new Set();
  const seenOnUnknownLines = new Set();

  const lines = output.split('\n');
  for (const line of lines) {
    const passLine = isPassLine(line);
    const nonPassLine = isNonPassLine(line);

    for (const id of knownIds) {
      const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeForRegex(id)}([^A-Za-z0-9]|$)`);
      if (pattern.test(line)) {
        if (passLine) {
          ran.add(id);
        } else if (nonPassLine) {
          seenOnNonPassLines.add(id);
        } else {
          seenOnUnknownLines.add(id);
        }
      }
    }
  }

  return {
    ran: [...ran],
    seenOnNonPassLines: [...seenOnNonPassLines],
    seenOnUnknownLines: [...seenOnUnknownLines],
  };
}

export function compareWithSpec(specIds, ranIds) {
  const ran = new Set(ranIds);
  const spec = new Set(specIds);
  const missing = specIds.filter((id) => !ran.has(id));
  const extra = ranIds.filter((id) => !spec.has(id));
  return { missing, extra, ok: missing.length === 0 };
}
