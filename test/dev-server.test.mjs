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
