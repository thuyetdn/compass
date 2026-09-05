import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewCommand } from '../commands/review.mjs';
import { readGate } from '../lib/gate-store.mjs';

const SPEC = `# T-1: Thêm bộ lọc quốc gia
Loại: fix
Phạm vi: src/

## Mục tiêu
Lọc danh sách theo quốc gia.

## Ràng buộc
Không đổi API.

## Rủi ro hồi quy
Trang Browse dùng chung endpoint.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo({ withChanges = true, gitInit = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-review-'));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({ test: 'true' }));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), SPEC);

  if (gitInit) {
    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test']);
    writeFileSync(path.join(root, 'src', 'filter.js'), 'export const filter = () => [];\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'base']);

    if (withChanges) {
      writeFileSync(path.join(root, 'src', 'filter.js'),
        'export const filter = (list, country) => list.filter((x) => x.country === country);\n');
    }
  }
  return root;
}

// A reviewer copies the brief's id into the findings; these tests read it back
// out of the brief the same way.
function briefIdFrom(root) {
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  return brief.match(/"brief":\s*"([^"]+)"/)?.[1] ?? null;
}

function writeFindings(root, findings, brief = briefIdFrom(root)) {
  writeFileSync(
    path.join(root, '.compass', 'T-1', 'evidence', 'findings.json'),
    JSON.stringify({ brief, findings }),
  );
}

test('H1 the first run writes a brief and refuses to pass', () => {
  const root = makeRepo();
  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(result.exitCode, 0, 'sinh brief xong không được coi là pass');
  assert.ok(existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')));
  assert.match(result.output, /agent KHÁC/);
});

test('H2 the brief carries both the spec and the diff', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /Thêm bộ lọc quốc gia/);   // from the spec
  assert.match(brief, /x\.country === country/); // from the diff
  assert.match(brief, /src\/filter\.js/);
});

test('S1 the brief carries no conversation and no author reasoning', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  // The three sections it may contain, and nothing that explains the author.
  assert.match(brief, /## Spec/);
  assert.match(brief, /## Diff/);
  assert.ok(!/lịch sử hội thoại:/i.test(brief));
  assert.ok(!/tôi đã|vì tôi|lý do tôi/i.test(brief));
});

test('EC2 a second run with nothing changed leaves the brief alone', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  const briefFile = path.join(root, '.compass', 'T-1', 'review-brief.md');
  const first = readFileSync(briefFile, 'utf8');

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(result.exitCode, 0);
  assert.equal(readFileSync(briefFile, 'utf8'), first);
  assert.match(result.output, /chưa ai nộp findings/i);
});

test('EC2 a hand-edited brief is replaced, not preserved', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  const briefFile = path.join(root, '.compass', 'T-1', 'review-brief.md');
  writeFileSync(briefFile, 'ĐÃ SỬA TAY — không còn là diff nào cả');

  // A brief is what a reviewer is handed. Keeping an edited one would let the
  // author choose what gets reviewed.
  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(result.exitCode, 0);
  assert.notEqual(readFileSync(briefFile, 'utf8'), 'ĐÃ SỬA TAY — không còn là diff nào cả');
  assert.match(readFileSync(briefFile, 'utf8'), /## Diff/);
});

test('H3 empty findings pass the gate', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /không có finding/);
});

test('H4 minor findings pass but are shown', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, [{ severity: 'Minor', title: 'Tên biến khó hiểu', detail: 'x không nói gì' }]);

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /Tên biến khó hiểu/);
});

test('H5 a major finding fails the gate and is named', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, [
    { severity: 'Major', title: 'Không xử lý list rỗng', detail: 'Sẽ throw', file: 'src/filter.js', line: 1 },
  ]);

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Không xử lý list rỗng/);
  assert.match(result.output, /src\/filter\.js:1/);
});

test('EC1 a critical finding fails the gate', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, [{ severity: 'Critical', title: 'Lộ token', detail: 'Log ra console' }]);

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
});

test('V1 malformed findings json is a usage error', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'findings.json'), '{ broken');

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /JSON/);
});

test('V2 a finding missing a field is a usage error naming it', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, [{ severity: 'Major', title: 'x' }]);

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /detail/);
});

test('E1 a directory that is not a git repo is reported', () => {
  const root = makeRepo({ gitInit: false });
  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /git/);
});

test('E2 nothing to review is reported rather than briefed', () => {
  const root = makeRepo({ withChanges: false });
  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không có thay đổi/);
  assert.ok(!existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')));
});

test('the gate record is signed and counts the findings', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, [
    { severity: 'Major', title: 'a', detail: 'b' },
    { severity: 'Info', title: 'c', detail: 'd' },
  ]);
  reviewCommand({ cwd: root, taskId: 'T-1' });

  const gate = readGate(root, 'T-1', 'review');
  assert.equal(gate.gate, 'review');
  assert.equal(gate.findingCount, 2);
  assert.equal(gate.blockingCount, 1);
  assert.equal(gate.exitCode, 1);
  assert.ok(gate.sig.startsWith('sha256:'));
});

test('a missing task id is a usage error', () => {
  const root = makeRepo();
  const result = reviewCommand({ cwd: root, taskId: undefined });
  assert.equal(result.exitCode, 2);
});

test('S2 a task made only of new files still produces a brief with their contents', () => {
  const root = makeRepo({ withChanges: false });
  // All the work is in a file git has never seen — the common shape for a new
  // module, and the shape `git diff` alone reports as "no changes".
  writeFileSync(path.join(root, 'src', 'brand-new.js'), 'export const secret = process.env.TOKEN;\n');

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(result.exitCode, 2, result.output);

  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /brand-new\.js/);
  assert.match(brief, /process\.env\.TOKEN/);
});

test('EC3 a mix of edited and new files puts both in the brief', () => {
  const root = makeRepo();
  writeFileSync(path.join(root, 'src', 'payout.js'), 'export const payout = () => transfer();\n');

  reviewCommand({ cwd: root, taskId: 'T-1' });
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /x\.country === country/); // the tracked edit
  assert.match(brief, /payout/);                 // the untracked addition
});

test('S3 changing the code after findings were filed reopens the review', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);
  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  // Reviewed and green — now change the code underneath that verdict.
  writeFileSync(path.join(root, 'src', 'backdoor.js'), 'eval(process.env.EVIL);\n');

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /Code hoặc spec đã đổi/);

  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /backdoor/);
});

test('EC4 reopening a review turns the recorded gate back to failing', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);
  reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(readGate(root, 'T-1', 'review').exitCode, 0);

  // The documented recovery: drop the findings and review again. done reads the
  // record rather than rerunning, so a stale pass here would close the task.
  rmSync(path.join(root, '.compass', 'T-1', 'evidence', 'findings.json'));
  reviewCommand({ cwd: root, taskId: 'T-1' });

  assert.equal(readGate(root, 'T-1', 'review').exitCode, 1);
});

test('phase one records a failing gate the very first time it runs', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  const gate = readGate(root, 'T-1', 'review');
  assert.equal(gate.exitCode, 1);
  assert.ok(gate.diffHash.startsWith('sha256:'));
});

test('EC5 a gate writing its own record does not reopen the review', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);
  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  // Gates write into .compass on every run. If that counted as changed code,
  // the review would reopen itself forever.
  writeFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'noise.log'), 'gate output\n');

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
});

test('V4 a finding whose line is not an integer drops the line, keeping the finding', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, [{ severity: 'Minor', title: 'x', detail: 'y', file: 'a.js', line: 'ba' }]);

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /a\.js/);
  assert.ok(!result.output.includes('a.js:ba'));
});

test('E3 findings whose brief has been deleted no longer count as a review', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);
  rmSync(path.join(root, '.compass', 'T-1', 'review-brief.md'));

  // The brief is the record of what an agent was handed. Without it there is
  // no evidence any review happened, whoever deleted it and why.
  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /brief/i);
});

test('P1 a large diff is collected without blowing the buffer', () => {
  const root = makeRepo();
  // ~4MB of source, far past the 1MB execFileSync default.
  writeFileSync(path.join(root, 'src', 'big.js'),
    Array.from({ length: 60000 }, (_, i) => `export const v${i} = ${i};`).join('\n'));

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(result.exitCode, 2, result.output);
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.ok(brief.length > 1_000_000, 'brief phải chứa được diff lớn');
});

test('P2 a second phase-one run reuses the brief instead of rebuilding it', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  const briefFile = path.join(root, '.compass', 'T-1', 'review-brief.md');
  const first = readFileSync(briefFile, 'utf8');

  reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(readFileSync(briefFile, 'utf8'), first);
});

test('a review that has never run leaves no gate record to mistake for a pass', () => {
  const root = makeRepo();
  assert.equal(readGate(root, 'T-1', 'review'), null);
});

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

test('S4 running phase one twice keeps the diffHash that detects later edits', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  reviewCommand({ cwd: root, taskId: 'T-1' }); // a second look at status, nothing unusual

  writeFileSync(path.join(root, 'src', 'oops.js'), 'eval(process.env.EVIL);\n');
  // A reviewer reading the brief files an honest empty result for what it shows.
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 0, result.output);
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /oops/, 'brief phải chứa code mới trước khi được pass');
});

test('S5 findings filed without any brief do not count as a review', () => {
  const root = makeRepo();
  writeFindings(root, [], 'khong-co-brief'); // no brief was ever generated

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /chưa từng sinh brief/);
});

test('S6 deleting gate.json does not revive a stale pass', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);
  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  writeFileSync(path.join(root, 'src', 'backdoor.js'), 'eval(process.env.EVIL);\n');
  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 1); // reopened

  // Removing the ledger must not launder the old findings into a pass.
  rmSync(path.join(root, '.compass', 'T-1', 'evidence', 'gate.json'));
  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, result.output);
});

test('S7 the gate leaves the git index exactly as it found it', () => {
  const root = makeRepo();
  writeFileSync(path.join(root, 'src', 'private-note.js'), 'const token = "shh";\n');
  const before = gitOut(root, ['status', '--porcelain']);

  reviewCommand({ cwd: root, taskId: 'T-1' });

  const after = gitOut(root, ['status', '--porcelain'])
    .split('\n')
    .filter((l) => !l.includes('.compass'))
    .join('\n');
  const expected = before
    .split('\n')
    .filter((l) => !l.includes('.compass'))
    .join('\n');
  assert.equal(after, expected, 'gate không được để file nào ở trạng thái đã stage');
});

test('EC6 a brief left over from older code is rebuilt', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFileSync(path.join(root, 'src', 'later.js'), 'export const later = 1;\n');

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Code hoặc spec đã đổi/);
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /later\.js/);
});

test('S8 committing does not erase the evidence — new code after a commit still reopens review', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);
  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  // Commit the reviewed work, then add code nobody has read and commit that too.
  git(root, ['add', '-A', '--', 'src']);
  git(root, ['commit', '-m', 'reviewed work']);
  writeFileSync(path.join(root, 'src', 'backdoor.js'), 'eval(process.env.EVIL);\n');
  git(root, ['add', '-A', '--', 'src']);
  git(root, ['commit', '-m', 'sneak']);

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 1, result.output);
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /backdoor/);
});

test('S9 a staged deletion the user made survives the gate', () => {
  const root = makeRepo();
  // The shape that matters: a file committed by mistake, then removed from the
  // index on purpose. Restoring it would put a secret back on the next commit.
  writeFileSync(path.join(root, 'secrets.env'), 'TOKEN=shh\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'oops']);
  git(root, ['rm', '--cached', '--quiet', 'secrets.env']);

  const before = gitOut(root, ['status', '--porcelain', '--', 'secrets.env']).trim();
  assert.match(before, /^D/, 'phải đang ở trạng thái staged deletion trước khi chạy');

  reviewCommand({ cwd: root, taskId: 'T-1' });

  const after = gitOut(root, ['status', '--porcelain', '--', 'secrets.env']).trim();
  assert.equal(after, before, 'gate không được huỷ việc xoá đã stage');
});

test('S10 a new file whose name has Vietnamese diacritics reaches the brief', () => {
  const root = makeRepo();
  writeFileSync(path.join(root, 'src', 'bộ-lọc.js'), 'export const payload = process.env.TOKEN;\n');

  reviewCommand({ cwd: root, taskId: 'T-1' });
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /process\.env\.TOKEN/, 'nội dung file tên có dấu phải có trong brief');
});

function setConfig(root, extra) {
  writeFileSync(
    path.join(root, '.compass', 'config.json'),
    JSON.stringify({ test: 'true', ...extra }),
  );
}

test('S11 findings cannot be judged when the diff is unavailable', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);
  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  // Hiding the repo used to skip every check at once and pass.
  writeFileSync(path.join(root, 'src', 'backdoor.js'), 'eval(process.env.EVIL);\n');
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' });
  rmSync(path.join(root, '.git'), { recursive: true, force: true });

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(result.exitCode, 0, result.output);
});

test('S12 a reviewBase that is a git flag is refused, not passed through', () => {
  const root = makeRepo();
  const target = path.join(root, 'PWNED.txt');
  setConfig(root, { reviewBase: `--output=${target}` });

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2, result.output);
  assert.ok(!existsSync(target), 'gate không được để git ghi file theo cờ trong config');
});

test('S13 a reviewBase naming no commit is refused', () => {
  const root = makeRepo();
  setConfig(root, { reviewBase: 'khong-ton-tai-dau' });

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /reviewBase/);
});

test('E4 a repo with no commits is reported instead of crashing', () => {
  const root = makeRepo({ gitInit: false });
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' });
  writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /commit/);
});

test('P3 hundreds of untracked files do not overflow the command line', () => {
  const root = makeRepo();
  for (let i = 0; i < 1200; i++) {
    writeFileSync(path.join(root, 'src', `gen-${i}.js`), `export const v${i} = ${i};\n`);
  }

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(result.exitCode, 2, result.output);
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /gen-1199\.js/);
});

test('P4 a diff too large to read is refused with the numbers', () => {
  const root = makeRepo();
  // ~7MB: past what any reviewer or context window takes in.
  writeFileSync(path.join(root, 'src', 'huge.js'),
    Array.from({ length: 250000 }, (_, i) => `export const v${i} = ${i};`).join('\n'));

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(result.exitCode, 2, result.output);
  assert.match(result.output, /quá lớn/);
  assert.ok(!existsSync(path.join(root, '.compass', 'T-1', 'review-brief.md')),
    'không sinh brief mà không ai đọc nổi');
});

test('S14 an unjudgeable diff turns the recorded gate back to failing', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);
  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);
  assert.equal(readGate(root, 'T-1', 'review').exitCode, 0);

  // Writing a lot of code puts the diff past the size limit. done reads the
  // ledger, so leaving the old pass there would close the task on that alone.
  writeFileSync(path.join(root, 'src', 'huge.js'),
    Array.from({ length: 250000 }, (_, i) => `export const v${i} = ${i};`).join('\n'));

  reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(readGate(root, 'T-1', 'review').exitCode, 1);
});

test('P5 long untracked paths are batched by length, not by count', () => {
  const root = makeRepo();
  // Paths near 170 characters: 200 of them in one command overflows the limit.
  const deep = path.join(root, 'src', 'a'.repeat(60), 'b'.repeat(60));
  mkdirSync(deep, { recursive: true });
  for (let i = 0; i < 400; i++) {
    writeFileSync(path.join(deep, `tệp-tiếng-việt-số-${i}.js`), `export const v${i} = ${i};\n`);
  }

  const result = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(result.exitCode, 2, result.output);
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');
  assert.match(brief, /tệp-tiếng-việt-số-399/);
});

// Markdown lets a closing fence sit under up to three spaces of indent, and a
// diff context line starts with exactly one — so a fence inside a hunk ends the
// brief's code block early, and everything after it renders as Compass's own
// words. Find where the block really closes, by markdown's rule.
function diffBlockBody(brief) {
  const section = brief.slice(brief.indexOf('## Diff'));
  const open = section.match(/^(`{3,})diff$/m);
  if (!open) return null;

  const lines = section.slice(section.indexOf(open[0]) + open[0].length + 1).split('\n');
  const closing = new RegExp(`^ {0,3}${open[1]}\\s*$`);
  const end = lines.findIndex((line) => closing.test(line));
  return { fence: open[1], body: (end === -1 ? lines : lines.slice(0, end)).join('\n') };
}

