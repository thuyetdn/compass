import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPLEMENTED_GATES } from '../lib/gates.mjs';

// CP-58 — the docs a developer meets first must say what the code does, and the
// demo transcript must hold only what the commands really returned.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = 'README.md';
const GUIDE = 'docs/huong-dan.md';
const TODO_README = 'examples/todo/README.md';
const TRANSCRIPT = 'docs/demo/transcript.json';
const RECORDER = path.join(ROOT, 'docs', 'demo', 'record.mjs');
const SPEC_BASE = 'f94ebdd';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').normalize('NFC');
const lower = (s) => s.normalize('NFC').toLocaleLowerCase('vi');

// Fenced blocks hold examples, not links or headings of the document itself.
function splitFences(text) {
  const prose = [];
  const code = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence === null && m) { fence = m[1][0].repeat(m[1].length); continue; }
    if (fence !== null && line.trim().startsWith(fence)) { fence = null; continue; }
    (fence === null ? prose : code).push(line);
  }
  return { prose: prose.join('\n'), code: code.join('\n') };
}

const inlineCode = (prose) => [...prose.matchAll(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g)].map((m) => m[2]);
const stripInlineCode = (prose) => prose.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, '');

// A section: from a `##`-or-deeper heading matching `re` to the next heading of
// the same or higher level.
function section(text, re) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,6}\s/.test(l) && re.test(lower(l)));
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

function links(rel) {
  const { prose } = splitFences(read(rel));
  const text = stripInlineCode(prose);
  const out = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push(m[1]);
  for (const m of text.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/gm)) out.push(m[1]);
  return out;
}

const isExternal = (href) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

// GitHub's heading anchors: lowercase, punctuation dropped (letters with
// diacritics kept), each space a hyphen, repeats numbered -1, -2…
function slugify(heading) {
  const plain = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .trim();
  return lower(plain).replace(/[^\p{L}\p{M}\p{N}_ -]/gu, '').replace(/ /g, '-');
}

function headingSlugs(rel) {
  const { prose } = splitFences(read(rel));
  const seen = new Map();
  const slugs = new Set();
  for (const line of prose.split('\n')) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

const NUMBER_WORDS = new Map([
  ['một', 1], ['hai', 2], ['ba', 3], ['bốn', 4], ['năm', 5], ['sáu', 6],
  ['bảy', 7], ['tám', 8], ['chín', 9], ['mười', 10],
]);

// Copied from test/wording.test.mjs (it exports nothing). CP-58-V3 checks below
// that the copy has not drifted from the source.
const CLIPPED_KIEM = /[kK]iểm(?! tra| chứng| soát| định| duyệt| toán| kê|\(\?)/gu;
const STANDALONE_CA = /(?<![\p{L}\p{N}])[cC]a(?![\p{L}\p{N}])/gu;

// The identities CP-58-S1 names, written out here rather than imported from the
// recorder so a weaker list there cannot make this test weaker.
const LEAKS = [
  ['ổ đĩa Windows', /[A-Z]:\\/],
  ['C:\\Users', /C:\\Users/i],
  ['/Users/', /\/Users\//],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
];

function runRecorder(args, env = {}) {
  return spawnSync(process.execPath, [RECORDER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, ...env },
  });
}

// A scenario that runs in a second: a one-file fixture, no npm install, no git.
function tinyScenario(steps) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cp58-scenario-'));
  mkdirSync(path.join(dir, 'fixture'));
  writeFileSync(path.join(dir, 'fixture', 'package.json'), '{ "name": "tiny", "private": true }\n');
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify({ title: 'tiny', fixture: 'fixture', setup: {}, steps }));
  const out = mkdtempSync(path.join(os.tmpdir(), 'cp58-out-'));
  return { dir, out, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); } };
}

