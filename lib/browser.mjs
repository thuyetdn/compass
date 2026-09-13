import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = ['playwright', 'playwright-core'];

// Compass stays dependency-free, so Playwright has to come from the project
// being measured. Resolving from the project root also means the gate uses the
// same browser version the project's own tests use.
export async function findPlaywright(root) {
  const require = createRequire(pathToFileURL(path.join(root, 'package.json')));

  for (const name of CANDIDATES) {
    let entry;
    try {
      entry = require.resolve(name);
    } catch {
      continue;
    }
    if (!existsSync(entry)) continue;

    try {
      const module = await import(pathToFileURL(entry).href);
      return { ok: true, module: module.default ?? module, name };
    } catch (err) {
      return { ok: false, reason: `Tìm thấy ${name} nhưng không nạp được: ${err.message}` };
    }
  }

  return {
    ok: false,
    reason: [
      'Gate ui cần Playwright, dự án này chưa có.',
      'Compass không tự cài để giữ zero-dependency — cài ở dự án đích:',
      '  npm install -D playwright && npx playwright install chromium',
    ].join('\n'),
  };
}

// Every selector is queried once and all its properties read from that one
// node. Querying per property would multiply round trips for no gain.
// One result per element, in element order — the contract buildMeasureScript
// keeps. ui.mjs used to re-key results by selector; two elements sharing one
// selector then collapsed to the last result, the first one's properties read
// undefined, and a page that matched the design was reported as drift (CP-41).
// A missing or malformed entry becomes null so the caller can name the element
// instead of throwing.
export function pairResults(elements, results) {
  const list = Array.isArray(results) ? results : [];
  return elements.map((element, i) => ({
    element,
    result: list[i] && typeof list[i] === 'object' ? list[i] : null,
  }));
}

export function buildMeasureScript(elements) {
  const payload = elements.map((el) => ({
    selector: el.selector,
    properties: Object.keys(el.properties),
  }));

  return `(() => {
  const wanted = ${JSON.stringify(payload)};
  return wanted.map((entry) => {
    const node = document.querySelector(entry.selector);
    if (!node) return { selector: entry.selector, found: false, values: {} };
    const style = getComputedStyle(node);
    const values = {};
    for (const property of entry.properties) {
      values[property] = style.getPropertyValue(property);
    }
    return { selector: entry.selector, found: true, values };
  });
})()`;
}
