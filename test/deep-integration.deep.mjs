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

// Mốc thời gian để CP-9-P1 đo cả suite.
const BAT_DAU = Date.now();

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
// Tách thành hàm để test gọi lại được với thư mục giả. Để nguyên dạng mã
// chạy một lần lúc nạp module thì không ca nào kiểm được nó, và một suite
// âm thầm bỏ qua mọi test trông y hệt một suite xanh.
export function thieuGiDe(demo) {
  const thieu = [];
  if (!existsSync(path.join(demo, 'node_modules'))) {
    thieu.push('examples/todo chưa cài dependency — chạy: cd examples/todo && npm install');
  }
  if (!existsSync(path.join(demo, 'node_modules', 'playwright'))) {
    thieu.push('thiếu Playwright — chạy: cd examples/todo && npm i -D playwright && npx playwright install chromium');
  }
  return thieu;
}

const missing = thieuGiDe(DEMO);
const skip = missing.length ? missing.join(' · ') : false;

before(() => { if (!skip) snapshot(); });
after(() => { if (!skip) restore(); });

test('CP-9-H1 check runs all six gates and passes', { skip }, () => {
  const result = compass(['check', TASK]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const gate of ['spec', 'convention', 'test', 'ui', 'visual']) {
    assert.match(result.stdout, new RegExp(`Gate ${gate} PASSED`), `gate ${gate} phải xanh`);
  }
});

test('CP-9-H2 done closes the task after a clean check', { skip }, () => {
  compass(['check', TASK]);
  const result = compass(['done', TASK]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /done PASSED/);
});

test('CP-9-H3 two checks back to back both pass', { skip }, () => {
  // The shape that broke: the second run started a dev server while the first
  // still held the port.
  const first = compass(['check', TASK]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const second = compass(['check', TASK]);
  assert.equal(second.status, 0, second.stdout + second.stderr);
});

test('CP-9-EC1 no dev server survives a check', { skip }, () => {
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

test('CP-9-H4 status lists every gate that ran', { skip }, () => {
  compass(['check', TASK]);
  const result = compass(['status', TASK]);
  assert.equal(result.status, 0, result.stdout);
  for (const gate of ['spec', 'convention', 'test', 'ui', 'visual']) {
    assert.match(result.stdout, new RegExp(gate));
  }
});

test('CP-9-E1 CSS drifting past tolerance fails the ui gate by property', { skip }, () => {
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

test('CP-9-E2 removing a test fails the test gate by spec ID', { skip }, () => {
  try {
    edit('test/App.test.jsx', (src) => {
      // Cut from the test's opening line to its closing `});` at column zero.
      const start = src.indexOf("test('S1 ");
      assert.notEqual(start, -1, 'không tìm thấy test S1 trong demo');
      const end = src.indexOf('\n});', start);
      assert.notEqual(end, -1, 'không tìm thấy chỗ đóng của test S1');
      return src.slice(0, start) + src.slice(end + 4);
    });
    // knowledge runs before test and notices the edited file first, so resync
    // to get past it — the point here is what the test gate says about S1.
    compass(['knowledge', '--sync']);

    const result = compass(['check', TASK]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /Gate test FAILED/);
    assert.match(result.stdout, /S1/);
  } finally {
    restore();
    compass(['knowledge', '--sync']);
  }
});

test('CP-9-EC2 editing code after a green check blocks done', { skip }, () => {
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

test('CP-9-S1 the demo is left exactly as it was found', { skip }, () => {
  for (const [rel, content] of originals) {
    assert.equal(readFileSync(path.join(DEMO, rel), 'utf8'), content, `${rel} chưa được khôi phục`);
  }
});

test('CP-9-EC3 a port held by something else fails instead of measuring the wrong page', { skip }, async () => {
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

test('CP-9-V1 a demo without Playwright skips loudly instead of passing', () => {
  // Thiếu điều kiện thì suite phải nói ra. Im lặng bỏ qua trông y hệt xanh, và
  // báo cáo sẽ khai một mức phủ mà suite không hề cung cấp.
  const gia = path.join(HERE, '..', 'examples', 'khong-he-ton-tai-playwright');
  const thieu = thieuGiDe(gia);
  assert.ok(thieu.length > 0, 'phải nêu thiếu gì');
  assert.ok(thieu.some((m) => /playwright/i.test(m)), 'phải nhắc Playwright');
  assert.ok(thieu.some((m) => /npm i|npm install/.test(m)), 'phải nói cách cài');
});

test('CP-9-V2 a demo without node_modules skips loudly too', () => {
  const gia = path.join(HERE, '..', 'examples', 'khong-he-ton-tai');
  const thieu = thieuGiDe(gia);
  assert.ok(thieu.some((m) => /node_modules|cài dependency/.test(m)));
});

test('CP-9-P1 the whole deep suite finishes inside ten minutes', { skip }, () => {
  // Suite sâu chạy tay, không chạy mỗi lần check. Nhưng quá mười phút thì không
  // ai chạy nữa, và nó thành tài sản chết.
  const bay = 10 * 60 * 1000;
  const daChay = Date.now() - BAT_DAU;
  assert.ok(daChay < bay, `suite đã chạy ${Math.round(daChay / 1000)}s, quá 10 phút`);
});

test('CP-8-H3 the ui gate and the visual gate run back to back without racing', { skip }, () => {
  // Đúng con bug INV-1: hai gate browser liên tiếp tranh cổng dev, và 403 unit
  // test không thấy gì. Chạy riêng từng gate theo đúng thứ tự `check` chạy.
  const ui = compass(['ui', TASK]);
  assert.equal(ui.status, 0, ui.stdout + ui.stderr);
  const visual = compass(['visual', TASK]);
  assert.equal(visual.status, 0, visual.stdout + visual.stderr);
});

test('CP-8-EC2 running the same browser gate twice in a row still passes', { skip }, () => {
  // Lần hai bắt đầu khi lần một vừa nhả cổng — chỗ hẹp nhất.
  const lan1 = compass(['ui', TASK]);
  assert.equal(lan1.status, 0, lan1.stdout + lan1.stderr);
  const lan2 = compass(['ui', TASK]);
  assert.equal(lan2.status, 0, lan2.stdout + lan2.stderr);
});

test('CP-5-H5 a first visual run creates the baseline and says so', { skip }, () => {
  // Chưa có baseline thì không có gì để so. Gate phải tạo và nói rõ, không được
  // báo xanh như thể đã đối chiếu.
  const baseline = path.join(DEMO, '.compass', TASK, 'baseline');
  const co = existsSync(baseline);
  const r = compass(['visual', TASK]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(baseline), 'baseline phải tồn tại sau lần chạy đầu');
  if (!co) assert.match(r.stdout, /baseline/i, 'lần đầu phải nói rõ là đang tạo baseline');
});

test('CP-4-E2 a dev server that never comes up is reported with how long it waited', { skip }, () => {
  // Cổng trỏ đi chỗ khác. Gate phải bỏ cuộc và nói đã đợi bao lâu — treo im
  // lặng rồi báo lỗi chung chung thì người ta không biết sửa gì.
  const cfgPath = path.join(DEMO, '.compass', 'config.json');
  const goc = readFileSync(cfgPath, 'utf8');
  const cfg = JSON.parse(goc);
  try {
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, devUrl: 'http://127.0.0.1:59997/', devTimeoutMs: 800 }, null, 2));
    const r = compass(['ui', TASK]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /800ms|không phản hồi/, 'phải nêu đã đợi bao lâu');
  } finally {
    writeFileSync(cfgPath, goc);
  }
});
