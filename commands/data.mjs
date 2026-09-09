import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { findRoot, taskDir, validateTaskId } from '../lib/paths.mjs';
import { parseQueryOutputs, matchDeclaredFile } from '../lib/query-outputs.mjs';
import { pass, fail, hint } from '../lib/report.mjs';

const DATA = 'data';

// Filenames only, never contents: data/ holds production query results with
// customer emails in them, and this command exists to be run and pasted.
// A directory named like a declared file is not evidence, hence isFile().
function listDataFiles(dir) {
  try {
    return {
      names: readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name),
    };
  } catch (err) {
    // "Not created yet" and "cannot be read" call for opposite advice: re-run
    // the queries, versus fix the permissions before trusting any verdict.
    if (err.code === 'ENOENT') return { names: [], absent: true };
    return { names: [], error: err.code ?? err.message };
  }
}

export function dataCommand({ cwd, taskId, sqlPath }) {
  const root = findRoot(cwd);
  if (!root) return { exitCode: 2, output: 'Không tìm thấy .compass/config.json.' };

  const idCheck = validateTaskId(taskId);
  if (!idCheck.ok) return { exitCode: 2, output: idCheck.reason };

  if (!sqlPath) {
    return {
      exitCode: 2,
      output: ['Thiếu đường dẫn file .sql.', '', hint('Dùng: compass data <id> <file.sql>')].join('\n'),
    };
  }

  const file = path.isAbsolute(sqlPath) ? sqlPath : path.join(cwd, sqlPath);
  if (!existsSync(file)) return { exitCode: 2, output: `Không thấy file: ${file}` };

  let sql;
  try {
    sql = readFileSync(file, 'utf8');
  } catch (err) {
    return { exitCode: 2, output: `Không đọc được ${file}: ${err.code ?? err.message}` };
  }

  const { queries, errors, warnings = [] } = parseQueryOutputs(sql, taskId);

  if (queries.length === 0 && errors.length === 0) {
    return {
      exitCode: 0,
      output: [
        pass('data', 'file không có query nào'),
        '',
        hint('Khai tên file kết quả bằng một dòng `-- @out: <tên>` ngay trên mỗi query.'),
      ].join('\n'),
    };
  }

  // Built before the error path returns, not after it. A warning the gate cannot
  // adjudicate is never part of the verdict, but fixing an error is the very moment
  // the author may settle the ambiguity by accident — so it has to be readable now.
  const warnLines = warnings.map((w) => `  ⚠ ${w.message}`);
  const warnBlock = warnLines.length ? [...warnLines, ''] : [];

  if (errors.length > 0) {
    const lines = errors.map((e) => e.message);
    const body = [fail('data', lines), '', ...warnBlock];

    // An unterminated construct means the scan never got past it, so no count
    // of "queries in the file" would be honest — say what to fix instead.
    if (errors.some((e) => e.kind === 'unterminated')) {
      body.push(hint('Đóng cấu trúc đó rồi chạy lại — chưa đóng thì không đọc được query nào.'));
    } else {
      // An orphan is a declaration, not a query, so counting every error as one
      // would overstate what the file contains.
      const NOT_A_QUERY = new Set(['orphan']);
      const fromQueries = errors.filter((e) => !NOT_A_QUERY.has(e.kind)).length;
      const total = queries.length + fromQueries;
      body.push(`  ${total} query trong file, ${errors.length} chỗ phải sửa.`, '');
      body.push(hint(`Khuôn tên: ${taskId}-<viec>-<ngay>.csv · dùng \`-- @out: -\` cho query chạy tay.`));
    }

    return { exitCode: 1, output: body.join('\n') };
  }

  const dir = path.join(taskDir(root, taskId), DATA);
  const listed = listDataFiles(dir);
  const rel = path.relative(root, dir);

  // An unreadable directory yields no verdict at all. Reporting every file as
  // missing would tell the author to re-run queries whose results may already
  // be on disk — the .sql read path at line 39 draws the same distinction.
  if (listed.error !== undefined) {
    return { exitCode: 2, output: `Không đọc được ${rel}: ${listed.error}` };
  }

  const actual = listed.names;
  const dirExists = listed.absent !== true;


  const rows = [];
  const missing = [];
  let manual = 0;
  let present = 0;

  // One file satisfies one declaration. Without this, two declarations sharing a
  // work stem both match the same file and the summary claims evidence twice.
  const taken = new Set();
  const matches = new Map();

  // Exact names are claimed first. Matching in file order would let an earlier
  // declaration's date-drift match steal the very file a later declaration names
  // exactly, reporting one filename as both present and absent.
  const wanted = queries.filter((q) => !q.manual);
  // Named `phase`, not `pass`: `pass` is the report helper imported above, and
  // shadowing it here would turn a later `pass(...)` call into a runtime error.
  for (const phase of ['exact', 'drift']) {
    for (const q of wanted) {
      if (matches.has(q)) continue;
      const match = matchDeclaredFile(q, actual, taken);
      if (match.found === null) continue;
      if (phase === 'exact' && match.dateDiffers) continue;
      taken.add(match.found.toLowerCase());
      matches.set(q, match);
    }
  }

  for (const q of queries) {
    if (q.manual) {
      manual++;
      rows.push(`  dòng ${q.line}: (chạy tay, không đợi file)`);
      continue;
    }

    const match = matches.get(q);
    if (match === undefined) {
      missing.push(q.out);
      rows.push(`  dòng ${q.line}: ✗ ${q.out} — chưa có trong data/`);
      continue;
    }

    present++;
    if (match.dateDiffers) {
      rows.push(`  dòng ${q.line}: ✓ ${match.found} (khai ${q.date}, thấy ${match.actualDate})`);
    } else {
      rows.push(`  dòng ${q.line}: ✓ ${match.found}`);
    }
  }

  const expected = queries.length - manual;
  // A ratio here would always read N/N: an undeclared query is an error and the
  // command has already returned. A plain count says the same thing honestly.
  const summary = `${queries.length} query đã khai · ${present}/${expected} file có trong data/ · ${manual} chạy tay`;

  if (missing.length > 0) {
    const tail = [`  ${summary}`, ''];
    if (!dirExists) tail.push(hint(`Chưa có thư mục ${path.relative(root, dir)} — chạy query rồi lưu kết quả vào đó.`));
    else tail.push(hint('Chạy những query còn thiếu, lưu kết quả đúng tên đã khai.'));
    return { exitCode: 1, output: [fail('data', rows), '', ...warnBlock, ...tail].join('\n') };
  }

  const warnTail = warnLines.length ? ['', ...warnLines] : [];
  return { exitCode: 0, output: [pass('data', summary), '', ...rows, ...warnTail].join('\n') };
}
