import { mkdtempSync, mkdirSync, writeFileSync, linkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Repo mẫu cho CP-82. Bản nháp chỉ đếm file đã theo dõi, nên mọi file khai lúc
// dựng đều được `git add` (không cần commit: index là đủ cho `ls-files`).

export const SPEC = `# T-1: Việc mẫu
Loại: fix
Phạm vi: src/

## Mục tiêu
Một việc mẫu.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

export function put(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

export function makeRepo(files = {}, { git = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-cp82-'));
  put(root, '.compass/config.json', JSON.stringify({ test: 'true' }));
  put(root, '.compass/T-1/spec.md', SPEC);
  for (const [rel, body] of Object.entries(files)) put(root, rel, body);
  if (git) {
    execFileSync('git', ['init', '-q', '.'], { cwd: root, stdio: 'ignore' });
    gitAdd(root);
  }
  return root;
}

export function gitAdd(root) {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
}

// Một file JS theo đúng kiểu cho trước. `extra` thêm dòng thân hàm cho đủ cỡ.
export function codeFile({ quote = 'single', semi = false, indent = 2, name = 'thing', extra = 0 } = {}) {
  const q = quote === 'single' ? "'" : '"';
  const end = semi ? ';' : '';
  const pad = (n) => ' '.repeat(indent * n);
  const body = Array.from({ length: extra }, (_, i) => `${pad(1)}const v${i} = ${q}value ${i}${q}${end}`);
  return [
    `import { helper } from ${q}./helper.js${q}${end}`,
    '',
    `export function ${name}(input) {`,
    ...body,
    `${pad(1)}if (input) {`,
    `${pad(2)}return helper(${q}yes${q})${end}`,
    `${pad(1)}}`,
    `${pad(1)}return ${q}no${q}${end}`,
    '}',
    '',
  ].join('\n');
}

// Repo `count` file cùng một nội dung, cho test hiệu năng. Mỗi file là một hard
// link tới cùng một bản: đọc lên vẫn là `count` file thật với đủ nội dung, mà dựng
// không phải ghi lại hàng chục MB — ghi thật mất 12 giây trên Windows cho 60 MB.
// NTFS cho một file tối đa 1.023 link, nên cứ 1.000 link thì một bản gốc mới.
export function manyFiles(count, body) {
  const root = makeRepo();
  let source = null;
  for (let i = 0; i < count; i += 1) {
    if (i % 1000 === 0) {
      source = path.join(root, '.compass', `shared-body-${i / 1000}.js`);
      writeFileSync(source, body);
    }
    const rel = path.join(root, 'src', `d${Math.floor(i / 100)}`, `mod-${i}.js`);
    if (i % 100 === 0) mkdirSync(path.dirname(rel), { recursive: true });
    linkSync(source, rel);
  }
  gitAdd(root);
  return root;
}

// `count` file `src/<prefix>-NN.js`, tên kebab-case, cùng một kiểu.
export function codeFiles(count, style = {}, { dir = 'src', prefix = 'part' } = {}) {
  const out = {};
  for (let i = 0; i < count; i += 1) {
    out[`${dir}/${prefix}-${String(i).padStart(4, '0')}.js`] = codeFile({ ...style, name: `fn${i}` });
  }
  return out;
}
