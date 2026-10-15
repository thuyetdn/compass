import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { findRoot, specPath, validateTaskId } from '../lib/paths.mjs';
import { renderKnowledgePage } from '../lib/knowledge-page.mjs';
import { scanComponents } from '../lib/knowledge-scan.mjs';
import { buildManifest, compareManifest } from '../lib/manifest.mjs';
import { writeGate } from '../lib/gate-store.mjs';
import { hashFile } from '../lib/hash.mjs';
import { pass, fail, hint } from '../lib/report.mjs';
import { hashSource } from '../lib/source-hash.mjs';

const KNOWLEDGE = '.knowledge';
const DERIVED = path.join(KNOWLEDGE, 'derived');
const MANIFEST = path.join(DERIVED, '.manifest');
const COMPONENTS = path.join(DERIVED, 'components.json');
const DECIDED = path.join(KNOWLEDGE, 'decided');
const PAGE = path.join(DERIVED, 'index.html');

// Tài liệu người viết, đọc theo thứ tự tên để hai lần chạy ra cùng một trang.
// Thư mục không có thì trả mảng rỗng — dự án chỉ dùng phần máy quét vẫn xem
// được trang.
function readDecided(root) {
  const dir = path.join(root, DECIDED);
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.md')).sort();
  } catch {
    return [];
  }

  const docs = [];
  for (const name of names) {
    try {
      docs.push({ name, text: readFileSync(path.join(dir, name), 'utf8') });
    } catch {
      // File đọc không được thì bỏ qua: trang thiếu một mục còn hơn không có
      // trang. Gate `knowledge` vẫn là chỗ báo tài liệu hỏng.
    }
  }
  return docs;
}

// `--page`: dựng trang xem bằng trình duyệt từ những gì đã có trên đĩa.
//
// Nó **đọc** `components.json` chứ không quét lại code. Quét lại thì trang có
// thể hiện một tập component khác với tập gate vừa phán — và lúc đó không ai
// biết tin cái nào. Trang cũ hơn code thì `compass knowledge` đã đỏ sẵn để báo.
function pageMode(root) {
  const componentsFile = path.join(root, COMPONENTS);
  let components = {};
  let scanned = true;

  if (existsSync(componentsFile)) {
    try {
      components = JSON.parse(readFileSync(componentsFile, 'utf8'));
    } catch {
      return {
        exitCode: 2,
        output: fail('knowledge', [`${COMPONENTS} không đọc được — JSON hỏng.`, 'Chạy lại: compass knowledge --sync']),
      };
    }
  } else {
    scanned = false;
  }

  const html = renderKnowledgePage({ components, decided: readDecided(root), scanned });

  try {
    mkdirSync(path.join(root, DERIVED), { recursive: true });
    writeFileSync(path.join(root, PAGE), html);
  } catch (err) {
    return { exitCode: 2, output: fail('knowledge', [`Không ghi được ${PAGE}: ${err.message}`]) };
  }

  const count = Object.keys(components).length;
  const lines = [pass('knowledge', `đã ghi trang xem: ${count} component`)];
  if (!scanned) lines.push('', 'Máy quét chưa chạy — trang chỉ có phần tài liệu người viết.');
  lines.push('', hint(`Mở bằng trình duyệt: ${path.join(root, PAGE)}`));
  return { exitCode: 0, output: lines.join('\n') };
}

function readManifest(root) {
  const file = path.join(root, MANIFEST);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { broken: true }; // corrupt reads as stale, never as fresh
  }
}

function writeDerived(root, scan) {
  const dir = path.join(root, DERIVED);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, COMPONENTS), JSON.stringify(scan.components, null, 2) + '\n');
  writeFileSync(path.join(root, MANIFEST), JSON.stringify(buildManifest(root, scan.files), null, 2) + '\n');
}

function describe(result) {
  const lines = [];
  if (result.changed.length) lines.push(`Đã sửa (${result.changed.length}): ${result.changed.slice(0, 8).join(', ')}`);
  if (result.added.length) lines.push(`Mới thêm (${result.added.length}): ${result.added.slice(0, 8).join(', ')}`);
  if (result.missing.length) lines.push(`Đã xóa (${result.missing.length}): ${result.missing.slice(0, 8).join(', ')}`);
  return lines;
}

