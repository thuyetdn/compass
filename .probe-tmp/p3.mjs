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

function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'probe3-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'),
    JSON.stringify({ test: 'node -e "console.log(String.fromCharCode(72,49)+\' ok\'); console.log(String.fromCharCode(72,50)+\' ok\')"' }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'Button.jsx'), 'export function Button({ a }) { return <b/>; }\n');
  return root;
}

const root = repo();
// baseline: sync then check
knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
let c = await checkCommand({ cwd: root, taskId: 'T-1' });
console.log('check#1 exit', c.exitCode);
let d = doneCommand({ cwd: root, taskId: 'T-1' });
console.log('done#1 exit', d.exitCode);
console.log(d.output);

console.log('\n--- now edit source WITHOUT sync, and delete .knowledge ---');
writeFileSync(path.join(root, 'src', 'Button.jsx'), 'export function Button({ TOTALLY_NEW }) { return <i/>; }\n');
rmSync(path.join(root, '.knowledge'), { recursive: true, force: true });
c = await checkCommand({ cwd: root, taskId: 'T-1' });
console.log('check#2 exit', c.exitCode);
d = doneCommand({ cwd: root, taskId: 'T-1' });
console.log('done#2 exit', d.exitCode);
console.log(d.output);
rmSync(root, { recursive: true, force: true });
