// CP-13 — chạy gate ở từng repo mà task đụng tới.
//
// CP-12 đọc được khai báo `repos` nhưng `check` không dùng: task sửa backend rồi
// sửa frontend chỉ được kiểm một nửa, và nửa nào thì tùy lệnh test ở gốc trỏ
// vào đâu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkCommand } from '../commands/check.mjs';
import { doneCommand } from '../commands/done.mjs';
import { initRepo } from './helpers/git-repo.mjs';
import { withinBudgetAsync } from './helpers/timing.mjs';
import { testCommand } from '../commands/test.mjs';
import { readGates, readGate, slotFor, parseSlot } from '../lib/gate-store.mjs';
import { getSalt, signRecord } from '../lib/signature.mjs';
import { gatePath } from '../lib/paths.mjs';

const IN = (s) => `node -e "console.log('${s}')"`;
const DO = 'node -e "process.exit(1)"';

function spec({ scope = 'be/src, fe/src', ids = ['H1', 'H2'] } = {}) {
  const rows = ids.map((id, i) => `| ${id} | Happy | Case ${i + 1} | Đúng | P0 |`);
  return [
    '# T-1: Đụng nhiều repo',
    'Loại: fix',
    `Phạm vi: ${scope}`,
    '',
    '## Mục tiêu', 'Làm gì đó.', '',
    '## Ràng buộc', 'Không có.', '',
    '## Rủi ro hồi quy', 'Không có.', '',
    '## Test cases',
    '| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |',
    '|----|-----|-------|---------|---------|',
    ...rows,
    '',
  ].join('\n');
}

function makeRoot({ config, specText = spec(), dirs = ['be/src', 'fe/src'] }) {
  const root = initRepo(mkdtempSync(path.join(tmpdir(), 'compass-multi-')));
  mkdirSync(path.join(root, '.compass', 'T-1', 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(path.join(root, '.compass', 'T-1', 'spec.md'), specText);
  for (const d of dirs) mkdirSync(path.join(root, d), { recursive: true });
  return root;
}

const HAI_REPO = {
  test: 'true',
  repos: {
    be: { test: IN('ok 1 - T-1-H1 backend') },
    fe: { test: IN('ok 1 - T-1-H2 frontend') },
  },
};

test('CP-13-H1 a project with no repos declared behaves exactly as before', async () => {
  // Dự án một repo phải chạy y như cũ — cùng thư mục, cùng khe bản ghi.
  const root = makeRoot({
    config: { test: IN("ok 1 - T-1-H1 a'); console.log('ok 2 - T-1-H2 b") },
    specText: spec({ scope: 'src/' }),
    dirs: ['src'],
  });
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
  assert.ok(readGates(root, 'T-1').test, 'khe vẫn là `test`, không có `@`');
});

test('CP-13-H2 both repos run when the scope touches both', async () => {
  const root = makeRoot({ config: HAI_REPO });
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
  const log = readFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'test.log'), 'utf8');
  assert.match(log, /backend/);
  assert.match(log, /frontend/);
});

test('CP-13-H3 only the repo in scope runs', async () => {
  const root = makeRoot({
    config: HAI_REPO,
    specText: spec({ scope: 'be/src', ids: ['H1', 'H2'] }),
  });
  // H2 sẽ thiếu — đó là đúng: repo fe không chạy. Ta chỉ quan tâm ai đã chạy.
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const log = readFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'test.log'), 'utf8');
  assert.match(log, /backend/);
  assert.ok(!log.includes('frontend'), 'repo ngoài phạm vi không được chạy');
});

test('CP-13-H4 the output says which repo each result came from', async () => {
  const root = makeRoot({ config: HAI_REPO });
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const log = readFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'test.log'), 'utf8');
  assert.match(log, /# repo be/);
  assert.match(log, /# repo fe/, 'không nêu repo thì đọc log không biết ai chạy ai');
});

test('CP-13-H5 check exits zero when every repo is green', async () => {
  const root = makeRoot({ config: HAI_REPO });
  assert.equal((await checkCommand({ cwd: root, taskId: 'T-1' })).exitCode, 0);
});

test('CP-13-H6 done closes after a multi-repo check', async () => {
  const root = makeRoot({ config: HAI_REPO });
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 0, r.output);
});

