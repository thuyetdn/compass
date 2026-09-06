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

test('CP-8-E2 waitForUrl gives up after the timeout and says how long it waited', async () => {
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

test('CP-4-S2 isLocalUrl tells localhost apart from the open internet', () => {
  assert.equal(isLocalUrl('http://localhost:5173/'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:5173/'), true);
  assert.equal(isLocalUrl('http://[::1]:5173/'), true);
  assert.equal(isLocalUrl('https://example.com/'), false);
});

test('isLocalUrl treats a malformed url as not local', () => {
  assert.equal(isLocalUrl('not a url'), false);
});

test('CP-4-P2 stopping a dev server leaves no process behind', async () => {
  const { startDevServer } = await import('../lib/dev-server.mjs');
  // A server that would run forever if nobody killed it.
  const server = startDevServer('node -e "setInterval(() => {}, 1000)"', process.cwd());
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(server.exited, false, 'server phải đang chạy trước khi dừng');

  server.stop();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(server.exited, true, 'server phải chết sau khi stop');
});

test('CP-4-P3 stopping a server twice is harmless', async () => {
  const { startDevServer } = await import('../lib/dev-server.mjs');
  const server = startDevServer('node -e "setInterval(() => {}, 1000)"', process.cwd());
  await new Promise((resolve) => setTimeout(resolve, 300));
  server.stop();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  server.stop(); // must not throw
  assert.equal(server.exited, true);
});

test('CP-8-EC3 a shell that exits early still has its children killed', async () => {
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

test('CP-8-P1 stop resolves only after the process is gone', async () => {
  const { startDevServer } = await import('../lib/dev-server.mjs');
  const server = startDevServer('node -e "setInterval(() => {}, 1000)"', process.cwd());
  await new Promise((resolve) => setTimeout(resolve, 300));

  await server.stop();
  assert.equal(server.exited, true, 'stop trả về thì tiến trình phải chết rồi');
});

test('CP-8-H1 a server already up answers on the first probe', async () => {
  const server = createServer((req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const t0 = Date.now();
  const result = await waitForUrl(url, { timeoutMs: 3000, intervalMs: 500 });
  assert.equal(result.ok, true);
  assert.ok(Date.now() - t0 < 500, 'server sẵn sàng thì không được đợi hết một nhịp');
  server.close();
});

test('CP-8-H2 a server that comes up late is still waited for', async () => {
  const server = createServer((req, res) => { res.writeHead(200); res.end('ok'); });
  // Chọn cổng trước, mở sau: mô phỏng dev server mất một lúc mới lắng nghe.
  const tam = createServer(() => {});
  await new Promise((r) => tam.listen(0, '127.0.0.1', r));
  const port = tam.address().port;
  await new Promise((r) => tam.close(r));

  const url = `http://127.0.0.1:${port}/`;
  setTimeout(() => server.listen(port, '127.0.0.1'), 300);

  const result = await waitForUrl(url, { timeoutMs: 5000, intervalMs: 50 });
  assert.equal(result.ok, true, 'phải chờ được server lên muộn');
  server.close();
});

test('CP-8-V1 a 404 still means the server is up', async () => {
  // Dev server chưa build xong route vẫn trả 404 — nhưng nó đã lắng nghe, và
  // đó là thứ cần biết. Đòi 200 thì gate treo đợi một điều không xảy ra.
  const server = createServer((req, res) => { res.writeHead(404); res.end('not found'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const result = await waitForUrl(url, { timeoutMs: 3000, intervalMs: 50 });
  assert.equal(result.ok, true, '404 là server đã lên, không phải server chưa lên');
  server.close();
});

test('CP-8-EC1 a port just released is not mistaken for a live server', async () => {
  // Tiến trình trước vừa nhả cổng. Nếu waitForUrl tin vào cổng cũ thì gate đo
  // trang của lần chạy trước — đúng con bug INV-1.
  const cu = createServer((req, res) => { res.writeHead(200); res.end('cũ'); });
  await new Promise((r) => cu.listen(0, '127.0.0.1', r));
  const port = cu.address().port;
  await new Promise((r) => cu.close(r));

  const url = `http://127.0.0.1:${port}/`;
  const result = await waitForUrl(url, { timeoutMs: 600, intervalMs: 50 });
  assert.equal(result.ok, false, 'cổng đã nhả thì không có server nào ở đó');
  assert.match(result.reason, /không phản hồi/);
});
