import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { statusCommand } from '../commands/status.mjs';

const SPEC = `# T-1: Tiêu đề
Loại: fix
Phạm vi: src/

## Mục tiêu
Làm gì đó.

## Ràng buộc
Không có.

## Rủi ro hồi quy
Không có.

## Test cases
| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Case một | Đúng | P0 |
| H2 | Happy | Case hai | Đúng | P0 |
`;

// `config` là object thô ghi thẳng vào config.json. `repoDirs` là những thư mục
// con cần tạo thật — `resolveRepos` kiểm thư mục có tồn tại không, nên khai một
// repo mà không tạo thư mục là cách dựng ca lỗi.
function duAn(config, repoDirs = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-status-'));
  mkdirSync(path.join(root, '.compass'), { recursive: true });
  if (config !== null) {
    writeFileSync(path.join(root, '.compass', 'config.json'), JSON.stringify(config));
  }
  for (const d of repoDirs) mkdirSync(path.join(root, d), { recursive: true });
  return root;
}

function taoTask(root, id = 'T-1') {
  mkdirSync(path.join(root, '.compass', id, 'evidence'), { recursive: true });
  writeFileSync(path.join(root, '.compass', id, 'spec.md'), SPEC);
}

test('CP-22-H1 status không id liệt kê đủ repo kèm lệnh test từng cái', () => {
  const root = duAn({
    test: 'npm test',
    repos: {
      backend: { test: 'yarn test' },
      frontend: { test: 'pnpm test' },
      admin: { test: 'npm run test:ci' },
    },
  }, ['backend', 'frontend', 'admin']);

  const result = statusCommand({ cwd: root, taskId: undefined });
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.exitCode, 0);
  for (const ten of ['backend', 'frontend', 'admin']) {
    assert.match(result.output, new RegExp(ten), `thiếu repo ${ten}`);
  }
  // Tên repo mà không có lệnh test thì không kiểm được config — đó là thứ duy
  // nhất bắt buộc phải đúng ở mỗi repo.
  assert.match(result.output, /yarn test/);
  assert.match(result.output, /pnpm test/);
  assert.match(result.output, /npm run test:ci/);
});

test('CP-22-H2 status không id chạy được với dự án một repo không khai repos', () => {
  const root = duAn({ test: 'npm test' });

  const result = statusCommand({ cwd: root, taskId: undefined });
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /npm test/);
  // Không được đòi khai `repos` — dự án một repo là trường hợp thường gặp nhất.
  assert.doesNotMatch(result.output, /thiếu.*repos/i);
});

test('CP-22-V1 status có id giữ nguyên đầu ra cũ', () => {
  const root = duAn({ test: 'npm test' });
  taoTask(root);

  const result = statusCommand({ cwd: root, taskId: 'T-1' });
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /Task T-1/);
  assert.match(result.output, /Loại: fix/);
  assert.match(result.output, /Trạng thái: đang mở/);
  // Nhánh cấu hình không được lấn sang nhánh task.
  assert.doesNotMatch(result.output, /Gốc Compass:/);
});

test('CP-22-E1 status không id, chưa có config, báo rõ và không ném', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compass-status-'));

  const result = statusCommand({ cwd: root, taskId: undefined });
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Không tìm thấy \.compass\/config\.json/);
  // Stack trace lọt ra là dấu hiệu lỗi chưa được bắt — đúng lúc người dùng cần
  // câu trả lời rõ nhất thì lại nhận thứ khó đọc nhất.
  assert.doesNotMatch(result.output, /at .*\.mjs:\d+/);
});

test('CP-22-E2 status không id, repo trỏ vào thư mục không có, nêu tên repo', () => {
  const root = duAn({
    test: 'npm test',
    repos: { backend: { test: 'yarn test' }, khong_ton_tai: { test: 'npm test' } },
  }, ['backend']);

  const result = statusCommand({ cwd: root, taskId: undefined });
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.exitCode, 2);
  assert.match(result.output, /khong_ton_tai/);
  assert.doesNotMatch(result.output, /at .*\.mjs:\d+/);
});

test('CP-22-EC1 chỉ repo có khai devUrl mới hiện devUrl', () => {
  const root = duAn({
    test: 'npm test',
    repos: {
      backend: { test: 'yarn test' },
      frontend: { test: 'pnpm test', dev: 'pnpm dev', devUrl: 'http://localhost:5173/' },
    },
  }, ['backend', 'frontend']);

  const result = statusCommand({ cwd: root, taskId: undefined });
  rmSync(root, { recursive: true, force: true });

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /localhost:5173/);

  // Kiểm theo dòng, không kiểm cả chuỗi: `devUrl` xuất hiện đâu đó trong output
  // không nói được nó thuộc repo nào. Backend mà dính devUrl thì `ui`/`visual`
  // sẽ chạy oan rồi đỏ vì không có trang nào.
  const dong = result.output.split('\n');
  const iBackend = dong.findIndex((l) => /^\s+backend\s*$/.test(l));
  const iFrontend = dong.findIndex((l) => /^\s+frontend\s*$/.test(l));
  assert.notEqual(iBackend, -1, 'không thấy dòng repo backend');
  assert.notEqual(iFrontend, -1, 'không thấy dòng repo frontend');

  const khoiBackend = dong.slice(iBackend, iFrontend > iBackend ? iFrontend : dong.length);
  assert.ok(
    !khoiBackend.some((l) => /devUrl/.test(l)),
    `backend không khai devUrl nhưng output có: ${khoiBackend.join(' | ')}`
  );
});