test('CP-13-H7 cases split across repos are compared once, on the merged result', async () => {
  // Spec không chia ca theo repo. Bắt mỗi repo đủ mọi ca thì backend đòi cả ca
  // frontend, và không task đa repo nào đóng được.
  const root = makeRoot({ config: HAI_REPO });
  const r = testCommand({
    cwd: root, taskId: 'T-1', gateRoot: root,
    repos: [{ name: 'be', dir: path.join(root, 'be') }, { name: 'fe', dir: path.join(root, 'fe') }],
  });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /2\/2/, 'gộp rồi mới đối chiếu');
});

test('CP-13-V1 one red repo fails the check and names it', async () => {
  const root = makeRoot({
    config: { test: 'true', repos: { be: { test: IN('ok 1 - T-1-H1 a') }, fe: { test: DO } } },
  });
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(r.exitCode, 0);
});

test('CP-13-V2 a scope matching no repo is refused, not run everywhere', async () => {
  // Âm thầm chạy hết là tệ nhất: người viết tưởng đã kiểm đúng repo mình sửa.
  const root = makeRoot({ config: HAI_REPO, specText: spec({ scope: 'khong-he-co/src' }) });
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 2);
  assert.match(r.output, /không khớp repo nào/);
  assert.match(r.output, /be, fe/, 'phải nêu repo có những gì');
});

test('CP-13-V4 a malformed repos block stops everything before any gate runs', async () => {
  const root = makeRoot({ config: { test: 'true', repos: ['be', 'fe'] } });
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 2);
  assert.match(r.output, /repos/);
});

test('CP-13-E1 a repo whose test command does not exist says which repo', async () => {
  const root = makeRoot({
    config: { test: 'true', repos: { be: { test: 'lenh-khong-he-ton-tai-abc' }, fe: { test: IN('ok 1 - T-1-H2 b') } } },
  });
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(r.exitCode, 0);
  assert.doesNotMatch(r.output, /Cannot read|undefined is not/, 'không được crash');
});

test('CP-13-E2 a repo directory removed mid-run is reported, not crashed on', async () => {
  const root = makeRoot({ config: HAI_REPO });
  rmSync(path.join(root, 'fe'), { recursive: true, force: true });
  const r = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 2);
  assert.match(r.output, /fe/);
});

test('CP-13-EC1 two repos writing the same gate do not overwrite each other', async () => {
  // Một khe cho mỗi gate thì repo sau đè lên repo trước, và `done` chỉ thấy repo
  // cuối — bằng chứng của repo kia biến mất mà không ai biết.
  // Chạy gate thật qua `check`, không tự viết bản ghi rồi đọc lại — cách đó chỉ
  // chứng minh được JSON.parse chạy đúng.
  const root = makeRoot({ config: HAI_REPO, specText: spec().replace('Loại: fix', 'Loại: feature-s') });
  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'convention' });
  assert.equal(r.exitCode, 0, r.output);

  const doc = readGates(root, 'T-1');
  assert.ok(doc['convention@be'], 'bản ghi repo be còn');
  assert.ok(doc['convention@fe'], 'bản ghi repo fe còn');
  assert.equal(doc.convention, undefined, 'không có khe trần nào để repo sau đè lên');
});

test('CP-13-EC2 a single-repo record still reads back the old way', async () => {
  const root = makeRoot({
    config: { test: IN("ok 1 - T-1-H1 a'); console.log('ok 2 - T-1-H2 b") },
    specText: spec({ scope: 'src/' }),
    dirs: ['src'],
  });
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const doc = readGates(root, 'T-1');
  assert.ok(doc.test, 'khe không mang `@` khi chỉ có một repo');
  assert.equal(doc.test.repo, undefined, 'bản ghi cũ không có trường repo');
});

test('CP-13-S1 a record from one repo does not verify in another repo slot', async () => {
  // Chữ ký buộc theo repo: bản ghi của be đem sang khe fe thì lệch.
  const root = makeRoot({ config: HAI_REPO });
  const salt = getSalt(root);
  const rec = { gate: 'test', taskId: 'T-1', repo: 'be', exitCode: 0 };
  const signed = { ...rec, sig: signRecord(rec, salt) };
  const file = gatePath(root, 'T-1');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ 'test@fe': signed }, null, 2));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /chuyển từ gate khác|không thuộc slot này/);
});

test('CP-13-P3 a red first repo stops the run before the second', async () => {
  // Chạy tiếp chỉ tốn thời gian cho một kết quả đã đỏ.
  const root = makeRoot({
    config: { test: 'true', repos: { be: { test: DO }, fe: { test: IN('ok 1 - T-1-H2 frontend') } } },
  });
  await checkCommand({ cwd: root, taskId: 'T-1' });
  const log = readFileSync(path.join(root, '.compass', 'T-1', 'evidence', 'test.log'), 'utf8');
  assert.ok(!log.includes('frontend'), 'repo sau không được chạy khi repo trước đã đỏ');
});

