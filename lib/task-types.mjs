export const TASK_TYPES = ['fix', 'bug', 'feature-s', 'feature-m', 'feature-l'];

export const LAYERS = ['Happy', 'Validation', 'Error', 'Edge', 'Security', 'Performance'];

const RULES = {
  'fix':       { minTests: 2,  requiredLayers: ['Happy'],
                 gates: ['spec', 'knowledge', 'test'] },
  'bug':       { minTests: 6,  requiredLayers: ['Happy', 'Validation', 'Error', 'Edge'],
                 gates: ['spec', 'knowledge', 'test'] },
  'feature-s': { minTests: 13, requiredLayers: ['Happy', 'Validation', 'Error', 'Edge', 'Security'],
                 gates: ['spec', 'knowledge', 'test', 'convention', 'ui', 'visual'] },
  'feature-m': { minTests: 21, requiredLayers: LAYERS,
                 gates: ['spec', 'knowledge', 'test', 'convention', 'ui', 'visual', 'review'] },
  'feature-l': { minTests: 30, requiredLayers: LAYERS,
                 gates: ['spec', 'knowledge', 'test', 'convention', 'ui', 'visual', 'review'] },
};

export function rulesFor(type) {
  const rule = RULES[type];
  if (rule === undefined) return null;
  return {
    minTests: rule.minTests,
    requiredLayers: [...rule.requiredLayers],
    gates: [...rule.gates],
  };
}

export function isUpgrade(from, to) {
  const a = TASK_TYPES.indexOf(from);
  const b = TASK_TYPES.indexOf(to);
  if (a === -1 || b === -1) return false;
  return b > a;
}
