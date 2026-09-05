import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, taskDir, evidenceDir, validateTaskId } from '../lib/paths.mjs';
import { parseInvestigation, validateForClose } from '../lib/investigation-parser.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

const TEMPLATE = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'investigation.md',
);
const FILE = 'investigation.md';
const PITFALLS = path.join('.knowledge', 'decided', 'pitfalls.md');

const RULES = [
  'Không sửa code khi đang điều tra — sửa là task BUILD riêng.',
  'Mỗi giả thuyết phải nêu cách kiểm TRƯỚC khi kiểm. Không "để tôi xem thử".',
  'Kết luận phải dẫn về bằng chứng, không phải suy luận.',
];

function docPath(root, id) {
  return path.join(taskDir(root, id), FILE);
}

export function investigateCommand({ cwd, taskId, close }) {
  if (!taskId) {
    return { exitCode: 2, output: 'Thiếu id.\nDùng: compass investigate <id> [--close]' };
  }

  const validation = validateTaskId(taskId);
  if (!validation.ok) return { exitCode: 2, output: validation.reason };

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const file = docPath(root, taskId);

  if (!close) {
    // Opening twice would throw away whatever has been found so far.
    if (existsSync(file)) {
      return {
        exitCode: 2,
        output: [
          fail('investigate', [`Điều tra ${taskId} đã mở rồi: .compass/${taskId}/${FILE}`]),
          '',
          hint(`Điền tiếp hồ sơ, xong thì: compass investigate ${taskId} --close`),
        ].join('\n'),
      };
    }

    let template;
    try {
      template = readFileSync(TEMPLATE, 'utf8');
    } catch (err) {
      return { exitCode: 2, output: `Không đọc được template điều tra: ${err.message}` };
    }

    try {
      mkdirSync(taskDir(root, taskId), { recursive: true });
      writeFileSync(file, template.replace(/<INV-ID>/g, taskId));
    } catch (err) {
      return { exitCode: 2, output: `Không tạo được hồ sơ điều tra: ${err.message}` };
    }

    return {
      exitCode: 0,
      output: [
        `Đã mở điều tra ${taskId}`,
        `  hồ sơ: .compass/${taskId}/${FILE}`,
        '',
        'Ba luật cứng:',
        ...RULES.map((r, i) => `  ${i + 1}. ${r}`),
        '',
        hint(`Điền hồ sơ, script thăm dò lưu vào .compass/scripts/, xong thì: compass investigate ${taskId} --close`),
      ].join('\n'),
    };
  }

  if (!existsSync(file)) {
    return {
      exitCode: 2,
      output: [
        fail('investigate', [`Chưa mở điều tra ${taskId}.`]),
        '',
        hint(`Mở trước: compass investigate ${taskId}`),
      ].join('\n'),
    };
  }

  let markdown;
  try {
    markdown = readFileSync(file, 'utf8');
  } catch (err) {
    return { exitCode: 2, output: `Không đọc được hồ sơ: ${err.message}` };
  }

  const parsed = parseInvestigation(markdown);
  const result = validateForClose(parsed);

  if (!result.ok) {
    return {
      exitCode: 1,
      output: [
        fail('investigate', ['Chưa đóng được, hồ sơ còn thiếu:', ...result.errors]),
        '',
        hint('Điều tra đóng bằng bằng chứng, không bằng cảm giác đã hiểu.'),
      ].join('\n'),
    };
  }

  // The pitfall is why the loop exists: without it the next person meets the
  // same trap with nothing written down.
  const pitfallFile = path.join(root, PITFALLS);
  let pitfallWritten = false;
  try {
    mkdirSync(path.dirname(pitfallFile), { recursive: true });
    if (!existsSync(pitfallFile)) {
      writeFileSync(pitfallFile, '# Bẫy đã từng sập\n\nMỗi mục đến từ một điều tra đã đóng.\n');
    }
    const title = markdown.split('\n')[0].replace(/^#\s*/, '').trim();
    // A file that does not end in a newline would run the heading into the last
    // paragraph of the previous entry.
    const existing = readFileSync(pitfallFile, 'utf8');
    const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
    appendFileSync(pitfallFile, `${separator}\n## ${title}\n\n${parsed.pitfall}\n`);
    pitfallWritten = true;
  } catch { /* recorded below as not written */ }

  mkdirSync(evidenceDir(root, taskId), { recursive: true });
  writeGate(root, taskId, {
    gate: 'investigate',
    exitCode: 0,
    checkedAt: new Date().toISOString(),
    docHash: hashFile(file),
    hypothesisCount: parsed.hypotheses.length,
    pitfallWritten,
  });

  const lines = [
    pass('investigate', `${taskId} đóng — ${parsed.hypotheses.length} giả thuyết đã kiểm`),
  ];
  lines.push('', pitfallWritten
    ? `Pitfall đã ghi vào ${PITFALLS}`
    : `Không ghi được ${PITFALLS} — chép tay mục Pitfall vào đó.`);
  if (parsed.nextSteps && !/không cần/i.test(parsed.nextSteps)) {
    lines.push('', `Việc tiếp theo: ${parsed.nextSteps.split('\n')[0]}`);
  }

  return { exitCode: 0, output: lines.join('\n') };
}
