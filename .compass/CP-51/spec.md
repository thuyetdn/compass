# CP-51: The component scan reports `confident: true` over props it never read, and loses arrow components outright
Loại: bug
Phạm vi: lib/knowledge-scan.mjs, test/knowledge-scan.test.mjs
Gốc soi: f94ebdd

## Mục tiêu

SKILL.md makes one promise about the derived knowledge base: "Component nào không đọc được prop
thì đánh dấu `confident: false` — đừng tin phần đó." `lib/knowledge-scan.mjs` breaks it in two
places.

**`readProps` drops pieces silently.** `flush` (`:119-129`) takes the text before the first `:` or
top-level `=` as the prop name. If that name fails `/^[A-Za-z_$][A-Za-z0-9_$]*$/`, `:126` returns
without recording anything and without marking anything, and `:153` returns `confident: true`
regardless. A name that passes the pattern but is `__proto__` reaches `props[name] = …` at `:128`,
which sets the prototype of `props` instead of adding a key.

**The arrow pattern cannot see past a `)`.** `ARROW` (`:19`) reads the parameter list as
`\(([^)]*)\)\s*=>`. The first `)` inside a default value ends the capture, `=>` does not follow it,
and the regex finds no match at all. `DECLARATION` (`:18`) has the same `[^)]*`, but needs no `=>`
after it, so it matches a truncated list instead.

Measured on HEAD (f94ebdd), one `.tsx` file per row, through `scanComponents`:

| Source | Reported on HEAD |
|---|---|
| `export function S({ 'data-id': dataId, a, b })` | props `a`, `b` — `confident: true` |
| `export function C({ [key]: v, a })` | props `a` — `confident: true` |
| `export function U({ ñame, a })` | props `a` — `confident: true` |
| `export function K({ a, // the a` ⏎ ` b })` | props `a` — `confident: true`; `b` gone |
| `export function Q({ __proto__ = evil, a })` | props `a` — `confident: true`; `Object.getPrototypeOf(props)` is not `Object.prototype` and `props.default === "evil"` through the prototype |
| `export const Missing = ({ x = fallback(1), y }) => <i/>` | **component absent** |
| `export const Two = ({ x = fallback(1), y }) => …` followed by `export const After = ({ z }) => …` | `After` listed, `Two` absent |
| `export function Decl({ x = fallback(1), y })` | listed with props `{}` — `confident: false` |
| `export const AD = ({ onX = () => {}, y }) => <i/>` | listed with props `{}` — `confident: false` (the capture stopped at the `(` of `() =>`) |
| `export const Broken = ({ a = f(1, b }) => <i/>` (unbalanced) | props `a` with default `"f(1, b"` — **`confident: true`** |
| `export const Ok = ({ a, b = 2 }) => <i/>` | props `a`, `b` (default `2`) — `confident: true` (correct) |
| `export function R({ a, ...rest })` | props `a` — `confident: true` (correct: a rest element is read, not lost) |
| `export const Total = (a + b);` | not listed (correct: not an arrow) |

The worst rows are the ones that say `confident: true`. A reader who trusts the flag documents
`S` as taking two props, `Broken` as defaulting `a` to `f(1, b`, and never learns `Missing` exists.

Done means:

1. **Any piece of the destructuring `readProps` cannot turn into a prop name marks the whole
   component `confident: false`.** The props it *could* read are still recorded. A rest element
   (`...rest`) and the empty piece a trailing comma leaves are not failures and keep confidence.
2. **`__proto__` never reaches the prototype.** It is not recorded as a prop, the component is
   `confident: false`, and `props` stays a plain object whose prototype is `Object.prototype`.
3. **Parameter lists are found by a balanced scan, not by `[^)]*`.** The two regexes match only the
   header (`export [default] function Name(` and `export const Name[: Type] = (`). From that `(` a
   scan walks to the matching `)`, counting `(`/`)` and skipping string literals and comments the
   same way `readProps` skips strings today. An arrow header counts as a component only when `=>`
   (whitespace allowed) follows the matching `)` — as today.
4. **A list that cannot be balanced is still listed**, with `props: {}` and `confident: false`. The
   scan for one header gives up at the end of the file or at the next line starting with `export`,
   whichever comes first, so one broken header can neither swallow the component after it nor make
   the scan re-read the rest of the file once per header.

## Ràng buộc

- Pattern matching only. No AST parser, no new dependency — the file's own header comment and
  SKILL.md's "Giới hạn" paragraph state the reason, and that reason still holds.
- `scanComponents(root)` keeps its signature and its return shape `{ components, files }`. Each
  entry keeps exactly `{ path, props, confident, usedIn }`. No new field (such as a reason for
  the low confidence) in this task.
- `props` stays a plain `{}` object. `Object.create(null)` is not an option: `test/knowledge-scan.test.mjs`
  uses `assert/strict`, whose `deepEqual` compares prototypes, and `CP-42-E1` asserts
  `deepEqual(props, {})`.
