// A design contract says what the page must measure, not what it looks like.
// One entry per element, each naming a CSS selector and the properties whose
// values came from the design.

const DEFAULT_VIEWPORT = { name: 'desktop', width: 1280, height: 900 };

export function parseContract(source) {
  let raw;
  try {
    raw = JSON.parse(source);
  } catch (err) {
    return { contract: null, errors: [`design-contract.json không phải JSON hợp lệ: ${err.message}`] };
  }

  const errors = [];

  if (!Array.isArray(raw.elements)) {
    return { contract: null, errors: ['design-contract.json thiếu mảng "elements"'] };
  }

  const viewports = [];
  if (raw.viewports === undefined) {
    viewports.push({ ...DEFAULT_VIEWPORT });
  } else if (!Array.isArray(raw.viewports)) {
    errors.push('"viewports" phải là mảng');
  } else {
    raw.viewports.forEach((vp, index) => {
      const label = vp?.name ? `viewport "${vp.name}"` : `viewport thứ ${index + 1}`;
      if (typeof vp?.name !== 'string' || vp.name === '') errors.push(`${label} thiếu "name"`);
      if (typeof vp?.width !== 'number' || !Number.isFinite(vp.width)) {
        errors.push(`${label} có "width" không phải số`);
        return;
      }
      viewports.push({
        name: vp.name,
        width: vp.width,
        height: typeof vp.height === 'number' ? vp.height : DEFAULT_VIEWPORT.height,
      });
    });
  }

  const elements = [];
  raw.elements.forEach((el, index) => {
    const label = el?.name ? `phần tử "${el.name}"` : `phần tử thứ ${index + 1}`;

    if (typeof el?.selector !== 'string' || el.selector.trim() === '') {
      errors.push(`${label} thiếu "selector"`);
      return;
    }
    const properties = el.properties;
    if (typeof properties !== 'object' || properties === null || Object.keys(properties).length === 0) {
      errors.push(`${label} không khai thuộc tính nào để đo`);
      return;
    }

    elements.push({
      name: el.name ?? el.selector,
      selector: el.selector,
      properties: { ...properties },
    });
  });

  if (errors.length) return { contract: null, errors };

  const perViewport = elements.reduce((sum, el) => sum + Object.keys(el.properties).length, 0);

  return {
    contract: {
      viewports: viewports.length ? viewports : [{ ...DEFAULT_VIEWPORT }],
      elements,
      totalMeasurements: perViewport * (viewports.length || 1),
    },
    errors: [],
  };
}
