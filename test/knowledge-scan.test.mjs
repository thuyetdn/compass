import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanComponents } from '../lib/knowledge-scan.mjs';

function makeTree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-know-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const BUTTON = `
export function Button({ variant = 'primary', size = 'medium', disabled, onClick }) {
  return <button className={variant} onClick={onClick} disabled={disabled}>{size}</button>;
}
`;

test('H1 a component and its props are extracted', () => {
  const root = makeTree({ 'src/Button.jsx': BUTTON });
  const { components } = scanComponents(root);

  assert.ok(components.Button, 'phải tìm thấy Button');
  assert.equal(components.Button.path, 'src/Button.jsx');
  assert.deepEqual(
    Object.keys(components.Button.props).sort(),
    ['disabled', 'onClick', 'size', 'variant'],
  );
});

test('a default value is recorded with the prop', () => {
  const root = makeTree({ 'src/Button.jsx': BUTTON });
  const { components } = scanComponents(root);
  assert.equal(components.Button.props.variant.default, "'primary'");
  assert.equal(components.Button.props.disabled.default, undefined);
});

test('H2 usedIn counts the files that import the component', () => {
  const root = makeTree({
    'src/Button.jsx': BUTTON,
    'src/Page.jsx': "import { Button } from './Button';\nexport const Page = () => <Button />;\n",
    'src/Other.jsx': "import { Button } from './Button';\nexport const Other = () => <Button />;\n",
    'src/None.jsx': 'export const None = () => null;\n',
  });
  const { components } = scanComponents(root);
  assert.equal(components.Button.usedIn, 2);
});

test('EC3 a component nobody imports is listed with usedIn zero', () => {
  const root = makeTree({ 'src/Dead.jsx': 'export function Dead() { return null; }\n' });
  const { components } = scanComponents(root);
  assert.equal(components.Dead.usedIn, 0);
});

test('EC4 jsx and tsx are both scanned', () => {
  const root = makeTree({
    'src/A.jsx': 'export function A({ x }) { return <i>{x}</i>; }\n',
    'src/B.tsx': 'export function B({ y }) { return <i>{y}</i>; }\n',
  });
  const { components } = scanComponents(root);
  assert.ok(components.A && components.B);
});

test('V4 a prop shape the scanner cannot read is flagged, not invented', () => {
  const root = makeTree({
    'src/Odd.jsx': 'export function Odd(props) { return <i>{props.anything}</i>; }\n',
  });
  const { components } = scanComponents(root);
  assert.equal(components.Odd.confident, false);
  assert.deepEqual(components.Odd.props, {});
});

test('a destructured component is marked confident', () => {
  const root = makeTree({ 'src/Button.jsx': BUTTON });
  const { components } = scanComponents(root);
  assert.equal(components.Button.confident, true);
});

test('an arrow function component is found too', () => {
  const root = makeTree({
    'src/Card.jsx': 'export const Card = ({ title }) => <div>{title}</div>;\n',
  });
  const { components } = scanComponents(root);
  assert.ok(components.Card);
  assert.deepEqual(Object.keys(components.Card.props), ['title']);
});

test('a lowercase function is not a component', () => {
  const root = makeTree({
    'src/util.js': 'export function helper({ a }) { return a; }\n',
  });
  const { components } = scanComponents(root);
  assert.deepEqual(components, {});
});

test('E3 a missing source directory yields nothing rather than throwing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-know-'));
  const { components, files } = scanComponents(root);
  assert.deepEqual(components, {});
  assert.deepEqual(files, []);
});

test('node_modules is never scanned', () => {
  const root = makeTree({
    'src/A.jsx': 'export function A({ x }) { return <i>{x}</i>; }\n',
    'node_modules/pkg/B.jsx': 'export function B({ y }) { return <i>{y}</i>; }\n',
  });
  const { components } = scanComponents(root);
  assert.ok(components.A);
  assert.equal(components.B, undefined);
});

test('S1 a component name with odd characters cannot break the output', () => {
  const root = makeTree({
    'src/Weird.jsx': 'export function Wei"rd({ x }) { return <i>{x}</i>; }\n',
  });
  const { components } = scanComponents(root);
  // Either it is skipped or the name survives as data; JSON must stay valid.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(components)));
  assert.equal(components['Wei"rd'], undefined);
});

test('the scanned file list is returned so a manifest can hash it', () => {
  const root = makeTree({
    'src/A.jsx': 'export function A({ x }) { return <i>{x}</i>; }\n',
    'src/B.jsx': 'export function B({ y }) { return <i>{y}</i>; }\n',
  });
  const { files } = scanComponents(root);
  assert.deepEqual(files.sort(), ['src/A.jsx', 'src/B.jsx']);
});

test('EC5 a component named only in a comment is not counted as used', () => {
  const root = makeTree({
    'src/Orphan.jsx': 'export function Orphan({ x }) { return <i>{x}</i>; }\n',
    'src/Page.jsx': "import { Other } from './Other';\n// TODO: xóa Orphan, không ai dùng nữa\nexport const Page = () => <Other/>;\n",
    'src/Other.jsx': 'export function Other() { return null; }\n',
  });
  const { components } = scanComponents(root);
  assert.equal(components.Orphan.usedIn, 0);
});