test('CP-13-EC5 slotFor and parseSlot are inverses', () => {
  for (const [gate, repo] of [['test', null], ['test', 'be'], ['ui', 'fe-app']]) {
    const slot = slotFor(gate, repo);
    assert.deepEqual(parseSlot(slot), { gate, repo });
  }
});

test('CP-13-V3 the ui gate runs only in repos that declare a devUrl', async () => {
  // Backend không có trang nào để đo. Bỏ qua repo đó, đừng bắt nó khai devUrl
  // giả — thêm một quy ước phải nhớ là thêm một chỗ sai.
  const root = makeRoot({
    config: {
      test: 'true',
      repos: {
        be: { test: IN('ok 1 - T-1-H1 backend') },
        fe: { test: IN('ok 1 - T-1-H2 frontend'), dev: 'npm run dev', devUrl: 'http://127.0.0.1:59991/' },
      },
    },
    specText: spec({ ids: ['H1', 'H2'] }).replace('Loại: fix', 'Loại: feature-s'),
  });
  // Chạy `ui` thật. Không có hợp đồng thiết kế nên fe đo xong mà không cần dev
  // server — điều cần khẳng định là repo nào được đo, repo nào được bỏ qua.
  const r = await checkCommand({ cwd: root, taskId: 'T-1', only: 'ui' });
  assert.equal(r.exitCode, 0, r.output);
  const be = readGate(root, 'T-1', 'ui', 'be');
  assert.equal(be.skipped, true, 'be không khai devUrl nên bị bỏ qua');
  const fe = readGate(root, 'T-1', 'ui', 'fe');
  assert.notEqual(fe.skipped, true, 'fe khai devUrl nên được đo');
  assert.equal(fe.exitCode, 0);
  assert.equal(fe.measured, 0);
});

test('CP-13-EC3 no repo declaring devUrl means the browser gates are skipped, not failed', async () => {
  // Loại `fix` không bao giờ chạy ui/visual, nên "không FAILED" ở đó đúng sẵn.
  // feature-s đòi cả hai: bỏ qua phải để lại bản ghi theo từng repo.
  const root = makeRoot({ config: HAI_REPO, specText: spec().replace('Loại: fix', 'Loại: feature-s') });
  for (const only of ['ui', 'visual']) {
    const r = await checkCommand({ cwd: root, taskId: 'T-1', only });
    assert.equal(r.exitCode, 0, 'thiếu devUrl không phải lỗi');
    assert.doesNotMatch(r.output, /ui FAILED|visual FAILED/);
  }
  const doc = readGates(root, 'T-1');
  for (const slot of ['ui@be', 'ui@fe', 'visual@be', 'visual@fe']) {
    assert.equal(doc[slot]?.skipped, true, `${slot} phải có bản ghi bỏ qua`);
  }
  assert.equal(doc.ui, undefined, 'không có khe trần ui');
  assert.equal(doc.visual, undefined, 'không có khe trần visual');
});

test('CP-13-EC4 two checks in a row both pass', async () => {
  const root = makeRoot({ config: HAI_REPO });
  assert.equal((await checkCommand({ cwd: root, taskId: 'T-1' })).exitCode, 0);
  const lai = await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(lai.exitCode, 0, lai.output);
});

test('CP-13-S2 editing one repo after the check blocks done', async () => {
  // `sourceHash` băm cả cây. Sửa repo nào cũng làm bằng chứng cũ hết hiệu lực —
  // đó là điều đúng: gate đã chạy trên bản code khác.
  const root = makeRoot({ config: HAI_REPO });
  await checkCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0);

  writeFileSync(path.join(root, 'fe', 'src', 'moi.mjs'), 'export const x = 1;\n');
  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, 'sửa repo nào cũng phải chặn');
  assert.match(r.output, /Code đã thay đổi/);
});