test('CP-58-H1 README states the gate count and gate list that lib/gates.mjs implements', () => {
  const text = read(README);
  const scope = section(text, /trạng thái/) ?? text;
  // "Tám gate: `spec`, …" — a number word or digits, then "gate".
  const countIn = (p) => {
    for (const m of lower(p).matchAll(/(?<![\p{L}\p{N}])(\p{L}+|\d+)\**\s+gate(?![\p{L}])/gu)) {
      if (/^\d+$/.test(m[1])) return { word: m[1], count: Number(m[1]) };
      if (NUMBER_WORDS.has(m[1])) return { word: m[1], count: NUMBER_WORDS.get(m[1]) };
    }
    return null;
  };
  const para = splitFences(scope).prose.split(/\n\s*\n/).find((p) => countIn(p) !== null);
  assert.ok(para, `${README} phải có câu "<số> gate: …" (trong mục Trạng thái nếu có)`);
  const { word, count } = countIn(para);
  assert.equal(count, IMPLEMENTED_GATES.length,
    `README nói "${word} gate", lib/gates.mjs có ${IMPLEMENTED_GATES.length}: ${IMPLEMENTED_GATES.join(', ')}`);
  const listed = inlineCode(para).filter((t) => /^[a-z]+$/.test(t));
  assert.deepEqual([...new Set(listed)].sort(), [...IMPLEMENTED_GATES].sort(), 'danh sách gate trong README phải trùng IMPLEMENTED_GATES');
});