test('EC6 a component name inside a string is not a use', () => {
  const root = makeTree({
    'src/Orphan.jsx': 'export function Orphan({ x }) { return <i>{x}</i>; }\n',
    'src/log.js': "import { fmt } from './fmt';\nexport const msg = fmt('Orphan record found');\n",
    'src/fmt.js': 'export const fmt = (s) => s;\n',
  });
  const { components } = scanComponents(root);
  assert.equal(components.Orphan.usedIn, 0);
});

test('EC7 a renamed import still counts as a use', () => {
  const root = makeTree({
    'src/Button.jsx': 'export function Button({ x }) { return <b>{x}</b>; }\n',
    'src/Page.jsx': "import { Button as Btn } from './Button';\nexport const Page = () => <Btn/>;\n",
  });
  const { components } = scanComponents(root);
  assert.equal(components.Button.usedIn, 1);
});

test('a default import counts as a use', () => {
  const root = makeTree({
    'src/Button.jsx': 'export function Button({ x }) { return <b>{x}</b>; }\n',
    'src/Page.jsx': "import Button from './Button';\nexport const Page = () => <Button/>;\n",
  });
  const { components } = scanComponents(root);
  assert.equal(components.Button.usedIn, 1);
});

test('a require call counts as a use', () => {
  const root = makeTree({
    'src/Button.jsx': 'export function Button({ x }) { return <b>{x}</b>; }\n',
    'src/legacy.js': "const { Button } = require('./Button');\nmodule.exports = Button;\n",
  });
  const { components } = scanComponents(root);
  assert.equal(components.Button.usedIn, 1);
});

test('V5 a TSX prop list with a type object keeps every prop', () => {
  // `lastIndexOf('}')` used to grab the type object's closing brace, dropping
  // half the props while still claiming confidence.
  const root = makeTree({
    'src/Card.tsx': 'export function Card({ title, count }: { title: string; count: number }) { return null; }\n',
  });
  const { components } = scanComponents(root);
  assert.deepEqual(Object.keys(components.Card.props).sort(), ['count', 'title']);
  assert.equal(components.Card.confident, true);
});

test('a single TSX prop with a type object is not lost entirely', () => {
  const root = makeTree({
    'src/One.tsx': 'export function One({ label }: { label: string }) { return null; }\n',
  });
  const { components } = scanComponents(root);
  assert.deepEqual(Object.keys(components.One.props), ['label']);
});

test('a prop typed as a function signature survives', () => {
  const root = makeTree({
    'src/Btn.tsx': 'export function Btn({ onClick }: { onClick: () => void }) { return null; }\n',
  });
  const { components } = scanComponents(root);
  assert.deepEqual(Object.keys(components.Btn.props), ['onClick']);
});

test('EC8 an import that has been commented out is not a use', () => {
  const root = makeTree({
    'src/Orphan.jsx': 'export function Orphan({ x }) { return <i>{x}</i>; }\n',
    'src/Page.jsx': "// import { Orphan } from './Orphan';\nexport const Page = () => null;\n",
  });
  const { components } = scanComponents(root);
  assert.equal(components.Orphan.usedIn, 0);
});

test('an import inside a block comment is not a use', () => {
  const root = makeTree({
    'src/Orphan.jsx': 'export function Orphan({ x }) { return <i>{x}</i>; }\n',
    'src/Page.jsx': "/* import { Orphan } from './Orphan'; */\nexport const Page = () => null;\n",
  });
  const { components } = scanComponents(root);
  assert.equal(components.Orphan.usedIn, 0);
});

test('EC9 an import-shaped string is not a use', () => {
  const root = makeTree({
    'src/Orphan.jsx': 'export function Orphan({ x }) { return <i>{x}</i>; }\n',
    'src/doc.js': 'export const example = `import Orphan from "./Orphan"`;\n',
  });
  const { components } = scanComponents(root);
  assert.equal(components.Orphan.usedIn, 0);
});

test('EC10 a regex literal containing a quote does not swallow the import below it', () => {
  // `/['"]/g` has a lone quote. Treating it as a string opened a phantom one
  // that ran to the next quote — usually the import path on the line after —
  // and a live component came back as used by nobody.
  const root = makeTree({
    'src/A.jsx': 'export function A({ x }) { return <i>{x}</i>; }\n',
    'src/Page.jsx': `const quoteRe = /['"]/g;\nimport { A } from './A';\nexport const Page = () => <A/>;\n`,
  });
  const { components } = scanComponents(root);
  assert.equal(components.A.usedIn, 1);
});

