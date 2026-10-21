import { spawnSync } from 'node:child_process';

// Giết cả cây tiến trình bắt đầu từ `pid`, đồng bộ. Một chỗ cho cả tiến trình giám
// sát test của `compass pr` lẫn `runCommand` khi chính tiến trình giám sát chết
// (CP-81). `taskkill /t` tới được cả cây khi cha đã chết; trên POSIX cây nằm trong
// process group riêng, nên giết cả nhóm.
//
// dev-server.mjs có bản bất đồng bộ của cùng việc này, vì nó còn phải đợi tiến
// trình chết hẳn để trả cổng; bản đó giữ nguyên.
export function killTreeSync(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch { /* đã chết */ }
}
