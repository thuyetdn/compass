import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { knowledgeCommand } from '../commands/knowledge.mjs';

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

function repo(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'probe-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'true' }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });
  for (const [rel, c] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, c);
  }
  return root;
}
const BTN = 'export function Button({ a }) { return <b/>; }\n';

{
  const root = repo({ 'src/Button.jsx': BTN, 'src/styles.css': '.a{}\n' });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, 'src', 'styles.css'), '.a{color:red}\n');
  const r = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  console.log('A css change ->', r.exitCode);
  rmSync(root, { recursive: true, force: true });
}
{
  const root = repo({ 'src/Button.jsx': BTN });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, 'src', 'New.vue'), '<template/>\n');
  const r = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  console.log('B vue added ->', r.exitCode);
  rmSync(root, { recursive: true, force: true });
}
{
  const root = repo({ 'src/Button.jsx': BTN });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  rmSync(path.join(root, '.knowledge', 'derived', '.manifest'));
  const r = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  console.log('C manifest deleted ->', r.exitCode);
  rmSync(root, { recursive: true, force: true });
}
{
  const root = repo({ 'src/Button.jsx': BTN });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, 'src', 'Button.jsx'), 'export function Button({ a }) { return <i/>; }\n');
  const r = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  console.log('D body edit ->', r.exitCode);
  rmSync(root, { recursive: true, force: true });
}
// E: entire .knowledge directory removed after gates ran -> gate says "not used", passes
{
  const root = repo({ 'src/Button.jsx': BTN });
  knowledgeCommand({ cwd: root, taskId: 'T-1', sync: true });
  writeFileSync(path.join(root, 'src', 'Button.jsx'), 'export function Button({ CHANGED }) { return <i/>; }\n');
  let r = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  console.log('E before rm .knowledge ->', r.exitCode);
  rmSync(path.join(root, '.knowledge'), { recursive: true, force: true });
  r = knowledgeCommand({ cwd: root, taskId: 'T-1' });
  console.log('E after rm .knowledge ->', r.exitCode, r.output.split('\n')[0]);
  rmSync(root, { recursive: true, force: true });
}
