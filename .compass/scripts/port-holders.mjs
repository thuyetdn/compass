// Liệt kê tiến trình đang giữ một cổng — dùng khi nghi gate để sót dev server
//
// Chạy:  node .compass/scripts/port-holders.mjs 5173
// Env:   không cần
// Dùng lần cuối: 2026-09-05 (INV-1)

import { execFileSync } from 'node:child_process';

const port = process.argv[2] ?? '5173';
const isWindows = process.platform === 'win32';

const lines = isWindows
  ? execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
      .split('\n').filter((l) => l.includes(`:${port}`) && l.includes('LISTENING'))
  : execFileSync('lsof', ['-i', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n');

console.log(lines.length ? lines.join('\n') : `Không ai giữ cổng ${port}`);