test('CP-58-H2 every compass command the guide mentions is one cli.mjs dispatches', () => {
  const cli = readFileSync(path.join(ROOT, 'cli.mjs'), 'utf8');
  const dispatched = new Set([...cli.matchAll(/^\s*case\s+'([a-z-]+)'\s*:/gm)].map((m) => m[1]));
  assert.ok(dispatched.has('done') && dispatched.size >= 10, `đọc sai cli.mjs: ${[...dispatched].join(', ')}`);

  const { prose, code } = splitFences(read(GUIDE));
  const codeText = [code, ...inlineCode(prose)].join('\n');
  const mentioned = [
    ...[...codeText.matchAll(/(?<![\w/.@-])compass[ \t]+([a-z][a-z-]*)(?![\p{L}\p{N}_-])/gu)].map((m) => m[1]),
    ...[...codeText.matchAll(/cli\.mjs"?[ \t]+([a-z][a-z-]*)(?![\p{L}\p{N}_-])/gu)].map((m) => m[1]),
  ];
  const unknown = [...new Set(mentioned.filter((c) => !dispatched.has(c)))];
  assert.deepEqual(unknown, [], `${GUIDE} nhắc lệnh cli.mjs không có: ${unknown.join(', ')}`);
  for (const must of ['init', 'spec', 'check', 'done']) {
    assert.ok(mentioned.includes(must), `${GUIDE} phải chỉ lệnh \`compass ${must}\` cho task đầu tiên`);
  }
});

test('CP-58-H3 every relative link in README, the guide and the todo README points at a file in the repo', () => {
  const broken = [];
  const intoDogfood = [];
  for (const rel of [README, GUIDE, TODO_README]) {
    for (const href of links(rel)) {
      if (isExternal(href) || href.startsWith('#')) continue;
      const target = decodeURIComponent(href.split('#')[0].split('?')[0]);
      const abs = path.resolve(ROOT, path.dirname(rel), target);
      const inRepo = path.relative(ROOT, abs).split(path.sep).join('/');
      if (!existsSync(abs) || inRepo.startsWith('..')) broken.push(`${rel} → ${href}`);
      // The release branch drops these (spec Ràng buộc): a link into them ships broken.
      if (/^docs\/superpowers(\/|$)|^\.compass\/(CP|INV)-/.test(inRepo)) intoDogfood.push(`${rel} → ${href}`);
    }
  }
  assert.deepEqual(broken, [], `link trỏ tới file không có:\n${broken.join('\n')}`);
  assert.deepEqual(intoDogfood, [], `link trỏ vào thư mục nhánh phát hành sẽ bỏ:\n${intoDogfood.join('\n')}`);
});

// Bản ghi demo, không phải file video. Video đã bỏ khỏi repo ở CP-68: 9.8 MB
// cho một bản quay terminal mà trang demo kể câu chuyện đó tốt hơn. Transcript
// thì ở lại, vì nó là thứ chứng minh demo nói thật — mọi dòng trên trang demo
// đều lấy từ đây, và `record.mjs` vẫn quay lại được khi cần.
test('CP-58-H4 the demo transcript runs a red gate, its fix, and a green done', () => {
  const t = JSON.parse(read(TRANSCRIPT));
  const runs = t.steps.filter((s) => s.kind === 'run');
  for (const s of runs) assert.equal(s.exitCode, s.expectedExit, `bước "${s.command}" có exit ${s.exitCode}, kỳ vọng ${s.expectedExit}`);
  const red = runs.findIndex((s) => /^compass check /.test(s.command) && s.exitCode !== 0);
  assert.ok(red !== -1, 'video phải có một lần check đỏ');
  const greenAfter = runs.slice(red + 1).find((s) => /^compass check /.test(s.command) && s.exitCode === 0);
  assert.ok(greenAfter, 'sau lần đỏ phải có một lần check xanh');
  const last = runs.at(-1);
  assert.match(last.command, /^compass done /);
  assert.equal(last.exitCode, 0);
});

test('CP-58-H5 the guide has the sections a first-time developer needs', () => {
  const headings = splitFences(read(GUIDE)).prose.split('\n').filter((l) => /^#{1,6}\s/.test(l)).map(lower);
  const has = (needle) => headings.some((h) => h.includes(needle));
  for (const needle of ['cài đặt', 'task đầu tiên', 'các gate', 'giới hạn', 'góp ý']) {
    assert.ok(has(needle), `${GUIDE} thiếu heading chứa "${needle}"`);
  }
});

test('CP-58-H6 package.json keeps bin, files and scripts exactly as at the spec base', () => {
  let before;
  try {
    before = JSON.parse(execFileSync('git', ['show', `${SPEC_BASE}:package.json`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    assert.fail(`không đọc được package.json ở ${SPEC_BASE} — clone thiếu lịch sử?`);
  }
  const now = JSON.parse(read('package.json'));
  for (const key of ['bin', 'files', 'scripts']) {
    assert.equal(JSON.stringify(now[key]), JSON.stringify(before[key]), `"${key}" đã đổi so với ${SPEC_BASE}`);
  }
  assert.ok(now.files.includes('cli.mjs'), 'files phải có cli.mjs');
  assert.ok(now.files.includes('skills/'), 'files phải có skills/');
});

test('CP-58-V1 the README install section is runnable as written', () => {
  const install = section(read(README), /^#+\s+cài/);
  assert.ok(install, 'README phải có mục "Cài"');
  const { prose, code } = splitFences(install);
  const commandLines = [...code.split('\n'), ...inlineCode(prose)].filter((l) => l.trim() !== '');
  const placeholders = commandLines.filter((l) => /<[^<>\n]+>/.test(l));
  assert.deepEqual(placeholders, [], `dòng lệnh còn placeholder <…>:\n${placeholders.join('\n')}`);
  assert.ok(commandLines.some((l) => /\/plugin marketplace add\s+thuyetdn\/compass(?![\w-])/.test(l)),
    'lệnh marketplace phải là /plugin marketplace add thuyetdn/compass');
});

test('CP-58-V2 package.json and both plugin manifests agree on version and name', () => {
  const pkg = JSON.parse(read('package.json'));
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  const entry = market.plugins?.[0];
  assert.ok(entry, 'marketplace.json phải có plugins[0]');
  assert.equal(pkg.version, plugin.version, 'package.json và plugin.json lệch version');
  assert.equal(entry.version, plugin.version, 'marketplace.json plugins[0] và plugin.json lệch version');
  assert.equal(plugin.name, 'compass');
  assert.equal(entry.name, 'compass');
  assert.equal(entry.source, './', 'đổi source là mọi bản đã cài gãy khi cập nhật');
});

test('CP-58-V3 the guide has no standalone "ca" and no clipped "kiểm"', () => {
  const wording = readFileSync(path.join(ROOT, 'test', 'wording.test.mjs'), 'utf8');
  assert.ok(wording.includes(CLIPPED_KIEM.source) && wording.includes(STANDALONE_CA.source),
    'mẫu chép từ test/wording.test.mjs đã lệch bản gốc — chép lại');
  const found = [];
  read(GUIDE).split('\n').forEach((line, i) => {
    for (const [label, re] of [['kiểm', CLIPPED_KIEM], ['ca', STANDALONE_CA]]) {
      re.lastIndex = 0;
      if (re.test(line)) found.push(`${i + 1} (${label}): ${line.trim()}`);
    }
  });
  assert.deepEqual(found, [], `${GUIDE}:\n${found.slice(0, 5).join('\n')}`);
});

test('CP-58-E1 a step whose real exit code differs from the scenario stops the recorder and writes no video', () => {
  const sc = tinyScenario([{ run: ['node', '-e', 'process.exit(1)'], expect: 0 }]);
  try {
    const r = runRecorder(['--scenario', sc.dir, '--out', sc.out]);
    const said = r.stdout + r.stderr;
    assert.notEqual(r.status, 0, said);
    assert.match(said, /Bước 1/, 'phải nêu bước');
    assert.ok(said.includes('node -e process.exit(1)'), `phải nêu lệnh của bước:\n${said}`);
    assert.match(said, /exit 0/, 'phải nêu exit kỳ vọng');
    assert.match(said, /exit 1/, 'phải nêu exit thật');
    assert.deepEqual(readdirSync(sc.out), [], 'không được ghi file nào');
  } finally {
    sc.cleanup();
  }
});

test('CP-58-E2 without Playwright the recorder exits 2 with an install hint and no stack trace', () => {
  const sc = tinyScenario([{ run: ['node', '-e', 'process.exit(0)'], expect: 0 }]);
  try {
    const r = runRecorder(['--scenario', sc.dir, '--out', sc.out]);
    const said = r.stdout + r.stderr;
    assert.equal(r.status, 2, said);
    assert.ok(said.includes('npm install -D playwright'), `thiếu lời nhắc cài:\n${said}`);
    assert.doesNotMatch(said, /^\s+at\s/m, 'không được in stack trace');
    assert.ok(!readdirSync(sc.out).some((f) => f.endsWith('.webm')), 'không được ghi video');
  } finally {
    sc.cleanup();
  }
});

test('CP-58-EC1 every #anchor link in README and the guide matches a heading in its target', () => {
  const bad = [];
  for (const rel of [README, GUIDE]) {
    for (const href of links(rel)) {
      if (isExternal(href) || !href.includes('#')) continue;
      const [file, anchor] = href.split('#');
      const targetRel = file === ''
        ? rel
        : path.relative(ROOT, path.resolve(ROOT, path.dirname(rel), decodeURIComponent(file))).split(path.sep).join('/');
      if (!targetRel.endsWith('.md') || !existsSync(path.join(ROOT, targetRel))) {
        bad.push(`${rel} → ${href} (đích không phải file .md có thật)`);
        continue;
      }
      if (!headingSlugs(targetRel).has(lower(decodeURIComponent(anchor)))) bad.push(`${rel} → ${href}`);
    }
  }
  assert.deepEqual(bad, [], `anchor không khớp heading nào:\n${bad.join('\n')}`);
});

test('CP-58-S1 transcript, README and guide carry no local path and no email', () => {
  const found = [];
  for (const rel of [TRANSCRIPT, README, GUIDE]) {
    read(rel).split('\n').forEach((line, i) => {
      for (const [label, re] of LEAKS) if (re.test(line)) found.push(`${rel}:${i + 1} (${label}): ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(found, [], found.join('\n'));
});

test('CP-58-S2 a recorder run leaves the repo copy of examples/todo untouched', () => {
  const status = () => execFileSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all', '--', 'examples/todo'],
    { cwd: ROOT, encoding: 'utf8' });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cp58-s2-'));
  const out = mkdtempSync(path.join(os.tmpdir(), 'cp58-s2-out-'));
  // Real compass writes — a spec, a salt, derived docs, gate evidence — all of
  // which must land in the temp copy.
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify({
    title: 's2',
    fixture: path.join(ROOT, 'examples', 'todo'),
    setup: { git: true },
    steps: [
      { run: ['compass', 'init', 'TD-900', '--type=fix'], expect: 0 },
      { run: ['compass', 'knowledge', '--sync'], expect: 0 },
      { run: ['compass', 'spec', 'TD-001'], expect: 0 },
      { run: ['compass', 'convention', 'TD-001'], expect: 0 },
    ],
  }));
  try {
    const before = status();
    const r = runRecorder(['--scenario', dir, '--out', out, '--no-video']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(status(), before, 'examples/todo đổi sau khi trình ghi chạy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
