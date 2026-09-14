# CP-42: A nested destructuring default is reported as the outer prop's default, with confidence
Loại: bug
Phạm vi: lib/knowledge-scan.mjs, test/knowledge-scan.test.mjs
Gốc soi: 2368dc1

## Mục tiêu

`readProps` reads `=` inside a nested destructuring pattern as the outer prop's default value,
then marks the entry `confident: true`. For `function A({ a: { b = 1 } })` it writes
`a: { default: "1 }" }` — a value that is not a value, for a prop that has no default. The `1`
belongs to `b`, which is not a prop at all.

Measured on HEAD (2368dc1), four shapes are wrong today:

| Source | Reported now | Wrong how |
|---|---|---|
| `({ a: { b = 1 } })` | `a.default = "1 }"` | invented default, wrong owner |
| `({ a: { b = 1, c = 2 }, d })` | `a.default = "1, c = 2 }"` | same, plus a fragment of two props |
| `({ a: [x = 1] })` | `a.default = "1]"` | same, array pattern |
| `({ a = 1, b: { c = 2 } })` | `b.default = "2 }"` | `a` is right, `b` is invented |

Every one of them carries `confident: true`, so `compass knowledge` writes them into the
knowledge base as fact. The scanner's own doc comment states the rule it is breaking:
"Documentation that is wrong while claiming certainty is worse than none."

Done means: a prop whose name is followed by a nested pattern reports **no default**, and the
component keeps `confident: true` — the prop name is still known, only its interior is not.
`readProps` already loses interior detail for `({ a: { b }, c })` and `({ a: [x, y] })` without
claiming otherwise; this makes the `=` case behave the same way.

## Ràng buộc

- No new dependency, no AST parser. The scanner stays pattern-matching, per its own header comment.
- `scanComponents` keeps its current signature and return shape.
- A real default on the outer prop still reports that default. `({ x = { k: 1 }, y })` and
  `({ a: { b } = {} })` are correct on HEAD and must stay correct — the fix must separate
  "`=` after the nested pattern" from "`=` inside it".
- Do not lower `confident` for these shapes. The prop name is read correctly; only the default
  is unknown. Marking the whole component unreadable would lose information that is right today.

## Rủi ro hồi quy

- **Props after a nested pattern could vanish.** `({ a: { b = 1 }, d })` reports `d` today.
  A fix that scans for `{` and bails could drop it. EC2 measures `d` survives.
- **String-literal handling is load-bearing.** Two earlier bugs in this function came from
  braces inside strings (`close = '}'`). A change to brace or `=` handling can reopen them;
  E2 re-measures that shape.
- **A default that legitimately contains `{`.** `({ x = { k: 1 } })` is correct on HEAD. If the
  fix treats any `{` after `=` as nesting, this breaks. V1 measures it.
- **`usedIn` counting and the file walk are untouched** but share the module; the existing
  suite for them must stay green.
- **`.knowledge/derived/` regenerates differently** for any project with these shapes. That is
  the point of the fix, but a stale checked-in `derived/` will now disagree — it is gitignored
  here, so no in-repo fallout.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `({ a: { b = 1 } })` — object pattern holding a default | `props.a` deep-equals `{}`; no `default` key; `confident` is `true` | P0 |
| H2 | Happy | `({ a: { b = 1, c = 2 }, d })` — two nested defaults, one plain prop after | `props.a` is `{}`, `props.d` is `{}`; keys are exactly `['a','d']`; `confident` is `true` | P0 |
| H3 | Happy | `({ a: [x = 1] })` — array pattern holding a default | `props.a` deep-equals `{}`; `confident` is `true` | P0 |
| V1 | Validation | `({ x = { k: 1 }, y })` — real default that is an object literal | `props.x.default` is `{ k: 1 }`; `props.y` is `{}`; `confident` is `true` | P0 |
| V2 | Validation | `({ a: { b } = {} })` — nested pattern with a real default after it | `props.a.default` is `{}`; `confident` is `true` | P0 |
| V3 | Validation | `({ a = 1, b: { c = 2 } })` — one real default, one nested | `props.a.default` is `1`; `props.b` deep-equals `{}`; `confident` is `true` | P0 |
| E1 | Error | `({ a: { b = 1 )` — nested pattern never closed | `props` is `{}` and `confident` is `false`; `scanComponents` returns without throwing | P1 |
| E2 | Error | `({ close = '}', after })` — brace inside a string default | `props.close.default` is `'}'`; `props.after` is `{}`; `confident` is `true` | P0 |
| EC1 | Edge | `({ a: { b: { c = 1 } } })` — two levels of nesting | `props.a` deep-equals `{}`; `confident` is `true` | P1 |
| EC2 | Edge | `({ a: { b = 1 }, d, e = 2 })` — plain and defaulted props after a nested one | keys are exactly `['a','d','e']`; `props.e.default` is `2`; `props.a` is `{}` | P0 |
| EC3 | Edge | `({ a: {} })` — empty nested pattern | `props.a` deep-equals `{}`; `confident` is `true` | P2 |
| EC4 | Edge | `({ a: { b = '}' } })` — nested default whose value is a brace in a string | `props.a` deep-equals `{}`; `confident` is `true`; no key beyond `a` | P1 |
| S1 | Security | A nested default holding a path-like string (`({ a: { p = '../../etc/passwd' } })`) | `props.a` is `{}`; the string appears nowhere in the returned object | P2 |
| P1 | Performance | A component with 50 props, half of them nested patterns | `scanComponents` on that one file returns in under 200 ms | P2 |
