import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkCommand } from '../commands/check.mjs';
import { knowledgeCommand } from '../commands/knowledge.mjs';
import { doneCommand } from '../commands/done.mjs';

const SPEC = `# T-1: Tieu de
Loại: fix
Phạm vi: src/

## Mục tiêu
x

## Ràng buộc
x

## Rủi ro hồi quy
x

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | a | b | P0 |
| H2 | Happy | c | d | P0 |
`;
const TAP = ['console.log("ok 1 - H1")','console.log("ok 2 - H2")'].join('\n');

function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'probe5-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, 'runtests.mjs'), TAP);
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'node runtests.mjs' }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });
  writeFileSync(path.join(root, '.knowledge', 'decided', 'conventions.md'), '# rules\n');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'Button.jsx'), 'export function Button({ a }) { return <b/>; }\n');
  return root;
}

async function scenario(name, mutate) {
  const root = repo();
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const base = doneCommand({ cwd: root, taskId: 'T-1' });
  if (base.exitCode !== 0) { console.log(name, 'BASELINE BROKEN', base.output); rmSync(root,{recursive:true,force:true}); return; }
  mutate(root);
  const c = await checkCommand({ cwd: root, taskId: 'T-1' });
  const d = doneCommand({ cwd: root, taskId: 'T-1' });
  console.log(`${name}: check=${c.exitCode} done=${d.exitCode}` + (d.exitCode===0 ? '  <<< CLOSED' : ''));
  if (d.exitCode !== 0) console.log('   ', d.output.split('\n').slice(0,4).join(' | '));
  rmSync(root, { recursive: true, force: true });
}

// 1. Edit source, don't sync (expected: blocked)
await scenario('1 edit src no sync', (r) => {
  writeFileSync(path.join(r,'src','Button.jsx'), 'export function Button({ NEW }) { return <i/>; }\n');
});
// 2. Edit source, delete derived/ only (decided/ still there)
await scenario('2 edit src + rm derived/', (r) => {
  writeFileSync(path.join(r,'src','Button.jsx'), 'export function Button({ NEW }) { return <i/>; }\n');
  rmSync(path.join(r,'.knowledge','derived'), { recursive:true, force:true });
});
// 3. Edit source, delete whole .knowledge
await scenario('3 edit src + rm .knowledge', (r) => {
  writeFileSync(path.join(r,'src','Button.jsx'), 'export function Button({ NEW }) { return <i/>; }\n');
  rmSync(path.join(r,'.knowledge'), { recursive:true, force:true });
});
// 4. Edit source + sync (legit path)
await scenario('4 edit src + sync', (r) => {
  writeFileSync(path.join(r,'src','Button.jsx'), 'export function Button({ NEW }) { return <i/>; }\n');
  knowledgeCommand({ cwd: r, taskId: 'T-1', sync: true });
});
