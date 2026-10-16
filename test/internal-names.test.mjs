import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// CP-74 — repo từng dùng tên nội bộ của nơi chủ dự án làm việc làm ví dụ: tên
// repo, tên bảng database, một địa chỉ email công việc. Đã thay bằng tên trung
// tính. Test này canh cho chúng đừng quay lại.
//
// Nó không được tự viết ra các tên đó, vì chính nó cũng public. Nên ở đây chỉ
// có SHA-256 của từng tên: test băm từng từ trong mọi file git đang theo dõi
// rồi so. Gặp lại thì báo file và mã băm, người sửa tự biết đó là tên nào.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Một từ: chỉ chữ và số, so sau khi hạ chữ thường.
const WORDS = new Set([
  'f5cfcb570b7edac2ed16e1a025d50155d6148de7397f4068790cdfc142300070',
  'f19a583e9b509ddd3a1715f898d6486666fffc0ae3d6788c3495d7c0d6754c20',
  '2e28195cc1331b71c85b21f07011f928167bdc28f10a51e152d519b757b67858',
  '1bd9dfcdc58ee39256bc519e0290d670eae5767d6e2c7aafb2d719803bd51677',
  'eca379ede2241e98065627731de817e684fd3827f18f314d7ed6abf92c67ad7d',
  'd648bff4244973869ee2e0d43d4ad56251edcd26a4b22d43f846c817dbe9de61',
  '649879a2ac5987eba4c7f2242efb14b2f8c407a1d3fc21993f29e10b6196f811',
]);

// Cụm có gạch nối: so nguyên cụm, vì từng mảnh của nó là từ thông thường.
const PHRASES = new Set([
  '4a09d65e4ef4870d6088e309dffc735e749c58afcea681872fc5906410f781ea',
  'dc97c3299c4aa245f569d282db8ccf754a5217b18ec0c3e97b69117f6f0143ee',
]);

const sha = (s) => createHash('sha256').update(s).digest('hex');

function trackedText() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const out = [];
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      continue; // còn trong index nhưng đã xóa khỏi đĩa
    }
    if (text.includes('\0')) continue; // file nhị phân
    out.push({ rel, text: text.toLowerCase() });
  }
  return out;
}

function findBanned(text) {
  const hits = new Set();
  for (const word of text.split(/[^a-z0-9]+/)) {
    if (word && WORDS.has(sha(word))) hits.add(sha(word).slice(0, 12));
  }
  for (const m of text.matchAll(/[a-z0-9]+(?:-[a-z0-9]+)+/g)) {
    // Cụm dài như a-b-c chứa cụm ngắn b-c: thử mọi đoạn liền nhau từ hai mảnh.
    const parts = m[0].split('-');
    for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 2; j <= parts.length; j += 1) {
        const phrase = parts.slice(i, j).join('-');
        if (PHRASES.has(sha(phrase))) hits.add(sha(phrase).slice(0, 12));
      }
    }
  }
  return [...hits];
}

test('CP-74-H1 no tracked file names the internal projects again', () => {
  const found = [];
  for (const { rel, text } of trackedText()) {
    const hits = findBanned(text);
    if (hits.length) found.push(`${rel}: ${hits.join(', ')}`);
  }
  assert.deepEqual(found, [], `tên nội bộ quay lại (12 ký tự đầu của mã băm):\n${found.join('\n')}`);
});

test('CP-74-E1 the guard catches a name in a sentence, in a path and inside a longer phrase', () => {
  // Tên thật không được viết ra, nên kiểm cơ chế bằng một từ thử thêm tạm vào
  // từ điển: một từ bị cấm phải bị bắt ở mọi vị trí nó hay xuất hiện.
  WORDS.add(sha('probeword'));
  PHRASES.add(sha('probe-phrase'));
  try {
    assert.equal(findBanned('see probeword.').length, 1, 'trong câu văn');
    assert.equal(findBanned('src/probeword/controller.ts').length, 1, 'trong đường dẫn');
    assert.equal(findBanned('x-probe-phrase-y').length, 1, 'cụm nằm trong cụm dài hơn');
    assert.equal(findBanned('probe phrase').length, 0, 'hai từ rời không phải cụm');
  } finally {
    WORDS.delete(sha('probeword'));
    PHRASES.delete(sha('probe-phrase'));
  }
});

test('CP-74-V1 the work-address mailmap is gone', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  assert.ok(!files.includes('.mailmap'), '.mailmap ghi địa chỉ công việc thành một dòng riêng');
});

test('CP-74-H2 the investigation scripts whose SQL was renamed still run', () => {
  // Bốn script CP-32 dựng lại lỗi của trình đọc `@out:` bằng SQL mẫu. Đổi tên
  // bảng và alias không được làm chúng ném lỗi hay đổi mã thoát.
  for (const name of ['cp32-verify-round8.mjs', 'cp32-verify-round9.mjs', 'cp32-verify-round10.mjs', 'cp32-verify-round11.mjs']) {
    const script = path.join(ROOT, '.compass', 'scripts', name);
    execFileSync(process.execPath, [script], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  }
});

test('CP-74-H3 the SKILL.md SQL example still declares an output for every query', async () => {
  const { parseQueryOutputs } = await import('../lib/query-outputs.mjs');
  const skill = readFileSync(path.join(ROOT, 'skills', 'compass', 'SKILL.md'), 'utf8');
  const block = skill.match(/```sql\n([\s\S]*?)```/);
  assert.ok(block, 'SKILL.md không còn khối ```sql');
  assert.match(block[1], /from orders/);
  assert.match(block[1], /from customers/);

  const parsed = parseQueryOutputs(block[1], 'INV-4');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.queries.length, 2);
  assert.equal(parsed.queries[0].out, 'INV-4-q0-status-dist-0908.csv');
  assert.equal(parsed.queries[1].manual, true);
});

test('CP-74-V2 writing-vi.md keeps its 56 pairs after the rename', () => {
  const guide = readFileSync(path.join(ROOT, 'skills', 'compass', 'references', 'writing-vi.md'), 'utf8');
  assert.equal((guide.match(/^> ❌/gmu) ?? []).length, 56);
});

test('CP-74-EC1 the nested-repo fixtures are still two levels deep', () => {
  const detect = readFileSync(path.join(ROOT, 'test', 'repo-detect.test.mjs'), 'utf8');
  assert.match(detect, /path\.join\('store', 'backend'\)/, 'fixture hai cấp của CP-66-H6 phải còn');
  assert.match(detect, /'store\/backend'/, 'key phải là đường dẫn hai cấp');
});
