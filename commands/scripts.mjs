import { existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { findRoot, compassDir } from '../lib/paths.mjs';
import { hint } from '../lib/report.mjs';

const SCRIPTS = 'scripts';

// Enough to reach a header comment without pulling a whole data file into
// memory: listing a library should not cost what reading it does.
const HEADER_BYTES = 2048;

function readHead(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buffer = Buffer.alloc(HEADER_BYTES);
    const bytes = readSync(fd, buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytes).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
  }
}

// A declaration names an export file; it is not a description of the script.
// Listing one as the purpose would replace the author's own sentence.
const OUT_MARKER = /^\s*(?:--|#|\/\/|\/\*+)\s*@out\s*:/i;

// A purpose line is whatever the author wrote first in a comment. Anything
// else and the entry says so rather than inventing a description.
function purposeOf(head) {
  // Tách theo MỌI dấu ngắt dòng, không chỉ LF và CRLF. `\r` trần, U+2028 và
  // U+2029 đều ngắt dòng thật, mà `.` trong regex không khớp chúng — nên một
  // file dùng chúng gộp thành một dòng duy nhất: mở `<!--`, có `-->`, bị tính
  // là khối đã đóng, rồi trả về cả dòng kèm thân file.
  const NGAT_DONG = new RegExp("\r\n|[\n\r\u2028\u2029]");
  const lines = head.split(NGAT_DONG);

  // Chỉ đọc trong khối `<!-- … -->` ĐÃ ĐÓNG. Theo dõi trạng thái từng dòng thì
  // một khối quên đóng làm mọi dòng còn lại trông như đang trong comment, và
  // dòng đầu tiên gặp được in ra như mô tả — `.compass/scripts/` có công cụ đọc
  // dữ liệu khách hàng, nên đó là rò rỉ chứ không phải mô tả sai.
  //
  // Quét trước để biết khối nào thật sự đóng, thay vì đoán từng dòng. Cùng bài
  // học với CP-34 và với `lib/pitfall-file.mjs`.
  const trongKhoi = new Set();
  let mo = -1;
  for (let i = 0; i < lines.length; i++) {
    if (mo === -1) {
      if (/^\s*<!--/.test(lines[i])) {
        // Mở và đóng trên cùng một dòng thì khối đã đóng ngay tại đó.
        if (/-->/.test(lines[i].slice(lines[i].indexOf('<!--') + 4))) { trongKhoi.add(i); continue; }
        mo = i;
      }
      continue;
    }
    if (/-->/.test(lines[i])) {
      for (let j = mo; j <= i; j++) trongKhoi.add(j);
      mo = -1;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (line.startsWith('#!')) continue;
    if (OUT_MARKER.test(line)) continue;

    if (trongKhoi.has(i)) {
      // Bỏ dấu mở, dấu đóng, rồi xem còn chữ nào không.
      const text = line.replace(/^<!--/, '').replace(/-->.*$/, '').trim();
      if (text === '') continue;
      // Dòng tiếp trong khối không có tiền tố comment nên OUT_MARKER không
      // khớp. Khai tên file export vẫn không phải mô tả.
      if (/^@out\s*:/i.test(text)) continue;
      return text;
    }

    // Dòng có `<!--` mà không nằm trong khối đã đóng: khối quên đóng. Không đọc
    // gì từ đó — thà báo "chưa có mô tả" hơn in một dòng thân file.
    //
    // Neo ở đầu dòng, giống chốt `-->` hai dòng dưới. Nhận `<!--` ở bất kỳ đâu
    // thì một comment `//` hay `--` chỉ NHẮC TỚI chuỗi đó cũng mất mô tả.
    //
    // Lớp thứ hai, cố ý: regex phía dưới không còn nhánh `<!--` nên nó cũng trả
    // null, và mutation riêng dòng này sống sót. Giữ vì nó phát biểu ý định ngay
    // tại chỗ — ai thêm lại `<!--` vào regex thì chốt này vẫn chặn.
    if (line.startsWith('<!--')) return null;

    // A bare block-comment opener carries no text; the description is on the
    // next line. Returning "*" here would look like a purpose nobody wrote.
    if (line === '/*' || line === '/**' || line === '*' || line === '*/') continue;
    // Dấu đóng ngoài mọi khối đã đóng: file có comment quên đóng, hoặc `-->`
    // đứng lạc. Khớp đúng chuỗi thôi thì `--> a@b.com,...` rơi xuống regex, và
    // nhánh `--` ở đó bắt phần còn lại — in ra dữ liệu khách hàng.
    if (line.startsWith('-->')) return null;
    // A doctype is markup, not a sentence the author wrote.
    if (/^<!doctype/i.test(line)) return null;

    const comment = line.match(/^(?:\/\/|#|--|\*|\/\*\*?)\s*(.+?)\s*(?:\*\/)?$/);
    if (comment && comment[1]) return comment[1];
    // First non-comment line means the file opened with code.
    return null;
  }
  return null;
}

function walk(root, current, out) {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else if (entry.isFile() && entry.name !== 'README.md') {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
}

export function scriptsCommand({ cwd }) {
  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const dir = path.join(compassDir(root), SCRIPTS);

  if (!existsSync(dir)) {
    return {
      exitCode: 0,
      output: [
        'Chưa có script nào trong .compass/scripts/',
        '',
        hint('Script viết trong lúc điều tra thì lưu vào đó, kèm một dòng comment nói nó làm gì.'),
        hint('Thư mục này git-tracked — lần sau tìm thấy mà dùng lại, khỏi viết mới.'),
      ].join('\n'),
    };
  }

  const files = [];
  walk(dir, dir, files);
  files.sort();

  if (files.length === 0) {
    return { exitCode: 0, output: 'Thư mục .compass/scripts/ đang trống.' };
  }

  // Listing describes; it never runs anything. A library of investigation
  // scripts is the last place to execute code as a side effect of looking.
  const lines = [`${files.length} script trong .compass/scripts/:`, ''];
  for (const relPath of files) {
    const purpose = purposeOf(readHead(path.join(dir, relPath)));
    lines.push(`  ${relPath}`);
    lines.push(`      ${purpose ?? '(chưa có dòng comment mô tả)'}`);
  }

  return { exitCode: 0, output: lines.join('\n') };
}
