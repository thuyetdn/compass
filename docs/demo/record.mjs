// Records docs/demo/compass-demo.webm by running the real compass CLI on a temp copy of examples/todo and replaying the captured output in a terminal page under Playwright.
//
//   node docs/demo/record.mjs [--scenario <dir>] [--out <dir>] [--no-video] [--keep]
//
// Env fallbacks: COMPASS_DEMO_SCENARIO, COMPASS_DEMO_OUT.
//
// Exit codes: 0 recorded · 1 a step returned a different exit code than the
// scenario expects, setup failed, or the transcript would leak a local path ·
// 2 usage error or Playwright missing.
//
// What the video shows is what the commands returned. Two things on screen are
// not command output, and both are marked as such: caption cards (work an AI
// does inside Claude Code, done here by copying prepared files from the
// scenario folder) and the temp-folder path, which is replaced by a visible
// placeholder because `compass init` prints it absolute.
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CLI = path.join(REPO, 'cli.mjs');

const VIDEO_NAME = 'compass-demo.webm';
const TRANSCRIPT_NAME = 'transcript.json';
const TMP_MARK = '‹thư-mục-tạm›';
const STEP_TIMEOUT_MS = 600_000;

// Paths and identities that must never reach a shipped transcript (CP-58-S1).
export const LEAK_PATTERNS = [
  { name: 'ổ đĩa Windows', re: /\b[A-Z]:[\\/]/ },
  { name: 'C:\\Users', re: /C:\\Users/i },
  { name: '/Users/', re: /\/Users\// },
  { name: '/home/', re: /\/home\/[A-Za-z]/ },
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
];

// Files a run creates that are never part of the fixture, whatever it is.
const SKIP_DIRS = new Set(['node_modules', 'evidence', 'derived', 'dist', '.git']);
const SKIP_FILES = new Set(['.salt']);

class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv) {
  const opts = {
    scenario: process.env.COMPASS_DEMO_SCENARIO || path.join(HERE, 'scenario'),
    out: process.env.COMPASS_DEMO_OUT || HERE,
    video: true,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') opts.scenario = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--no-video') opts.video = false;
    else if (a === '--keep') opts.keep = true;
    else throw new Stop(2, `Tham số lạ: ${a}\nDùng: node docs/demo/record.mjs [--scenario <dir>] [--out <dir>] [--no-video] [--keep]`);
  }
  if (!opts.scenario || !opts.out) throw new Stop(2, '--scenario và --out cần một đường dẫn.');
  opts.scenario = path.resolve(opts.scenario);
  opts.out = path.resolve(opts.out);
  return opts;
}

function loadScenario(dir) {
  const file = path.join(dir, 'scenario.json');
  if (!existsSync(file)) throw new Stop(2, `Không thấy scenario.json trong thư mục scenario đã chọn.`);
  const sc = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(sc.steps) || sc.steps.length === 0) throw new Stop(2, 'scenario.json không có bước nào.');
  for (const [i, s] of sc.steps.entries()) {
    if (s.run && !Number.isInteger(s.expect)) throw new Stop(2, `Bước ${i + 1} chạy lệnh mà không khai "expect" (exit code mong đợi).`);
    if (!s.run && !s.caption) throw new Stop(2, `Bước ${i + 1} không có "run" cũng không có "caption".`);
  }
  return sc;
}

// The fixture is copied from what git tracks, so a local node_modules, evidence
// folder or .salt in the repo copy never travels into the recording.
function copyFixture(src, dest) {
  const rel = path.relative(REPO, src);
  const insideRepo = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (insideRepo) {
    const r = spawnSync('git', ['ls-files', '-z', '--', rel.split(path.sep).join('/')], { cwd: REPO, encoding: 'utf8' });
    const files = r.status === 0 ? r.stdout.split('\0').filter(Boolean) : [];
    if (files.length > 0) {
      const prefix = rel.split(path.sep).join('/') + '/';
      for (const f of files) {
        const inner = f.slice(prefix.length);
        const to = path.join(dest, inner);
        mkdirSync(path.dirname(to), { recursive: true });
        cpSync(path.join(REPO, f), to);
      }
      return files.length;
    }
  }
  let count = 0;
  const walk = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(from, entry.name), path.join(to, entry.name));
      } else if (!SKIP_FILES.has(entry.name)) {
        cpSync(path.join(from, entry.name), path.join(to, entry.name));
        count++;
      }
    }
  };
  walk(src, dest);
  return count;
}

