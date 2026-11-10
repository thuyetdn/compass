import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { knowledgeCommand } from '../../commands/knowledge.mjs';

// CP-103 (issue #6): ở dự án nhiều repo, gate `convention` đỏ ở repo chưa có
// `.knowledge/decided/conventions/<repo>.md`. Fixture nhiều repo của các test viết trước
// CP-103 đo chuyện khác (slot theo repo, test gộp, skip devUrl…), nên chúng ghi sẵn một
// convention viết tay, không luật, cho mỗi repo khai trong `repos`.
//
// Có `.knowledge/` thì gate `knowledge` đòi tài liệu máy sinh, nên helper sinh luôn — như
// một dự án thật vừa duyệt convention đầu tiên. Fixture còn thêm file nguồn sau đó thì tự
// gọi lại `knowledgeCommand({ sync: true })`.
export function approveConventions(root, config) {
  const names = config && typeof config.repos === 'object' && config.repos !== null ? Object.keys(config.repos) : [];
  for (const name of names) {
    const file = path.join(root, '.knowledge', 'decided', 'conventions', `${name}.md`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `# Convention của ${name}\n\nViết tay cho fixture, không có luật máy chạy.\n`);
  }
  if (names.length) knowledgeCommand({ cwd: root, sync: true });
}
