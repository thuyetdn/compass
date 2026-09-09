import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dataCommand } from '../commands/data.mjs';

function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-data-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'true' }));
  return root;
}

function writeSql(root, name, body) {
  const dir = path.join(root, '.compass', 'scripts');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return file;
}

function dataDir(root, taskId) {
  const dir = path.join(root, '.compass', taskId, 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const TWO_QUERIES = [
  '-- @out: INV-4-status-gap-0908.csv',
  'select 1;',
  '',
  '-- @out: INV-4-bounce-list-0908.csv',
  'select 2;',
].join('\n');

test('CP-32-H4 lists each declared file with its present or missing state', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(root, 'q.sql', TWO_QUERIES);
    const dir = dataDir(root, 'INV-4');
    writeFileSync(path.join(dir, 'INV-4-status-gap-0908.csv'), 'a,b\n1,2\n');
    writeFileSync(path.join(dir, 'INV-4-bounce-list-0908.csv'), 'a,b\n3,4\n');

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 0);
    assert.match(output, /INV-4-status-gap-0908\.csv/);
    assert.match(output, /INV-4-bounce-list-0908\.csv/);
    assert.match(output, /2\/2 file có trong data\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-H5 matches a file whose date differs and says so', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(root, 'q.sql', ['-- @out: INV-4-status-gap-0908.csv', 'select 1;'].join('\n'));
    const dir = dataDir(root, 'INV-4');
    writeFileSync(path.join(dir, 'INV-4-status-gap-0915.csv'), 'a\n1\n');

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 0);
    assert.match(output, /INV-4-status-gap-0915\.csv/);
    assert.match(output, /khai 0908, thấy 0915/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-E1 exits 2 when the sql file does not exist', () => {
  const root = makeRepo();
  try {
    const missing = path.join(root, '.compass', 'scripts', 'nope.sql');

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: missing });

    assert.equal(exitCode, 2);
    assert.match(output, /nope\.sql/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-E2 reports every declared file missing when data/ is absent', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(root, 'q.sql', TWO_QUERIES);

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 1);
    assert.match(output, /chưa có trong data\//);
    assert.match(output, /Chưa có thư mục/);
    // Both names must appear: a partial report would hide work still to do.
    assert.match(output, /INV-4-status-gap-0908\.csv/);
    assert.match(output, /INV-4-bounce-list-0908\.csv/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-E3 exits 2 when the sql file cannot be read', () => {
  const root = makeRepo();
  try {
    // A directory at the file's path is unreadable as a file on every platform,
    // where chmod is a no-op on Windows.
    const dir = path.join(root, '.compass', 'scripts');
    mkdirSync(path.join(dir, 'blocked.sql'), { recursive: true });

    const { exitCode, output } = dataCommand({
      cwd: root,
      taskId: 'INV-4',
      sqlPath: path.join(dir, 'blocked.sql'),
    });

    assert.equal(exitCode, 2);
    assert.match(output, /blocked\.sql/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-E4 exits 2 outside a Compass root', () => {
  const bare = mkdtempSync(path.join(tmpdir(), 'compass-none-'));
  try {
    const { exitCode, output } = dataCommand({ cwd: bare, taskId: 'INV-4', sqlPath: 'q.sql' });

    assert.equal(exitCode, 2);
    assert.match(output, /config\.json/);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test('CP-32-S3 prints filenames only, never file contents', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(root, 'q.sql', ['-- @out: INV-4-status-gap-0908.csv', 'select 1;'].join('\n'));
    const dir = dataDir(root, 'INV-4');
    const secret = 'heikki.rotko@example.com';
    writeFileSync(path.join(dir, 'INV-4-status-gap-0908.csv'), `Email\n${secret}\n`);

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 0);
    assert.ok(!output.includes(secret), 'output must not carry any byte from inside data/');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-V7 gate exits 1 and names the duplicate', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(
      root,
      'q.sql',
      [
        '-- @out: INV-4-same-0908.csv',
        'select 1;',
        '-- @out: INV-4-same-0908.csv',
        'select 2;',
      ].join('\n'),
    );

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 1);
    assert.match(output, /khai hai lần/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-EC13 compass scripts prints the description, not the @out line', async () => {
  const { scriptsCommand } = await import('../commands/scripts.mjs');
  const root = makeRepo();
  try {
    writeSql(
      root,
      'inv4-prod-queries.sql',
      [
        '-- @out: INV-4-status-gap-0908.csv',
        '-- Compare the n8n contact set against what Skynet shows',
        'select 1;',
      ].join('\n'),
    );

    const { exitCode, output } = scriptsCommand({ cwd: root });

    assert.equal(exitCode, 0);
    assert.match(output, /Compare the n8n contact set/);
    assert.ok(!output.includes('@out'), 'a declaration is not a description');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-EC14 gate does not let one file satisfy two declarations', () => {
  const root = makeRepo();
  try {
    // Same work stem, different declared dates. With only one file present the
    // gate must satisfy exactly one of them — counting it twice would report
    // evidence that does not exist.
    const sql = writeSql(
      root,
      'q.sql',
      [
        '-- @out: INV-4-status-gap-0908.csv',
        'select 1;',
        '-- @out: INV-4-status-gap-0909.csv',
        'select 2;',
      ].join('\n'),
    );
    const dir = dataDir(root, 'INV-4');
    writeFileSync(path.join(dir, 'INV-4-status-gap-0915.csv'), 'a\n1\n');

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 1, 'the second declaration has no file, so the gate must fail');
    assert.match(output, /1\/2 file có trong data\//);
    assert.match(output, /chưa có trong data\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-EC15 gives a file to the declaration naming it exactly', () => {
  const root = makeRepo();
  try {
    // Matching in file order would let the 0908 declaration take the 0915 file
    // as a date-drift match, then report that same filename missing for 0915.
    const sql = writeSql(
      root,
      'q.sql',
      [
        '-- @out: INV-4-status-gap-0908.csv',
        'select 1;',
        '-- @out: INV-4-status-gap-0915.csv',
        'select 2;',
      ].join('\n'),
    );
    const dir = dataDir(root, 'INV-4');
    writeFileSync(path.join(dir, 'INV-4-status-gap-0915.csv'), 'a\n1\n');

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 1, 'the 0908 declaration has no file of its own');
    assert.match(output, /✓ INV-4-status-gap-0915\.csv/);
    assert.match(output, /✗ INV-4-status-gap-0908\.csv/);
    assert.ok(
      !/✓ INV-4-status-gap-0915\.csv \(khai/.test(output),
      'the exact declaration must claim it, not the drifting one',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-EC16 does not count an orphan declaration as a query', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(
      root,
      'q.sql',
      ['-- @out: INV-4-first-work-0908.csv', 'select 1;', '', '-- @out: INV-4-orphan-work-0908.csv'].join('\n'),
    );

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 1);
    assert.match(output, /1 query trong file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-EC23 prints a detached warning without failing the gate', () => {
  const root = makeRepo();
  try {
    // A declaration left above a disabled query, with no second declaration to
    // make it ambiguous. The gate cannot adjudicate this, so it says so.
    const sql = writeSql(
      root,
      'q.sql',
      ['-- @out: -', '-- select * from mastercontact;', '', 'select Email from mastercontact;'].join('\n'),
    );

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 0, 'a warning must not change the verdict');
    assert.match(output, /Gate data PASSED/);
    assert.match(output, /⚠/);
    assert.match(output, /Dòng 1/);
    assert.match(output, /dòng 4/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-EC24 keeps the detached warning visible when the file also has an error', () => {
  const root = makeRepo();
  try {
    // A detached declaration AND an undeclared query. Fixing the error is the
    // moment the author may unknowingly settle the ambiguity, so withholding
    // the warning until the error clears is withholding it until too late.
    const sql = writeSql(
      root,
      'q.sql',
      [
        '-- @out: INV-4-q3-work-0908.csv',
        '-- select 3 from mastercontact;',
        '',
        'select Email from mastercontact;',
        '',
        'select 9;',
      ].join('\n'),
    );

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 1, 'the error still decides the verdict');
    assert.match(output, /dòng 6/, 'the undeclared query is still reported');
    assert.match(output, /⚠/, 'the warning must survive the error path');
    assert.match(output, /Dòng 1/);
    assert.match(output, /dòng 4/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-H7 excludes manual queries from the expected file count', () => {
  const root = makeRepo();
  try {
    // One manual, one present, one missing. `expected` must count only the two
    // that actually owe a file.
    const sql = writeSql(
      root,
      'q.sql',
      [
        '-- @out: -',
        "select 1 where email = '<EMAIL>';",
        '-- @out: INV-4-present-work-0908.csv',
        'select 2;',
        '-- @out: INV-4-missing-work-0908.csv',
        'select 3;',
      ].join('\n'),
    );
    const dir = dataDir(root, 'INV-4');
    writeFileSync(path.join(dir, 'INV-4-present-work-0908.csv'), 'a\n1\n');

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 1);
    assert.match(output, /1\/2 file có trong data\//, 'manual query must not inflate the denominator');
    assert.match(output, /1 chạy tay/);
    assert.match(output, /3 query đã khai/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-S8 does not count a directory as a produced file', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(root, 'q.sql', ['-- @out: INV-4-status-gap-0908.csv', 'select 1;'].join('\n'));
    const dir = dataDir(root, 'INV-4');
    // A directory carrying the declared name is not evidence of a query result.
    mkdirSync(path.join(dir, 'INV-4-status-gap-0908.csv'), { recursive: true });

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 1);
    assert.match(output, /chưa có trong data\//);
    assert.match(output, /0\/1 file có trong data\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-E5 exits 2 when data/ exists but cannot be listed', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(root, 'q.sql', ['-- @out: INV-4-status-gap-0908.csv', 'select 1;'].join('\n'));
    // A regular file where data/ should be: readdir fails with ENOTDIR, which is
    // "cannot be read" rather than "not created yet".
    const taskPath = path.join(root, '.compass', 'INV-4');
    mkdirSync(taskPath, { recursive: true });
    writeFileSync(path.join(taskPath, 'data'), 'not a directory');

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 2);
    assert.match(output, /Không đọc được/);
    assert.ok(!output.includes('Chạy những query còn thiếu'), 'must not advise re-running queries');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-E6 names what to close and prints no query count', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(
      root,
      'q.sql',
      ['-- @out: INV-4-q1-work-0908.csv', 'select 1;', '/* left open', '-- @out: INV-4-q2-work-0908.csv', 'select 2;'].join('\n'),
    );

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    assert.equal(exitCode, 1);
    assert.match(output, /chưa đóng/);
    assert.ok(!/query trong file/.test(output), 'no count the scan never established');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CP-32-EC22 catches the dangerous case as ambiguous, not by guessing', () => {
  const root = makeRepo();
  try {
    const sql = writeSql(
      root,
      'q.sql',
      [
        '-- @out: -',
        '-- (select * from mastercontact)',
        '',
        '-- @out: INV-4-real-work-0908.csv',
        'select 1;',
      ].join('\n'),
    );

    const { exitCode, output } = dataCommand({ cwd: root, taskId: 'INV-4', sqlPath: sql });

    // Both declarations now belong to the same query, so the measurable
    // ambiguity rule blocks it — no inference about comment wording needed.
    assert.equal(exitCode, 1);
    assert.match(output, /2 dòng @out:/);
    assert.match(output, /dòng 1, 4/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