test('S15 a diff containing a code fence does not break out of the brief block', () => {
  const root = makeRepo();
  // A markdown file with a code block, committed first so its fences show up as
  // context lines — a leading space, which markdown still reads as a closing
  // fence. A new file would prefix every line with '+' and hide the problem.
  writeFileSync(path.join(root, 'README.md'), [
    'giữ dòng này',
    '```js',
    'const a = 1;',
    '```',
    'giữ dòng này nữa',
  ].join('\n'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'add readme']);
  setConfig(root, { reviewBase: 'HEAD' });

  writeFileSync(path.join(root, 'README.md'), [
    'ĐÃ SỬA đầu',
    '```js',
    'const a = 1;',
    '```',
    'ĐÃ SỬA cuối',
  ].join('\n'));
  writeFileSync(path.join(root, 'src', 'evil.js'), 'eval(process.env.EVIL); // DAU_HIEU_TIEM_AN\n');

  reviewCommand({ cwd: root, taskId: 'T-1' });
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');

  assert.match(brief, /DAU_HIEU_TIEM_AN/, 'thay đổi thật phải có trong brief');

  const block = diffBlockBody(brief);
  assert.ok(block, 'brief phải có khối diff');
  assert.match(block.body, /DAU_HIEU_TIEM_AN/,
    'thay đổi thật phải nằm TRONG khối diff, không lọt ra ngoài thành văn xuôi của Compass');
});

