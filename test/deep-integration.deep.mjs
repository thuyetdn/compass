// Runs the real CLI against examples/todo, all six gates, the way a person
// would. Everything here is slow and needs a browser, so it lives outside
// `npm test` — see `npm run test:deep`.
//
// This suite exists because of one bug: two browser gates in a row raced over
// the dev port, and 403 unit tests never saw it. Gates interacting is the part
// no isolated test covers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'cli.mjs');
const DEMO = path.join(HERE, '..', 'examples', 'todo');
const TASK = 'TD-001';

const CHECK_TIMEOUT_MS = 300_000;

function compass(args, { timeout = CHECK_TIMEOUT_MS } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: DEMO,
    encoding: 'utf8',
    timeout,
  });
}

// Files this suite edits on purpose, restored no matter how a test ends.
const TOUCHED = ['src/App.css', 'src/App.jsx', 'test/App.test.jsx'];
const originals = new Map();

function snapshot() {
  for (const rel of TOUCHED) {
    originals.set(rel, readFileSync(path.join(DEMO, rel), 'utf8'));
  }
}

function restore() {
  for (const [rel, content] of originals) {
    const full = path.join(DEMO, rel);
    if (readFileSync(full, 'utf8') !== content) writeFileSync(full, content);
  }
}

function edit(rel, transform) {
  const full = path.join(DEMO, rel);
  writeFileSync(full, transform(readFileSync(full, 'utf8')));
}

// A leftover dev server holds the port and the next run measures the previous
// run's page — the failure this suite was written for.
function devPortHolders(port = 5173) {
  if (process.platform !== 'win32') {
    try {
      return execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
        .split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
  try {
    return execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.includes(`:${port}`) && line.includes('LISTENING'))
      .map((line) => line.trim().split(/\s+/).pop());
  } catch {
    return [];
  }
}

// Missing prerequisites must skip loudly. A silent pass would report coverage
// this suite is not providing.
const missing = [];
if (!existsSync(path.join(DEMO, 'node_modules'))) {
  missing.push('examples/todo chưa cài dependency — chạy: cd examples/todo && npm install');
}
if (!existsSync(path.join(DEMO, 'node_modules', 'playwright'))) {
  missing.push('thiếu Playwright — chạy: cd examples/todo && npm i -D playwright && npx playwright install chromium');
}
const skip = missing.length ? missing.join(' · ') : false;

before(() => { if (!skip) snapshot(); });
after(() => { if (!skip) restore(); });

test('H1 check runs all six gates and passes', { skip }, () => {
  const result = compass(['check', TASK]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const gate of ['spec', 'convention', 'test', 'ui', 'visual']) {
    assert.match(result.stdout, new RegExp(`Gate ${gate} PASSED`), `gate ${gate} phải xanh`);
  }
});

test('H2 done closes the task after a clean check', { skip }, () => {
  compass(['check', TASK]);
  const result = compass(['done', TASK]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /done PASSED/);
});

test('H3 two checks back to back both pass', { skip }, () => {
  // The shape that broke: the second run started a dev server while the first
  // still held the port.
  const first = compass(['check', TASK]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const second = compass(['check', TASK]);
  assert.equal(second.status, 0, second.stdout + second.stderr);
});

test('EC1 no dev server survives a check', { skip }, () => {
  // Honest limits: reverting the CP-8 fix does NOT make this fail, measured
  // over four rounds. The leak it was written for is rarer than that, or turns
  // on something not yet understood, so treat this as a tripwire for an
  // obvious leak rather than proof the old bug cannot return.
  const baseline = devPortHolders();
  for (let round = 1; round <= 4; round++) {
    compass(['check', TASK]);
    const holders = devPortHolders();
    assert.deepEqual(holders, baseline,
      `vòng ${round}: tiến trình còn giữ cổng 5173: ${holders.join(', ')}`);
  }
});

test('H4 status lists every gate that ran', { skip }, () => {
  compass(['check', TASK]);
  const result = compass(['status', TASK]);
  assert.equal(result.status, 0, result.stdout);
  for (const gate of ['spec', 'convention', 'test', 'ui', 'visual']) {
    assert.match(result.stdout, new RegExp(gate));
  }
});

test('E1 CSS drifting past tolerance fails the ui gate by property', { skip }, () => {
  try {
    // 20px in the contract, 17px here: 3px, past the 2px budget.
    edit('src/App.css', (css) => css.replace('padding: 12px 20px;', 'padding: 12px 17px;'));
    const result = compass(['check', TASK]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /Gate ui FAILED/);
    assert.match(result.stdout, /padding-left|padding-right/);
  } finally {
    restore();
  }
});

test('E2 removing a test fails the test gate by spec ID', { skip }, () => {
  try {
    edit('test/App.test.jsx', (src) => {
      // Cut from the test's opening line to its closing `});` at column zero.
      const start = src.indexOf("test('S1 ");
      assert.notEqual(start, -1, 'không tìm thấy test S1 trong demo');
      const end = src.indexOf('\n});', start);
      assert.notEqual(end, -1, 'không tìm thấy chỗ đóng của test S1');
      return src.slice(0, start) + src.slice(end + 4);
    });
    const result = compass(['check', TASK]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /Gate test FAILED/);
    assert.match(result.stdout, /S1/);
  } finally {
    restore();
  }
});

test('EC2 editing code after a green check blocks done', { skip }, () => {
  try {
    assert.equal(compass(['check', TASK]).status, 0);
    edit('src/App.jsx', (src) => `${src}\n// thêm sau khi gate xanh\n`);

    const result = compass(['done', TASK]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /Code đã thay đổi/);
  } finally {
    restore();
  }
});

test('S1 the demo is left exactly as it was found', { skip }, () => {
  for (const [rel, content] of originals) {
    assert.equal(readFileSync(path.join(DEMO, rel), 'utf8'), content, `${rel} chưa được khôi phục`);
  }
});

test('EC3 a port held by something else fails instead of measuring the wrong page', { skip }, async () => {
  const { spawn } = await import('node:child_process');

  // The squatter has to be its own process. Running it in this one would put it
  // behind the event loop that spawnSync blocks — it would stop answering, vite
  // would take the port, and the test would prove nothing.
  const squatter = spawn(process.execPath, ['-e', `
    require('node:http')
      .createServer((req, res) => { res.writeHead(200); res.end('không phải app'); })
      .listen(5173, () => console.log('READY'));
  `], { stdio: ['ignore', 'pipe', 'ignore'] });

  const ready = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 10_000);
    squatter.stdout.on('data', (chunk) => {
      if (String(chunk).includes('READY')) { clearTimeout(timer); resolve(true); }
    });
  });
  assert.ok(ready, 'không dựng được tiến trình chiếm cổng');

  try {
    const started = Date.now();
    const result = compass(['check', TASK]);
    assert.ok(Date.now() - started < 200_000, 'phải kết thúc, không treo');
    // Vite moves to a free port while the gate keeps looking at devUrl, so it
    // is measuring someone else's page. Reporting that is right; passing is not.
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /không tìm thấy selector/);
  } finally {
    squatter.kill('SIGKILL');
    await new Promise((resolve) => squatter.once('exit', resolve));
  }
});