export function knowledgeCommand({ cwd, taskId, sync, page }) {
  if (taskId) {
    const validation = validateTaskId(taskId);
    if (!validation.ok) return { exitCode: 2, output: validation.reason };
  }

  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  // Not every project keeps derived docs, and a project without them has none
  // to go stale.
  if (!existsSync(path.join(root, KNOWLEDGE))) {
    // --page chỉ xem, không phán: không ghi bản ghi gate cho một lần mở trang.
    if (page) {
      return {
        exitCode: 0,
        output: [
          pass('knowledge', 'dự án chưa dùng .knowledge — không có gì để xem'),
          '',
          hint('Tạo .knowledge/ rồi chạy: compass knowledge --sync'),
        ].join('\n'),
      };
    }
    if (taskId) {
      const file = specPath(root, taskId);
      if (existsSync(file)) {
        writeGate(root, taskId, {
          gate: 'knowledge',
          exitCode: 0,
          checkedAt: new Date().toISOString(),
          specHash: hashFile(file),
          sourceHash: hashSource(root),
          scanned: 0,
          staleCount: 0,
        });
      }
    }
    return {
      exitCode: 0,
      output: [
        pass('knowledge', 'dự án chưa dùng .knowledge'),
        '',
        hint('Muốn có tài liệu máy sinh thì tạo .knowledge/ rồi chạy: compass knowledge --sync'),
      ].join('\n'),
    };
  }

  // Trang xem đọc từ đĩa, nên nó đứng trước lần quét: không có lý do gì bắt
  // người muốn mở trang phải đợi quét lại toàn bộ dự án.
  if (page) return pageMode(root);

  const scan = scanComponents(root);

  if (sync) {
    try {
      writeDerived(root, scan);
    } catch (err) {
      return { exitCode: 2, output: fail('knowledge', [`Không ghi được ${DERIVED}: ${err.message}`]) };
    }
    const count = Object.keys(scan.components).length;
    const unsure = Object.values(scan.components).filter((c) => !c.confident).length;
    const dead = Object.entries(scan.components).filter(([, c]) => c.usedIn === 0).map(([n]) => n);

    const lines = [pass('knowledge', `đã sinh lại: ${count} component từ ${scan.files.length} file`)];
    if (unsure) lines.push('', `${unsure} component có prop không đọc được — đánh dấu confident: false, đừng tin phần đó.`);
    if (dead.length) lines.push('', `Không ai dùng (${dead.length}): ${dead.slice(0, 10).join(', ')}`);
    return { exitCode: 0, output: lines.join('\n') };
  }

  const manifest = readManifest(root);
  let result = manifest?.broken
    ? { stale: true, reason: 'manifest hỏng — không đọc được', changed: [], missing: [], added: [] }
    : compareManifest(root, manifest, scan.files);

  // The manifest says the sources have not moved; it says nothing about the
  // document itself. Deleting or rewriting components.json left the gate green
  // over a file that no longer describes anything.
  if (!result.stale) {
    const expected = JSON.stringify(scan.components, null, 2) + '\n';
    let actual = null;
    try {
      actual = readFileSync(path.join(root, COMPONENTS), 'utf8');
    } catch { /* missing reads as mismatched */ }
    if (actual !== expected) {
      result = {
        stale: true,
        reason: actual === null
          ? `${COMPONENTS} không còn — tài liệu đã bị xóa`
          : `${COMPONENTS} không khớp với code — đã bị sửa tay hoặc sinh từ bản cũ`,
        changed: [], missing: [], added: [],
      };
    }
  }

  if (taskId) {
    const file = specPath(root, taskId);
    if (existsSync(file)) {
      writeGate(root, taskId, {
        gate: 'knowledge',
        exitCode: result.stale ? 1 : 0,
        checkedAt: new Date().toISOString(),
        specHash: hashFile(file),
        sourceHash: hashSource(root),
        scanned: scan.files.length,
        staleCount: result.changed.length + result.added.length + result.missing.length,
      });
    }
  }

  if (result.stale) {
    const detail = result.reason ? [result.reason] : describe(result);
    return {
      exitCode: 1,
      output: [
        fail('knowledge', ['Tài liệu máy sinh không còn khớp code:', ...detail]),
        '',
        hint('Chạy: compass knowledge --sync'),
      ].join('\n'),
    };
  }

  return {
    exitCode: 0,
    output: pass('knowledge', `${scan.files.length} file nguồn còn khớp tài liệu`),
  };
}