- The `usedIn` pass (`importedNames`, `stripCommentsAndStrings`) is untouched.
- Out of scope, named so nobody chases them here: a regex literal holding `)` inside a default
  value (`({ re = /\)/ }) =>`) still unbalances the scan the wrong way; an arrow with a return
  type (`({ a }): JSX.Element =>`) and a bare-identifier arrow (`props =>`) are still not found.
  All three are missed today too. A follow-up task can take them.

## Rủi ro hồi quy

- **Components read correctly today could start reporting `confident: false`.** The new "any
  unreadable piece" rule is only right if it ignores the pieces that are not failures. V3 pins
  rest elements, trailing commas, renames (`a: alias`) and nested patterns (`a: { b = 1 }`) at
  `confident: true` with the same keys as today. CP-42's eleven nested-pattern tests and CP-10-V5
  (a TSX type object after the destructuring) must stay green unchanged.
- **The wider arrow match could invent components.** Today `[^)]*` plus `=>` rejects
  `export const Total = (a + b);` by accident; after the change it must be rejected on purpose,
  because the balanced `)` is not followed by `=>`. V4 measures that, with an unrelated arrow
  later in the same file to tempt a scan that looks too far.
- **The balanced scan now hands `readProps` the full parameter text, type annotation included.**
  Today a list like `({ onClick }: { onClick: () => void })` reaches `readProps` cut at the first
  `)` and works by luck. The existing test "a prop typed as a function signature survives" pins the
  declaration form; H3 pins an arrow whose default is itself an arrow.
- **An unbalanced header must not hide the next component.** EC1 puts a broken component and a
  correct one in the same file and asserts the second keeps its props and confidence.
- **The derived file changes for affected components.** `knowledge` compares `components.json`
  byte for byte with a fresh scan, so a project holding such components sees the gate go red once
  after upgrading, until `compass knowledge --sync`. That is the intended result — the old file
  claimed a certainty it did not have — and it is called out here so it is not mistaken for a
  regression. The `--sync` summary line counting unsure components will also grow.
- **`usedIn` and first-definition-wins.** Neither is touched; CP-10-H2 and CP-10-EC3…EC13 must stay
  green.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `export const Missing = ({ x = fallback(1), y }) => <i/>;` | `Missing` is listed; keys are exactly `['x', 'y']`; `x.default === 'fallback(1)'`; `confident === true` | P0 |
| H2 | Happy | `export function Decl({ x = fallback(1), y }) { … }` | keys `['x', 'y']`; `x.default === 'fallback(1)'`; `confident === true` (HEAD: props `{}`, `confident: false`) | P0 |
| H3 | Happy | `export const AD = ({ onX = () => {}, y }) => <i/>;` | keys `['onX', 'y']`; `onX.default === '() => {}'`; `confident === true` | P1 |
| V1 | Validation | `export function S({ 'data-id': dataId, a, b })`, and the same with a double-quoted key `"aria-label": label` | `a` and `b` are recorded; `confident === false` in both | P0 |
| V2 | Validation | `export function C({ [key]: v, a })` | `a` is recorded; `confident === false` | P0 |
| V3 | Validation | Four components: `({ a, ...rest })`, `({ a, b, })`, `({ a: alias, b })`, `({ a: { b = 1 }, d })` | `confident === true` for all four; keys `['a']`, `['a','b']`, `['a','b']`, `['a','d']` | P0 |
| V4 | Validation | A file holding `export const Total = (a + b);` then `const f = (x) => x;` | `components` is `{}` — `Total` is not reported as a component | P1 |
| E1 | Error | `export const Broken = ({ a = f(1, b }) => <i/>;` — the parameter list never balances | `Broken` is listed with `props` deep-equal to `{}` and `confident === false` (HEAD: `a.default === 'f(1, b'`, `confident: true`) | P0 |
| E2 | Error | A file that ends inside a declaration's parameter list: `export function Cut({ a, b` | no throw; `Cut` is listed with `props` `{}` and `confident === false` | P1 |
| EC1 | Edge | One file: the unbalanced `Broken` of E1, then on a later line `export const After = ({ z }) => <i/>;` | `After` has keys `['z']` and `confident === true`; `Broken` is `confident: false` | P0 |
| EC2 | Edge | `export function U({ ñame, a })` — a name outside the ASCII pattern | `a` is recorded; `confident === false` | P2 |
| EC3 | Edge | `export function K({ a, // the a` ⏎ ` b })` — a comment inside the destructuring | `confident === false` (HEAD: keys `['a']` with `confident: true`) | P1 |
| EC4 | Edge | `export const P = ({ close = ')', after }) => <i/>;` — a `)` inside a string default | listed; `close.default === "')'"`; `after` recorded; `confident === true` | P1 |
| EC5 | Edge | `export const M = ({ a, /* ) */ b }) => <i/>;` — a `)` inside a comment in the list | `M` is listed (not absent); `confident === false` per the EC3 rule | P2 |
| S1 | Security | `export function Q({ __proto__ = evil, a })` | `Object.keys(props)` is `['a']`; `Object.getPrototypeOf(props) === Object.prototype`; `'default' in props === false`; `confident === false`; `JSON.stringify` of the entry does not contain `evil` | P0 |
