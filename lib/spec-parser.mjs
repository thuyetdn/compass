function splitRow(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function isSeparator(cells) {
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function parseSpec(markdown) {
  const lines = markdown.split(/\r?\n/);

  let taskId = '';
  let title = '';
  let type = '';
  let scope = '';
  const sections = new Map();
  const testCases = [];
  const malformedRows = [];

  let currentSection = null;
  let buffer = [];
  let inTestTable = false;
  let typeSet = false;
  let scopeSet = false;

  const flush = () => {
    if (currentSection !== null) {
      sections.set(currentSection, buffer.join('\n').trim());
    }
    buffer = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;

    const heading1 = line.match(/^#\s+([^:]+):\s*(.+)$/);
    if (heading1) {
      taskId = heading1[1].trim();
      title = heading1[2].trim();
      continue;
    }

    const heading2 = line.match(/^##\s+(.+)$/);
    if (heading2) {
      flush();
      currentSection = heading2[1].trim();
      inTestTable = currentSection === 'Test cases';
      continue;
    }

    // Parse metadata anywhere in the file, but only take first occurrence
    const typeLine = line.match(/^Loại:\s*(.+)$/);
    if (typeLine && !typeSet) {
      type = typeLine[1].trim();
      typeSet = true;
    }
    const scopeLine = line.match(/^Phạm vi:\s*(.+)$/);
    if (scopeLine && !scopeSet) {
      scope = scopeLine[1].trim();
      scopeSet = true;
    }

    if (inTestTable && line.trim().startsWith('|')) {
      const cells = splitRow(line);
      if (cells.length === 5 && !isSeparator(cells) && cells[0] !== 'ID') {
        testCases.push({
          id: cells[0],
          layer: cells[1],
          description: cells[2],
          expected: cells[3],
          priority: cells[4],
        });
      } else if (cells.length !== 5 && !isSeparator(cells) && cells[0] !== 'ID') {
        malformedRows.push({
          line: lineNumber,
          text: line,
          cellCount: cells.length,
        });
      }
      continue;
    }

    buffer.push(line);
  }
  flush();

  return { taskId, title, type, scope, sections, testCases, malformedRows };
}