test('a character class holding a slash does not end the regex early', () => {
  const root = makeTree({
    'src/A.jsx': 'export function A({ x }) { return <i>{x}</i>; }\n',
    'src/Page.jsx': `const sep = /[/\\]/;\nimport { A } from './A';\nexport const Page = () => <A/>;\n`,
  });
  const { components } = scanComponents(root);
  assert.equal(components.A.usedIn, 1);
});

test('division is not mistaken for a regex', () => {
  const root = makeTree({
    'src/A.jsx': 'export function A({ x }) { return <i>{x}</i>; }\n',
    'src/Page.jsx': `const ratio = width / height;\nimport { A } from './A';\nexport const Page = () => <A/>;\n`,
  });
  const { components } = scanComponents(root);
  assert.equal(components.A.usedIn, 1);
});

test('V6 a typed non-destructured parameter yields no props and admits it', () => {
  // `props: { alpha: string; beta: number }` — that brace opens the type, not a
  // binding pattern. Mining it invented `alpha` as a prop of a parameter named
  // `props`, and called the result confident.
  const root = makeTree({
    'src/Bare.tsx': 'export function Bare(props: { alpha: string; beta: number }) { return null; }\n',
  });
  const { components } = scanComponents(root);
  assert.deepEqual(components.Bare.props, {});
  assert.equal(components.Bare.confident, false);
});

test('a destructured parameter with an inline type is still read', () => {
  const root = makeTree({
    'src/Ok.tsx': 'export function Ok({ alpha, beta }: { alpha: string; beta: number }) { return null; }\n',
  });
  const { components } = scanComponents(root);
  assert.deepEqual(Object.keys(components.Ok.props).sort(), ['alpha', 'beta']);
  assert.equal(components.Ok.confident, true);
});

test('EC11 a regex after a keyword is a regex, not a division', () => {
  // `return /['"]/` ends in the `n` of return, which reads as an identifier
  // and so as division — the quote then opened a phantom string that ate the
  // import below. Looking at one character was never enough.
  const root = makeTree({
    'src/Card.jsx': 'export function Card({ x }) { return <i>{x}</i>; }\n',
    'src/Page.jsx': `export const has = (s) => { return /['"]/.test(s); };\nimport { Card } from './Card';\nexport const Page = () => <Card/>;\n`,
  });
  const { components } = scanComponents(root);
  assert.equal(components.Card.usedIn, 1);
});

test('every keyword that precedes a value is handled, not just return', () => {
  for (const keyword of ['return', 'typeof', 'case', 'yield']) {
    const root = makeTree({
      'src/Card.jsx': 'export function Card({ x }) { return <i>{x}</i>; }\n',
      'src/Page.jsx': `function f(s) { ${keyword} /['"]/.test(s); }\nimport { Card } from './Card';\nexport const Page = () => <Card/>;\n`,
    });
    const { components } = scanComponents(root);
    assert.equal(components.Card.usedIn, 1, `sau "${keyword}" phải nhận là regex`);
  }
});

test('EC12 a default value holding a brace does not cut the prop list short', () => {
  // `close = '}'` closed the destructuring early and drove the comma splitter
  // negative, so every prop behind it vanished — while confident stayed true.
  const root = makeTree({
    'src/Tpl.jsx': `export function Tpl({ close = '}', label, onSave }) { return null; }\n`,
  });
  const { components } = scanComponents(root);
  assert.deepEqual(Object.keys(components.Tpl.props).sort(), ['close', 'label', 'onSave']);
});

test('a default value holding a comma does not split the prop list', () => {
  const root = makeTree({
    'src/S.jsx': `export function S({ sep = 'a, b', label }) { return null; }\n`,
  });
  const { components } = scanComponents(root);
  assert.deepEqual(Object.keys(components.S.props).sort(), ['label', 'sep']);
});

test('EC13 a regex after any value-position keyword is read as a regex', () => {
  // Fixed one keyword at a time twice — `return`, then `throw`. Sweep the whole
  // list instead, so the next omission fails here rather than in a review.
  const keywords = [
    'return', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void',
    'yield', 'await', 'case', 'do', 'else', 'new',
  ];

  for (const keyword of keywords) {
    const root = makeTree({
      'src/Card.jsx': 'export function Card({ x }) { return <i>{x}</i>; }\n',
      'src/Page.jsx': `function probe(s) { ${keyword} /['"]/.test(s); }\nimport { Card } from './Card';\nexport const Page = () => <Card/>;\n`,
    });
    const { components } = scanComponents(root);
    assert.equal(components.Card.usedIn, 1,
      `sau "${keyword}" phải nhận là regex — thiếu nó thì dấu nháy mở chuỗi ma nuốt dòng import`);
  }
});

test('an identifier that merely looks like a keyword is still division', () => {
  // `min / max` must not be read as a regex opening.
  const root = makeTree({
    'src/Card.jsx': 'export function Card({ x }) { return <i>{x}</i>; }\n',
    'src/Page.jsx': `const ratio = min / max;\nimport { Card } from './Card';\nexport const Page = () => <Card/>;\n`,
  });
  const { components } = scanComponents(root);
  assert.equal(components.Card.usedIn, 1);
});
