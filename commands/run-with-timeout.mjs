// Chạy một lệnh shell và dừng CẢ cây tiến trình của nó khi quá hạn. `runCommand`
// trong lib/test-runner.mjs gọi file này qua `spawnSync` khi có `timeoutMs`.
//
// Vì sao cần một tiến trình giữa: `spawnSync(..., { shell: true, timeout })` chỉ
// giết được shell. Tiến trình test thật bên dưới (npm, rồi node) chạy tiếp code
// của người viết PR sau khi Compass đã báo "đã dừng" — lần soi thứ bảy của CP-81
// thấy node.exe vẫn sống sau khi hết giờ. Ở đây lệnh được spawn bất đồng bộ, nên
// khi hết giờ còn kịp gọi `taskkill /t` (Windows) hay giết cả process group
// (POSIX) trong lúc shell còn sống và cây còn nối với nó.
//
//   node run-with-timeout.mjs <timeoutMs> <lệnh> [file-pid]
//
// Output của lệnh đi thẳng qua stdout và stderr. Hết giờ thì dòng cuối của stderr
// là TIMEOUT_MARK và mã thoát là 124.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { TIMEOUT_MARK } from '../lib/test-runner.mjs';
import { killTreeSync } from '../lib/process-tree.mjs';

// Dưới hẳn bộ đệm 32 MB của `runCommand`, kể cả khi cộng stdout với stderr.
const OUTPUT_LIMIT = 12 * 1024 * 1024;

function main() {
  const timeoutMs = Number(process.argv[2]);
  const command = process.argv[3];
  const pidFile = process.argv[4] || null;
  const nonce = process.argv[5] ?? '';
  const child = spawn(command, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX: process group riêng, để giết cả nhóm bằng `kill(-pid)`.
    detached: process.platform !== 'win32',
  });

  // Chuyển output đi, nhưng không quá OUTPUT_LIMIT. Quá bộ đệm của `spawnSync` bên
  // gọi thì chính tiến trình này bị giết, và trên Windows cây lệnh mất cha trước
  // khi ai kịp dọn: `taskkill /t` không còn lần ra node bên dưới (lần soi thứ mười
  // của CP-81). Phần thừa vẫn được đọc hết để lệnh không kẹt vì pipe đầy.
  let sent = 0;
  let cut = false;
  const relay = (to) => (chunk) => {
    if (sent >= OUTPUT_LIMIT) { cut = true; return; }
    const part = chunk.subarray(0, OUTPUT_LIMIT - sent);
    sent += part.length;
    if (part.length < chunk.length) cut = true;
    to.write(part);
  };
  child.stdout.on('data', relay(process.stdout));
  child.stderr.on('data', relay(process.stderr));
  // Báo pid của lệnh cho `runCommand` qua một file: tiến trình này có thể bị giết từ
  // ngoài mà không kịp dọn (vượt bộ đệm 32 MB, quá lưới 30 giây); khi đó bên gọi dọn
  // cây theo pid này (lần soi thứ mười của CP-81). Không qua stderr: tràn bộ đệm thì
  // `spawnSync` trả stderr rỗng.
  if (pidFile) {
    try { writeFileSync(pidFile, String(child.pid)); } catch { /* bên gọi không dọn được thì thôi */ }
  }

  const killTree = () => killTreeSync(child.pid);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree();
  }, timeoutMs);

  // Ctrl-C hay một tín hiệu dừng tới tiến trình này thì cây lệnh phải chết theo.
  // Trên POSIX cây nằm ở process group riêng (`detached`), nên Ctrl-C của terminal
  // không tới được nó; không bắt tín hiệu ở đây thì tiến trình này chết, đồng hồ
  // chết theo, và test của PR chạy tiếp không giờ dừng (lần soi thứ tám của CP-81).
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      clearTimeout(timer);
      killTree();
      process.exitCode = 130;
      process.stderr.write(`\nĐã dừng lệnh vì nhận ${sig}.\n`);
      // Thường cây chết ngay và sự kiện `exit` kết thúc tiến trình; nếu không, thoát sau 2 giây.
      setTimeout(() => process.exit(130), 2000).unref();
    });
  }

  child.on('error', (err) => {
    clearTimeout(timer);
    process.stderr.write(`Lỗi khi chạy lệnh: ${err.message}\n`);
    process.exitCode = 1;
  });
  // `close` chứ không `exit`: đợi pipe output đổ hết rồi mới viết dòng cuối.
  child.on('close', (code) => {
    clearTimeout(timer);
    if (cut) process.stderr.write(`\n(Output dài hơn ${OUTPUT_LIMIT / 1024 / 1024} MB, phần sau bị cắt.)\n`);
    if (timedOut) {
      process.stderr.write(`\n${TIMEOUT_MARK}-${nonce}\n`);
      process.exitCode = 124;
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && process.argv[1].endsWith('run-with-timeout.mjs')) main();
