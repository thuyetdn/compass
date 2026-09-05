// The one list of gates Compass can actually run. Keeping it here stops the
// failure that shipped once already: check.mjs knew about a gate that
// task-types.mjs had never heard of, so the gate silently never ran.
export const IMPLEMENTED_GATES = ['spec', 'convention', 'test'];

// Cheap first, expensive last, so a fast failure never pays for a slow gate.
export const GATE_ORDER = ['spec', 'convention', 'test', 'ui', 'visual', 'review'];

export function isImplemented(gate) {
  return IMPLEMENTED_GATES.includes(gate);
}
