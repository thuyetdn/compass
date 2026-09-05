import { spawn } from 'node:child_process';

// Killing a dev server means killing the shell it was spawned through and every
// child under it. A stray server holds its port, and the next run hangs waiting
// for a page that belongs to the previous one.
// `npm run dev` is three processes deep — a shell, npm, then the server — and
// the shell exits as soon as it has handed off. Checking `child.exitCode` and
// returning would then skip the kill entirely while the server keeps the port,
// which is how a gate left a dev server running and the next gate found the
// port taken.
async function killTree(child) {
  if (!child) return;

  const exited = child.exitCode !== null;

  try {
    if (process.platform === 'win32') {
      // /t reaches the whole tree even when the shell above it is already gone.
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
        killer.on('exit', resolve);
        killer.on('error', resolve);
      });
    } else if (!exited) {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }

  if (exited) return;

  // Returning before the process is reaped lets the next gate bind a port this
  // one still holds.
  await new Promise((resolve) => {
    if (child.exitCode !== null) { resolve(); return; }
    const timer = setTimeout(resolve, 5000); // never hang a gate on a stuck kill
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

export function isLocalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export async function waitForUrl(url, { timeoutMs = 30000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      // Any answer proves the server is listening — a 404 is still an answer.
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return { ok: true };
    } catch {
      if (Date.now() >= deadline) {
        return { ok: false, reason: `không phản hồi sau ${timeoutMs}ms` };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

export function startDevServer(command, cwd) {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', // own process group, so the whole tree dies together
  });

  let output = '';
  child.stdout?.on('data', (chunk) => { output += chunk; });
  child.stderr?.on('data', (chunk) => { output += chunk; });

  return {
    stop: () => killTree(child),
    get output() { return output; },
    get exited() { return child.exitCode !== null; },
  };
}
