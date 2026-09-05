import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { waitForUrl, isLocalUrl } from '../lib/dev-server.mjs';

test('waitForUrl returns as soon as the url answers', async () => {
  const server = createServer((req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const result = await waitForUrl(url, { timeoutMs: 3000, intervalMs: 50 });
  assert.equal(result.ok, true);

  server.close();
});

test('E2 waitForUrl gives up after the timeout and says how long it waited', async () => {
  // Port 1 is privileged and nothing listens there.
  const result = await waitForUrl('http://127.0.0.1:1/', { timeoutMs: 300, intervalMs: 50 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /300/);
});

test('waitForUrl accepts any response, even a 404 — the server is up either way', async () => {
  const server = createServer((req, res) => { res.writeHead(404); res.end('nope'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const result = await waitForUrl(url, { timeoutMs: 3000, intervalMs: 50 });
  assert.equal(result.ok, true);

  server.close();
});

test('S2 isLocalUrl tells localhost apart from the open internet', () => {
  assert.equal(isLocalUrl('http://localhost:5173/'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:5173/'), true);
  assert.equal(isLocalUrl('http://[::1]:5173/'), true);
  assert.equal(isLocalUrl('https://example.com/'), false);
});

test('isLocalUrl treats a malformed url as not local', () => {
  assert.equal(isLocalUrl('not a url'), false);
});

test('P2 stopping a dev server leaves no process behind', async () => {
  const { startDevServer } = await import('../lib/dev-server.mjs');
  // A server that would run forever if nobody killed it.
  const server = startDevServer('node -e "setInterval(() => {}, 1000)"', process.cwd());
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(server.exited, false, 'server phải đang chạy trước khi dừng');

  server.stop();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(server.exited, true, 'server phải chết sau khi stop');
});

test('P2 stopping a server twice is harmless', async () => {
  const { startDevServer } = await import('../lib/dev-server.mjs');
  const server = startDevServer('node -e "setInterval(() => {}, 1000)"', process.cwd());
  await new Promise((resolve) => setTimeout(resolve, 300));
  server.stop();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  server.stop(); // must not throw
  assert.equal(server.exited, true);
});

test('EC3 a shell that exits early still has its children killed', async () => {
  const { startDevServer } = await import('../lib/dev-server.mjs');
  const { createServer } = await import('node:http');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;

  // A server whose launching shell goes away while it keeps the port: the
  // shape npm run dev has, and the one killTree used to skip.
  const dir = mkdtempSync(path.join(tmpdir(), 'compass-kill-'));
  const script = path.join(dir, 'server.js');
  writeFileSync(script, `
    const { createServer } = require('node:http');
    createServer((req, res) => { res.writeHead(200); res.end('ok'); }).listen(0, '127.0.0.1', function () {
      console.log('PORT=' + this.address().port);
    });
  `);

  const server = startDevServer(`node "${script}"`, dir);
  const port = await new Promise((resolve) => {
    const timer = setInterval(() => {
      const found = server.output.match(/PORT=(\d+)/);
      if (found) { clearInterval(timer); resolve(Number(found[1])); }
    }, 50);
  });

  const url = `http://127.0.0.1:${port}/`;
  assert.equal((await waitForUrl(url, { timeoutMs: 5000 })).ok, true, 'server phải lên trước đã');

  await server.stop();

  // stop() must not return until the port is actually free.
  const stillUp = await waitForUrl(url, { timeoutMs: 400, intervalMs: 100 });
  assert.equal(stillUp.ok, false, 'cổng phải được nhả ngay khi stop trả về');
});

test('P1 stop resolves only after the process is gone', async () => {
  const { startDevServer } = await import('../lib/dev-server.mjs');
  const server = startDevServer('node -e "setInterval(() => {}, 1000)"', process.cwd());
  await new Promise((resolve) => setTimeout(resolve, 300));

  await server.stop();
  assert.equal(server.exited, true, 'stop trả về thì tiến trình phải chết rồi');
});