test('S16 a spec containing a code fence stays inside its own block', () => {
  const root = makeRepo();
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'),
    SPEC.replace('Lọc danh sách theo quốc gia.', 'Ví dụ:\n\n```js\nfilter(list)\n```\n\nLọc theo quốc gia.'));

  reviewCommand({ cwd: root, taskId: 'T-1' });
  const brief = readFileSync(path.join(root, '.compass', 'T-1', 'review-brief.md'), 'utf8');

  const specBlock = brief.slice(brief.indexOf('## Spec'), brief.indexOf('## Các file đã đổi'));
  const fence = specBlock.match(/\n(`{4,})markdown\n/)?.[1];
  assert.ok(fence, 'spec chứa ``` thì hàng rào phải dài hơn ba backtick');
});

test('S17 rewriting the spec keeps the review reopened, not just for one run', () => {
  const root = makeRepo();
  reviewCommand({ cwd: root, taskId: 'T-1' });
  writeFindings(root, []);
  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  // Same code, different promise. A reviewer judges code against what it said
  // it would do, so a new spec invalidates the old verdict.
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'),
    SPEC.replace('Không đổi API.', 'Không được log thẻ tín dụng. Phải mã hoá PII.'));

  assert.equal(reviewCommand({ cwd: root, taskId: 'T-1' }).exitCode, 1, 'lần một phải chặn');
  const second = reviewCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(second.exitCode, 1, 'lần hai vẫn phải chặn — không được tự pass');
  assert.equal(readGate(root, 'T-1', 'review').exitCode, 1);
});