test('CP-13-P1 repos run one after another, never at the same time', async () => {
  // Hai dev server tranh cổng là lỗi chập chờn đã tốn nhiều giờ ở CP-8. Mỗi repo
  // ghi mốc vào cùng một file; chồng lấn thì thứ tự sẽ đan xen.
  const root = makeRoot({ config: HAI_REPO });
  const dau = path.join(root, 'moc.txt').split('\\').join('/');
  const ghi = (ten) =>
    `node -e "const f='${dau}';const a=require('fs');a.appendFileSync(f,'${ten}-vao\\n');` +
    `const t=Date.now();while(Date.now()-t<120);a.appendFileSync(f,'${ten}-ra\\n');` +
    `console.log('ok 1 - T-1-${ten === 'be' ? 'H1' : 'H2'} x')"`;
  writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify({
    test: 'true', repos: { be: { test: ghi('be') }, fe: { test: ghi('fe') } },
  }, null, 2));

  await checkCommand({ cwd: root, taskId: 'T-1' });
  const moc = readFileSync(dau, 'utf8').trim().split('\n');
  assert.deepEqual(moc, ['be-vao', 'be-ra', 'fe-vao', 'fe-ra'],
    'repo sau chỉ bắt đầu khi repo trước đã xong');
});

test('CP-13-P2 a single-repo project pays nothing for the multi-repo path', async () => {
  // Dự án một repo không được chậm thêm vì tính năng nó không dùng.
  const root = makeRoot({
    config: { test: IN("ok 1 - T-1-H1 a'); console.log('ok 2 - T-1-H2 b") },
    specText: spec({ scope: 'src/' }),
    dirs: ['src'],
  });
  await withinBudgetAsync({
    run: () => checkCommand({ cwd: root, taskId: 'T-1' }),
    budgetMs: 10000,
    label: 'check một repo — quá lâu cho hai gate và một lệnh node',
  });
});

test('CP-13-S3 a bare `compass test` cannot overwrite multi-repo evidence with a green root run', async () => {
  // Chuỗi ba bước từng đóng được task với một repo chưa từng xanh:
  //   check  → fe đỏ, ghi bằng chứng đỏ
  //   test   → chạy lệnh chung ở gốc, xanh, ghi đè đúng khe đó
  //   done   → xanh, task đóng, dấu vết repo đỏ biến mất
  const root = makeRoot({
    config: {
      test: IN("ok 1 - T-1-H1 a'); console.log('ok 2 - T-1-H2 b"),
      repos: { be: { test: IN('ok 1 - T-1-H1 backend') }, fe: { test: DO } },
    },
  });

  assert.notEqual((await checkCommand({ cwd: root, taskId: 'T-1' })).exitCode, 0, 'fe đỏ');

  // Gọi như CLI gọi: không truyền `repos`.
  const donLe = testCommand({ cwd: root, taskId: 'T-1' });
  assert.notEqual(donLe.exitCode, 0, 'lệnh đơn lẻ phải chạy đúng những repo mà check chạy');
  assert.notEqual(doneCommand({ cwd: root, taskId: 'T-1' }).exitCode, 0, 'không được đóng');
});

test('CP-13-S4 a stale record in a repo slot is caught by the hash checks', async () => {
  // `soi` lọc bằng `parseSlot().gate` nhưng hai vòng hash lại so nguyên chuỗi
  // khe với danh sách tên gate — `test@be` thoát hết, và công của bộ lọc bị
  // vô hiệu.
  const root = makeRoot({ config: HAI_REPO });
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const rec = { gate: 'test', taskId: 'T-1', repo: 'be', exitCode: 0, sourceHash: 'MOC', configHash: 'MOC' };
  data['test@be'] = { ...rec, sig: signRecord(rec, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.equal(r.exitCode, 1, 'bản ghi mốc ở khe repo vẫn phải chặn');
  // Khẳng định đúng lý do: nhánh gate-đỏ cũng cho exit 1, nên chỉ so exit code
  // thì mutation bỏ soi hash vẫn sống sót.
  assert.match(r.output, /Code đã thay đổi sau khi gate "test@be"/);
  assert.match(r.output, /Lệnh test đã đổi kể từ khi gate "test@be"/);
});

test('CP-13-S5 the hint for a repo slot names a command that exists', async () => {
  // `compass test@be` không phải lệnh. Lệnh là tên gate.
  const root = makeRoot({ config: HAI_REPO });
  await checkCommand({ cwd: root, taskId: 'T-1' });

  const file = gatePath(root, 'T-1');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const salt = getSalt(root);
  const rec = { gate: 'convention', taskId: 'T-1', repo: 'be', exitCode: 1 };
  data['convention@be'] = { ...rec, sig: signRecord(rec, salt) };
  writeFileSync(file, JSON.stringify(data, null, 2));

  const r = doneCommand({ cwd: root, taskId: 'T-1' });
  assert.match(r.output, /compass convention T-1/);
  assert.doesNotMatch(r.output, /compass convention@be/, 'khe không phải tên lệnh');
});
