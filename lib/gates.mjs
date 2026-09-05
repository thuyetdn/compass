// The one list of gates Compass can actually run. Keeping it here stops the
// failure that shipped once already: check.mjs knew about a gate that
// task-types.mjs had never heard of, so the gate silently never ran.
export const IMPLEMENTED_GATES = ['spec', 'knowledge', 'convention', 'test', 'ui', 'visual', 'review'];

// Cheap first, expensive last, so a fast failure never pays for a slow gate.
export const GATE_ORDER = ['spec', 'knowledge', 'convention', 'test', 'ui', 'visual', 'review'];

// Gates that read the project's code, and so must record what that code looked
// like. `done` compares the recording against the tree as it stands now; a gate
// left off this list closes a task on evidence about code that has moved on.
//
// It lives here beside the other lists because the same omission has shipped
// twice: a gate added in one file that another file never learned about.
export const SOURCE_DEPENDENT_GATES = ['knowledge', 'convention', 'test', 'ui', 'visual'];

export function isImplemented(gate) {
  return IMPLEMENTED_GATES.includes(gate);
}
