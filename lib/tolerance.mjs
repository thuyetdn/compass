// Tolerances from the design spec §7.4. Colour and type are absolute: a brand
// colour that is nearly right is wrong. Spacing gets a pixel budget because
// browsers round subpixel layout differently than a design tool does.
const PIXEL_BUDGET = [
  [2, ['padding', 'margin', 'gap', 'width', 'height', 'top', 'right', 'bottom', 'left']],
  [1, ['border-radius', 'line-height', 'letter-spacing', 'border-width']],
];

const ABSOLUTE = ['color', 'background-color', 'border-color', 'font-weight', 'font-size', 'font-family'];

export function toleranceFor(property) {
  if (ABSOLUTE.some((name) => property === name || property.startsWith(name))) return 0;
  for (const [budget, prefixes] of PIXEL_BUDGET) {
    if (prefixes.some((prefix) => property === prefix || property.startsWith(prefix))) return budget;
  }
  return 0;
}

function isColourProperty(property) {
  return property.includes('color');
}

// A design tool writes #111827, a browser reports rgb(17, 24, 39). Same colour.
// Comparing the strings would flag every single one as drift.
export function normaliseColour(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();

  const hex = text.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const digits = hex[1];
    const full = digits.length === 3 ? digits.split('').map((d) => d + d).join('') : digits;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgb(${r}, ${g}, ${b})`;
  }

  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(',').map((p) => p.trim());
    if (parts.length === 3) return `rgb(${parts.join(', ')})`;
    if (parts.length === 4) {
      // A fully opaque rgba is the same colour as its rgb form.
      if (parseFloat(parts[3]) === 1) return `rgb(${parts.slice(0, 3).join(', ')})`;
      return `rgba(${parts.join(', ')})`;
    }
  }

  return text;
}

function toPixels(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(-?[\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}

export function compareValue(property, design, actual) {
  if (actual === undefined || actual === null) {
    return { ok: false, drift: null, reason: 'không đo được giá trị' };
  }

  if (isColourProperty(property)) {
    const want = normaliseColour(design);
    const got = normaliseColour(actual);
    return want === got
      ? { ok: true, drift: 0 }
      : { ok: false, drift: null, reason: 'màu phải khớp tuyệt đối' };
  }

  const budget = toleranceFor(property);
  const wantPx = toPixels(design);
  const gotPx = toPixels(actual);

  if (wantPx === null || gotPx === null) {
    // Not a pixel value — compare as text (display: flex, font-weight: 600).
    return String(design).trim() === String(actual).trim()
      ? { ok: true, drift: 0 }
      : { ok: false, drift: null, reason: budget === 0 ? 'phải khớp tuyệt đối' : 'giá trị khác nhau' };
  }

  const drift = Math.round(Math.abs(wantPx - gotPx) * 100) / 100;
  return drift <= budget
    ? { ok: true, drift }
    : { ok: false, drift, reason: `lệch ${drift}px, dung sai ${budget}px` };
}
