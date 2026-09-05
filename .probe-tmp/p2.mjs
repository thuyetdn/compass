// Probe: full done flow. Does deleting .knowledge/derived let done close with stale docs?
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { knowledgeCommand } from '../commands/knowledge.mjs';
import { doneCommand } from '../commands/done.mjs';
import { specCommand } from '../commands/spec.mjs';
import { testCommand } from '../commands/test.mjs';
import { hashSource } from '../lib/source-hash.mjs';

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
  const root = mkdtempSync(path.join(tmpdir(), 'probe2-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'node -e "console.log(\'H1 ok\'); console.log(\'H2 ok\')"' }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);
  mkdirSync(path.join(root, '.knowledge', 'decided'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'Button.jsx'), 'export function Button({ a }) { return <b/>; }\n');
  return root;
}

const root = repo();
console.log('hashSource with .knowledge present :', hashSource(root).slice(0,20));
rmSync(path.join(root, '.knowledge'), { recursive: true, force: true });
console.log('hashSource with .knowledge deleted :', hashSource(root).slice(0,20));
rmSync(root, { recursive: true, force: true });