function sh(cmd, args, cwd, { shell = false } = {}) {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell, timeout: STEP_TIMEOUT_MS, maxBuffer: 64_000_000 });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`, ms: performance.now() - t0 };
}

function setup(sc, workdir, scenarioDir) {
  const log = [];
  const fixture = path.resolve(scenarioDir, sc.fixture ?? '.');
  if (!existsSync(fixture)) throw new Stop(2, `Không thấy fixture "${sc.fixture}" của scenario.`);
  const n = copyFixture(fixture, workdir);
  log.push({ what: `chép ${sc.fixture?.endsWith('examples/todo') ? 'examples/todo' : 'fixture'} sang thư mục tạm (${n} file git theo dõi)`, ms: 0 });

  if (sc.setup?.npmInstall) {
    const r = sh('npm ci --no-audit --no-fund', [], workdir, { shell: true });
    if (r.status !== 0) throw new Stop(1, `Chuẩn bị thất bại: npm ci trả exit ${r.status}.\n${r.out.split('\n').slice(-10).join('\n')}`);
    log.push({ what: 'npm ci', ms: Math.round(r.ms) });
  }
  if (sc.setup?.git) {
    const g = ['-c', 'user.name=compass-demo', '-c', 'user.email=demo@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath='];
    for (const args of [['init', '-q', '-b', 'main'], [...g, 'add', '-A'], [...g, 'commit', '-q', '-m', 'base']]) {
      const r = sh('git', args, workdir);
      if (r.status !== 0) throw new Stop(1, `Chuẩn bị thất bại: git ${args.filter((a) => !a.includes('=')).join(' ')} trả exit ${r.status}.\n${r.out}`);
    }
    log.push({ what: 'git init + commit gốc (diff của task tính từ đây)', ms: 0 });
  }
  return log;
}

// The scenario's path relative to the repo, never an absolute one: a scenario
// outside the repo (a test's temp folder) would put this machine's path into
// the transcript.
function scenarioLabel(dir) {
  const rel = path.relative(REPO, dir);
  if (!rel) return '.';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return '(ngoài repo)';
  return rel.split(path.sep).join('/');
}

function display(argv) {
  return argv.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

function command(argv) {
  if (argv[0] === 'compass') return [process.execPath, [CLI, ...argv.slice(1)]];
  if (argv[0] === 'node') return [process.execPath, argv.slice(1)];
  return [argv[0], argv.slice(1)];
}

// Every spelling of the temp folder an output could carry: as created, after
// symlinks resolve, and with either slash.
function tempSpellings(workdir) {
  const forms = new Set();
  for (const p of [workdir, realpathSync.native(workdir)]) {
    forms.add(p);
    forms.add(p.split(path.sep).join('/'));
    forms.add(p.split('/').join('\\'));
  }
  return [...forms].filter(Boolean).sort((a, b) => b.length - a.length);
}

function maskTemp(text, spellings) {
  let count = 0;
  let out = text;
  for (const s of spellings) {
    const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, () => { count++; return TMP_MARK; });
  }
  return { text: out, count };
}

export function findLeaks(text) {
  return LEAK_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

function runSteps(sc, workdir, scenarioDir) {
  const spellings = tempSpellings(workdir);
  const steps = [];
  for (const [i, step] of sc.steps.entries()) {
    const n = i + 1;
    if (step.caption) {
      const files = [];
      for (const [from, to] of step.copy ?? []) {
        const target = path.join(workdir, to);
        mkdirSync(path.dirname(target), { recursive: true });
        cpSync(path.join(scenarioDir, from), target);
        files.push(to.split(path.sep).join('/'));
      }
      steps.push({ kind: 'caption', text: step.caption, detail: step.detail ?? '', files });
      continue;
    }

    // `compass <cmd>` runs as `node <repo>/cli.mjs <cmd>` but is shown the way a user types it.
    const shown = display(step.run);
    const [cmd, args] = command(step.run);
    const t0 = performance.now();
    const r = spawnSync(cmd, args, {
      cwd: workdir,
      encoding: 'utf8',
      timeout: STEP_TIMEOUT_MS,
      maxBuffer: 64_000_000,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    const ms = Math.round(performance.now() - t0);
    const exitCode = r.status ?? (r.signal ? 128 : 1);
    const stdout = maskTemp((r.stdout ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, ''), spellings);
    const stderr = maskTemp((r.stderr ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, ''), spellings);

    if (exitCode !== step.expect) {
      const tail = `${stdout.text}\n${stderr.text}`.trim().split('\n').slice(-15).join('\n');
      throw new Stop(1, [
        `✗ Bước ${n} "${shown}": scenario kỳ vọng exit ${step.expect}, lệnh thật trả exit ${exitCode}.`,
        'Dừng ở đây, không ghi video và transcript.',
        '',
        tail,
      ].join('\n'));
    }
    if (step.expectMatch && !new RegExp(step.expectMatch, 'u').test(stdout.text + stderr.text)) {
      throw new Stop(1, `✗ Bước ${n} "${shown}": exit đúng (${exitCode}) nhưng output không chứa /${step.expectMatch}/ như scenario kỳ vọng.\n${stdout.text}`);
    }
    steps.push({
      kind: 'run',
      command: shown,
      expectedExit: step.expect,
      exitCode,
      durationMs: ms,
      stdout: stdout.text,
      stderr: stderr.text,
      tempPathMasked: stdout.count + stderr.count,
      ...(step.still ? { still: step.still } : {}),
    });
  }
  return steps;
}

async function loadPlaywright(workdir) {
  const { findPlaywright } = await import(pathToFileURL(path.join(REPO, 'lib', 'browser.mjs')).href);
  const found = await findPlaywright(workdir);
  if (!found.ok) {
    throw new Stop(2, [
      '✗ Không tìm thấy Playwright ở bản sao của examples/todo — trình ghi cần nó để quay video.',
      'Compass không tự cài (giữ zero-dependency). Cài vào examples/todo rồi chạy lại:',
      '  cd examples/todo && npm install -D playwright && npx playwright install chromium',
    ].join('\n'));
  }
  return found.module;
}

export function renderPage(transcript) {
  const data = JSON.stringify(transcript).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return PAGE.replace('/*TRANSCRIPT*/null', () => data);
}

async function record(playwright, transcript, outDir) {
  const html = renderPage(transcript);
  const videoDir = mkdtempSync(path.join(os.tmpdir(), 'compass-demo-video-'));
  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (err) {
    throw new Stop(2, [
      '✗ Có Playwright nhưng không mở được Chromium:',
      `  ${String(err.message).split('\n')[0]}`,
      'Cài trình duyệt cho Playwright rồi chạy lại:',
      '  cd examples/todo && npx playwright install chromium',
    ].join('\n'));
  }
  try {
    const size = { width: 1280, height: 720 };
    const context = await browser.newContext({ viewport: size, recordVideo: { dir: videoDir, size } });
    const page = await context.newPage();
    const stills = [];
    await page.exposeFunction('__still', async (name) => {
      const file = path.join(outDir, `still-${name}.png`);
      await page.screenshot({ path: file });
      stills.push(file);
    });
    const t0 = Date.now();
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__done === true, null, { timeout: 15 * 60_000, polling: 250 });
    const seconds = (Date.now() - t0) / 1000;
    const video = page.video();
    await context.close();
    const target = path.join(outDir, VIDEO_NAME);
    await video.saveAs(target);
    return { target, seconds, stills };
  } finally {
    await browser.close();
    rmSync(videoDir, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sc = loadScenario(opts.scenario);
  const workdir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'compass-demo-')));
  try {
    console.log('Chuẩn bị thư mục tạm…');
    const prep = setup(sc, workdir, opts.scenario);
    console.log(`Chạy ${sc.steps.filter((s) => s.run).length} lệnh của scenario…`);
    const steps = runSteps(sc, workdir, opts.scenario);
    for (const s of steps) {
      if (s.kind === 'run') console.log(`  ${s.exitCode === 0 ? '✓' : '✗'} ${s.command} → exit ${s.exitCode} (kỳ vọng ${s.expectedExit}), ${(s.durationMs / 1000).toFixed(1)}s`);
    }

    // The commit of the compass code that produced this output, so a reader can check it out.
    const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
    const transcript = {
      title: sc.title ?? 'Compass — demo',
      recordedAt: new Date().toISOString().slice(0, 10),
      compassCommit: head.status === 0 ? head.stdout.trim() : null,
      node: process.version,
      platform: process.platform,
      scenario: scenarioLabel(opts.scenario),
      tempPathMark: TMP_MARK,
      setup: prep,
      steps,
    };

    const json = JSON.stringify(transcript, null, 2);
    const leaks = findLeaks(json);
    if (leaks.length) {
      throw new Stop(1, `✗ Transcript còn chứa thông tin của máy ghi (${leaks.join(', ')}). Không ghi video và transcript.`);
    }

    let playwright = null;
    if (opts.video) playwright = await loadPlaywright(workdir);

    mkdirSync(opts.out, { recursive: true });
    if (opts.video) {
      console.log('Quay video…');
      const { target, seconds, stills } = await record(playwright, transcript, opts.out);
      const bytes = statSync(target).size;
      console.log(`✓ ${path.relative(process.cwd(), target)} — ${seconds.toFixed(1)}s, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
      for (const s of stills) console.log(`  ảnh: ${path.relative(process.cwd(), s)}`);
    }
    writeFileSync(path.join(opts.out, TRANSCRIPT_NAME), json + '\n');
    console.log(`✓ ${path.relative(process.cwd(), path.join(opts.out, TRANSCRIPT_NAME))}`);
  } finally {
    if (opts.keep) console.log(`Giữ thư mục tạm: ${workdir}`);
    else rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

const PAGE = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Compass demo</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --text: #d6dde6; --dim: #7d8794; --green: #3fb950;
    --red: #f85149; --yellow: #d29922; --cyan: #58a6ff; --prompt: #a5d6ff;
    --card: #f4efe3; --card-ink: #1f2328; --card-accent: #b5651d;
  }
  html, body { margin: 0; height: 100%; background: var(--bg); }
  body { display: flex; flex-direction: column; font-family: "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace; color: var(--text); }
  header { flex: none; display: flex; align-items: center; gap: 14px; padding: 12px 28px; background: var(--panel); border-bottom: 1px solid #30363d; }
  header .dots span { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; color: #f0f6fc; letter-spacing: .02em; }
  header .meta { margin-left: auto; font-size: 13px; color: var(--dim); }
  #screen { flex: 1; overflow: hidden; padding: 18px 28px 24px; }
  #log { font-size: 17px; line-height: 1.5; }
  .line { white-space: pre-wrap; word-break: break-word; min-height: 1.5em; }
  .prompt { color: var(--prompt); }
  .prompt b { color: var(--green); font-weight: 600; }
  .cursor { display: inline-block; width: .6em; background: var(--text); animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .running { color: var(--yellow); }
  .ok { color: var(--green); }
  .bad { color: var(--red); }
  .hint { color: var(--cyan); }
  .warn { color: var(--yellow); }
  .dim { color: var(--dim); }
  .exit { color: var(--dim); font-size: 14px; margin-bottom: 10px; }
  .exit.bad { color: var(--red); }
  .exit.ok { color: var(--green); }
  .card { margin: 14px 0 16px; padding: 16px 22px; background: var(--card); color: var(--card-ink); border-left: 8px solid var(--card-accent); border-radius: 6px; font-family: "Segoe UI", system-ui, sans-serif; opacity: 0; transform: translateY(8px); transition: opacity .4s, transform .4s; }
  .card.show { opacity: 1; transform: none; }
  .card .tag { font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: var(--card-accent); font-weight: 700; }
  .card .title { font-size: 26px; font-weight: 700; margin: 2px 0 4px; }
  .card .detail { font-size: 17px; }
  .card .files { margin-top: 8px; font-family: "Cascadia Mono", Consolas, monospace; font-size: 14px; color: #57606a; }
  .card.intro { border-left-color: var(--green); }
  .card.intro .tag { color: #1a7f37; }
</style>
</head>
<body>
<header>
  <div class="dots"><span style="background:#ff5f57"></span><span style="background:#febc2e"></span><span style="background:#28c840"></span></div>
  <h1 id="title">Compass — demo</h1>
  <div class="meta" id="meta"></div>
</header>
<div id="screen"><div id="log"></div></div>
<script>
const T = /*TRANSCRIPT*/null;
const log = document.getElementById('log');
const screenEl = document.getElementById('screen');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => (ms / 1000).toFixed(1) + 's';

document.getElementById('title').textContent = T.title;
document.getElementById('meta').textContent = 'examples/todo · output thật, ghi ngày ' + T.recordedAt + ' · Node ' + T.node;

function scroll() {
  const over = log.scrollHeight - (screenEl.clientHeight - 70);
  log.style.transform = over > 0 ? 'translateY(' + (-over) + 'px)' : '';
}
function add(cls, text) {
  const el = document.createElement('div');
  el.className = 'line ' + (cls || '');
  el.textContent = text;
  log.appendChild(el);
  scroll();
  return el;
}
function colorOf(line) {
  const t = line.trimStart();
  if (t.startsWith('✓')) return 'ok';
  if (t.startsWith('✗')) return 'bad';
  if (t.startsWith('⚠')) return 'warn';
  if (t.startsWith('→')) return 'hint';
  return '';
}
async function card(kind, tag, title, detail, files) {
  const el = document.createElement('div');
  el.className = 'card ' + kind;
  const parts = [['tag', tag], ['title', title], ['detail', detail]];
  for (const [c, text] of parts) {
    if (!text) continue;
    const d = document.createElement('div');
    d.className = c;
    d.textContent = text;
    el.appendChild(d);
  }
  if (files && files.length) {
    const d = document.createElement('div');
    d.className = 'files';
    d.textContent = 'File: ' + files.join(' · ') + '   (soạn sẵn trong docs/demo/scenario/, chép vào)';
    el.appendChild(d);
  }
  log.appendChild(el);
  scroll();
  await sleep(30);
  el.classList.add('show');
}
async function typeCommand(cmd) {
  const el = add('prompt', '');
  const p = document.createElement('b');
  p.textContent = 'todo $ ';
  el.appendChild(p);
  const text = document.createTextNode('');
  el.appendChild(text);
  const cur = document.createElement('span');
  cur.className = 'cursor';
  cur.textContent = ' ';
  el.appendChild(cur);
  await sleep(500);
  for (const ch of cmd) {
    text.data += ch;
    await sleep(ch === ' ' ? 110 : 65);
  }
  await sleep(450);
  cur.remove();
}
async function run(step) {
  await typeCommand(step.command);
  const compressed = step.durationMs > 2000;
  const r = add('running', 'đang chạy… (thật: ' + secs(step.durationMs) + (compressed ? ' · tua nhanh trên video' : '') + ')');
  await sleep(Math.min(Math.max(step.durationMs, 700), 2000));
  r.remove();
  const lines = [step.stdout, step.stderr].filter(Boolean).join('\n').split('\n');
  for (const line of lines) {
    add(colorOf(line), line);
    await sleep(45);
  }
  add('exit ' + (step.exitCode === 0 ? 'ok' : 'bad'), 'exit ' + step.exitCode + ' · ' + secs(step.durationMs));
  if (step.tempPathMasked) add('dim', '(' + T.tempPathMark + ' thay cho đường dẫn thư mục tạm của máy ghi)');
  await sleep(Math.min(5500 + lines.length * 350, 12000) + (step.exitCode !== 0 ? 3000 : 0));
  if (step.still) await window.__still(step.still);
}

(async () => {
  await sleep(600);
  await card('intro', 'Compass — demo', 'Một task từ init đến done',
    'Mọi dòng trong khung terminal là output thật của compass, chạy trên một bản sao của examples/todo. ' +
    'Thẻ màu kem là việc AI làm trong Claude Code, không phải output.', null);
  await sleep(8000);
  for (const s of T.setup) add('dim', '# chuẩn bị: ' + s.what + (s.ms ? ' (thật: ' + secs(s.ms) + ')' : ''));
  await sleep(2500);
  for (const step of T.steps) {
    if (step.kind === 'caption') {
      await card('', 'Trong Claude Code — không phải output', step.text, step.detail, step.files);
      await sleep(7000);
    } else {
      await run(step);
    }
  }
  const total = T.steps.filter((s) => s.kind === 'run').reduce((a, s) => a + s.durationMs, 0);
  await card('intro', 'Hết', 'done xanh = mọi gate bắt buộc đã chạy thật và xanh trên đúng bản code này',
    'Thời gian chạy thật của các lệnh compass: ' + secs(total) + '. Nó không chứng minh test đo đúng mục tiêu — xem docs/huong-dan.md mục giới hạn.', null);
  await sleep(8000);
  window.__done = true;
})();
</script>
</body>
</html>`;

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((err) => {
  if (err instanceof Stop) {
    (err.code === 0 ? console.log : console.error)(err.message);
    process.exitCode = err.code;
    return;
  }
  console.error(`✗ Trình ghi dừng: ${err.message}`);
  process.exitCode = 1;
});
