function escapeForRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reporters colour their output, and the escape codes sit right where the pass
// mark is expected: Vitest prints "\x1b[32m✓\x1b[39m H5 ...". Matching "^✓"
// against that fails, so a test that passed gets filed as unrecognised.
const ANSI = /\u001b\[[0-9;]*m/g;

function stripAnsi(line) {
  return line.replace(ANSI, '');
}

function isPassLine(rawLine) {
  const line = stripAnsi(rawLine);
  const trimmed = line.trimStart();
  // Check for non-pass markers first (including # SKIP in TAP output)
  if (/[#\s](SKIP|SKIPPED|TODO|PENDING)/.test(trimmed)) {
    return false;
  }
  return /^(ok\s+\d+|✔|✓|PASS|PASSED|√)/.test(trimmed);
}

function isNonPassLine(rawLine) {
  const line = stripAnsi(rawLine);
  return /^(not\s+ok|✗|✕|×|FAIL|FAILED|SKIP|SKIPPED|TODO|PENDING)/.test(line.trimStart()) ||
         /[#\s](SKIP|SKIPPED|TODO|PENDING)/.test(line) ||
         /^(Error|error:|at\s)/.test(line);
}

export function extractRanIds(output, knownIds) {
  const ran = new Set();
  const seenOnNonPassLines = new Set();
  const seenOnUnknownLines = new Set();
  const seenOnSharedLines = new Set();

  const lines = output.split('\n');
  for (const line of lines) {
    const passLine = isPassLine(line);
    const nonPassLine = isNonPassLine(line);

    // Escape codes can sit between the pass mark and the ID, so match against
    // the stripped line — otherwise they read as word characters and break the
    // boundary check.
    const plain = stripAnsi(line);
    const idsOnThisLine = [];
    for (const id of knownIds) {
      const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeForRegex(id)}([^A-Za-z0-9]|$)`);
      if (pattern.test(plain)) idsOnThisLine.push(id);
    }

    if (passLine && idsOnThisLine.length > 1) {
      // One pass line naming several spec IDs proves nothing about which test
      // covers which — count none of them as ran, flag them as ambiguous instead.
      for (const id of idsOnThisLine) seenOnSharedLines.add(id);
      continue;
    }

    for (const id of idsOnThisLine) {
      if (passLine) {
        ran.add(id);
      } else if (nonPassLine) {
        seenOnNonPassLines.add(id);
      } else {
        seenOnUnknownLines.add(id);
      }
    }
  }

  // Final dedup: if an ID passed (unambiguously) on any line, remove it from the
  // other buckets. A test that passed is a test that ran — earlier failures are history.
  for (const id of ran) {
    seenOnNonPassLines.delete(id);
    seenOnUnknownLines.delete(id);
    seenOnSharedLines.delete(id);
  }

  return {
    ran: [...ran],
    seenOnNonPassLines: [...seenOnNonPassLines],
    seenOnUnknownLines: [...seenOnUnknownLines],
    seenOnSharedLines: [...seenOnSharedLines],
  };
}

export function compareWithSpec(specIds, ranIds) {
  const ran = new Set(ranIds);
  const spec = new Set(specIds);
  const missing = specIds.filter((id) => !ran.has(id));
  const extra = ranIds.filter((id) => !spec.has(id));
  return { missing, extra, ok: missing.length === 0 };
}
