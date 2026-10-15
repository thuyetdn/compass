# CP-62: Timing tests in Compass's own suite fail under CPU load, on code that is not slow
Loại: bug
Phạm vi: test/helpers/timing.mjs (mới), test/timing.test.mjs (mới), test/helpers/growth.mjs, test/query-outputs.test.mjs, test/dev-server.test.mjs, test/multi-repo-gates.test.mjs, test/multi-repo.test.mjs, test/growth.test.mjs, test/investigation-parser.test.mjs, test/knowledge-scan.test.mjs, test/secrets-scan.test.mjs, test/secrets-command.test.mjs, test/spec-parser.test.mjs, test/wording.test.mjs, test/review-brief-first-commit.test.mjs, test/review-brief-staged.test.mjs, test/rule-runner.test.mjs
Gốc soi: 4aba541

## Mục tiêu

Two tests failed today while several agents ran suites at the same time, and both passed when run
again. Neither failure is on disk (no `.compass/*/evidence/test.log` holds either line). The
failures were reported by the agents that saw them:

- `CP-4-P3 stopping a server twice is harmless` (`test/dev-server.test.mjs:58`). It calls
  `server.stop()` **without awaiting it**, sleeps a fixed 1200 ms, then asserts `server.exited`.
  `stop()` returns a promise that resolves only once the tree is dead (CP-8-P1 relies on that),
  so the sleep is a guess about how long `taskkill /t /f` takes. `CP-4-P2` (line 46) makes the
  same guess with 1500 ms.
- `CP-32-P1 parse cost stays linear in query count` (`test/query-outputs.test.mjs:283`) failed
  with "got 72.7x" against a limit of 64, then passed 3 of 3 alone. It takes **one sample per
  size**. The small sample is 400 queries, which parses in 2–4 ms and is clamped by
  `Math.max(…, 1)`. A stall of a few ms on the 6400-query sample is enough to read 72×. This is
  the CP-10 pitfall over again, in a test written after it.

Measured on this machine (12 logical CPUs, Node v24.19.0) with an instrumented copy of `test/`
in a scratch directory, each file run alone. "Idle" is 3 runs. "Loaded" means 24 busy-loop Node
processes running at once (2× the CPU count), with 1 to 5 runs per test. Only the timed region is
reported, not the fixture. The stop→exited and spawn→marker figures come from a probe script that
uses `lib/dev-server.mjs` the way the tests do (10 samples each).

| Test | What it times · method | Idle | Loaded | Limit | Verdict |
|---|---|---|---|---|---|
| CP-4-P2 | stop() unawaited, fixed sleep, then `exited` · single sample | stop→exited 120–493 ms | 1014–1502 ms | 1500 ms sleep | **can fail**: no margin under load |
| CP-4-P3 | same, sleep 1200 ms | same | same; 5 of 10 probes over 1200 | 1200 ms sleep | **failed today** |
| CP-8-H1 | first probe of a ready server · single sample | 2–4 ms | 4–218 ms | < 500 ms | **can fail**: 2.3× headroom |
| CP-32-P1 | parse 400 vs 6400 queries · single-sample ratio | 9.1–12.7× | 4.2–41.4× | < 64 | **failed today** (72.7×) |
| CP-42-P1 | `scanComponents` on one file · absolute | 1 ms | 14–134 ms | < 200 ms | **can fail**: one stall used 134 ms on a 1 ms operation |
| CP-52-P1 | `collectDiff`, 2000 files · absolute | 668–691 ms | 755–2918 ms | < 5 s | **can fail**: 1.7× headroom |
| CP-56-P1 | `check --only=convention`, 503 files · absolute | 116–185 ms | 1392–2145 ms | < 2 s | **failed 2 of 7 loaded runs** |
| CP-56-E1 | dev server must write its cwd marker before `devTimeoutMs: 500` expires and the tree is killed · race | spawn→marker 62–272 ms | 1146–1669 ms | 500 ms + kill latency | **can fail**: race, not seen in 12 loaded runs |
| CP-40-P2 | `secretsCommand` on this repo · absolute | 512–525 ms (whole test) | 1251–1795 ms | < 3 s | **can fail**: 1.7× headroom |
| CP-55-E1 | quadratic stub, 1 pair, must read ≥ 16; whole case < 5 s · single sample | ratio 48–96, large sample 1.2–1.6 s | ratio 112–136, large sample 1.9–2.3 s | ≥ 16, < 5 s | **can fail**: slowing the 16–30 ms small sample 3× drops the ratio below 16; about 2× headroom on the 5 s |
| CP-56-P3 | `done`, six slots, 500 files · absolute | 36–38 ms | 397–482 ms | < 2 s | low: 4.1× |
| CP-13-P2 | single-repo `check` · absolute | 399–466 ms | 558–2332 ms | < 10 s | low: 4.3× |
| CP-46-P1 | `collectDiff`, 200 staged · absolute | 276–360 ms | 271–329 ms | < 5 s | low |
| CP-40-P1 | `scanSecrets`, 20k lines · absolute | 32–36 ms | 37–47 ms | < 500 ms | low |
| CP-45-E1 · S1 · P1 | `parseInvestigation` ReDoS guards · absolute | 0 ms | 0–15 ms | 200 · 50 · 500 ms | low, but a 134 ms stall would fail S1 |
| CP-43-P1 | `readsEnv` × 2000 · absolute | 4–5 ms | 4–5 ms | < 200 ms | low |
| CP-39-P2 | `parseSpec`, 2000 lines · absolute | 1.1–1.4 ms | 1.2–1.7 ms | < 50 ms | low, same stall exposure as S1 |
| CP-39-P1 | wording scan · absolute | 17–29 ms (whole test) | not measured | < 500 ms | low |
| CP-3-S1 | catastrophic regex cut off · absolute | 1–7 ms | 2–9 ms | < 5 s | low |
| CP-10-P1 | already on the CP-55 harness (min of 5 pairs) | unchanged | — | 16 | accepted limit (CP-55) |
| CP-8-P1 · E2 · H2 · EC1 · EC3, CP-13-P1 | timeouts placed where load can only make the test stricter, or ordering without a clock | — | — | — | safe |

Synthetic CPU load did not reproduce today's two failures in 12 runs of each. That is consistent
with the mechanism. Concurrent suites create processes and do disk and git I/O, while busy loops
only take CPU, so `taskkill` and `node` startup are slowed less here than they were in the real
runs. The stop→exited and spawn→marker figures above show the margin is gone either way.

There are two failure shapes, and each gets its own fix.

1. **Growth-shaped → the CP-55 harness.** CP-32-P1 becomes `measureGrowth` + `assertLinear` with
   a `QUERY_GROWTH` constant next to `SCAN_GROWTH` in `test/helpers/growth.mjs`: `small: 3200,
   large: 25600, warmup: 1, pairs: 5, limit: 16`. Before timing, it asserts that each fixture
   parses to exactly 3200 and 25600 queries. Prototyped against HEAD:

   | Implementation | Verdicts (min of 5 pairs) | Small sample |
   |---|---|---|
   | HEAD, idle | 7.0 · 7.2 · 6.8 · 5.8 · 7.3 | 10–16 ms (over the 5 ms floor) |
   | HEAD, loaded | 6.6 · 6.6 · 6.6 · 7.0 · 5.9 | 21–45 ms |
   | Historical regression, 800→6400, idle | 47.6 · 50.2 · 49.9 | 13–15 ms |
   | Same, loaded | 50.3 · 46.8 | — |

   The historical regression is the one the comment at `lib/query-outputs.mjs:245` records:
   `lineStart` found with `lastIndexOf` back to the file start on every comment ("P1 caught it at
   154x"). The regression is timed at 800→6400 rather than 3200→25600, because its large sample
   at 25600 takes 12 s. The span is the same (8×), and the ratio does not depend on size once the
   quadratic term dominates (56.8 at 1600, 61.0 at 3200). The test costs about 0.65 s idle, up from 0.08 s.

2. **Absolute budgets → `test/helpers/timing.mjs`.** One shared rule replaces every raw
   `assert.ok(ms < N)`:
   - `withinBudget({ run, budgetMs, tries = 3, now })` (and `withinBudgetAsync` for promises)
     runs `run` up to `tries` times and returns on the **first try under budget**. It fails only
     when every try is over. Load has to slow all of the tries; a real regression slows each one.
   - A try at or above `max(10 × budgetMs, 2000 ms)` is not retried. A regression that costs
     minutes (CP-45's ReDoS) then fails after one try instead of three.
   - The budget comparison stays strict `<`, as today.
   - `withDeadline(promise, ms, label)` rejects with an error naming `label` and `ms` when the
     promise has not settled in time. It is the hang guard for tests whose point is "returns at
     all", not "returns fast".

   Per test:
   - **CP-4-P2, CP-4-P3**: the test awaits `stop()` instead of sleeping, inside
     `withDeadline(…, 20000)`. P3's body moves into a helper `stopTwice(server)`, so the CP-62
     cases can run it against broken servers. The 300 ms pre-stop wait and its `exited === false`
     check stay, because load cannot make a process exit on its own.
   - **CP-8-H1**: restated with `intervalMs: 5000, timeoutMs: 10000` and a budget of 2500 ms
     through `withinBudgetAsync`. Waiting one interval before the first probe costs ≥ 5000 ms,
     2× over the budget. The worst loaded first probe measured (218 ms) is 11× under it. Today a
     regression lands exactly on the 500 ms budget, and the loaded probe sits 2.3× under it.
   - **CP-56-P1**: the 2 s check could never tell one walk from two (CP-56's own spec: two root
     walks at f94ebdd took 116 ms). The `scanned` counts, 500 and 3 rather than 503, are what
     catch that regression, and they stay. Time becomes `withDeadline(checkCommand(…), 20000)`,
     9× over the worst loaded run.
   - **CP-56-E1**: `devTimeoutMs` goes from 500 to 3000. The server never listens, so the gate
     still fails with "Dev server không phản hồi" whatever the timeout. 3000 is 1.8× the worst
     loaded spawn→marker. The marker is read through a helper that fails with an `AssertionError`
     naming the marker path and `devTimeoutMs`, instead of a bare `ENOENT`. Cost: +2.5 s, because
     the case waits out the full timeout.
   - **CP-55-E1**: up to 3 attempts. The case passes on the first attempt where `assertLinear`
     throws and that attempt finished under 5 s. After 3 attempts it fails, listing each attempt's
     ratio and ms. A loaded small sample can no longer fail it alone. A harness that went blind to
     quadratic code fails all three attempts.
   - **Every other absolute budget** in the table goes through `withinBudget` /
     `withinBudgetAsync` with the number it has today: CP-42-P1, CP-52-P1, CP-40-P1, CP-40-P2,
     CP-43-P1, CP-39-P1, CP-39-P2, CP-45-E1, CP-45-S1, CP-45-P1, CP-46-P1, CP-56-P3, CP-13-P2,
     CP-3-S1. Several test names state their number ("under 200 ms", "under 5 s"), so the budget
     does not move. What changes is what it takes to fail: every try over the budget, instead of
     one stall.

Done means:
- No file matching `test/*.test.mjs` calls `Date.now()`, `performance.now()` or `process.hrtime`
  outside `test/helpers/`. The one allowance is the busy-wait inside CP-13-P1's child-process
  script string, which never touches a clock in the test process.
- Every fix is shown to still fail against a deliberately broken implementation (the E cases).

## Ràng buộc

- Only test code changes. `lib/`, `commands/`, `cli.mjs` and templates are untouched. No new
  dependency. `package.json`'s test glob is unchanged, and the new helper does not end in
  `.test.mjs`.
- **Every existing test name stays byte-identical.** Other tasks' evidence counts them by name.
  V2 checks the 21 tests this task edits: every row of the table from CP-4-P2 to CP-3-S1.
- `measureGrowth` and `assertLinear` keep their signatures and behaviour. CP-55's tests in
  `test/growth.test.mjs` other than E1 are not edited. `SCAN_GROWTH` is not changed.
- The helper's own decisions are tested with an injected clock (`now`), as CP-55 did. Real-clock
  cases are E3, E4, E5 and E6, and each finishes in under 3 s idle. E4 is the slowest at about
  0.75 s per attempt.
- E4 builds its regressed parser by copying `lib/query-outputs.mjs` to a temp directory and
  replacing one line. It must assert that the anchor line was found **exactly once** and that the
  written copy differs from the source, before timing anything. A replacement that silently does
  nothing is the CP-15 and CP-32 pitfall ("sed không thay được mà vẫn báo test xanh"). If the
  anchor disappears from `lib/`, E4 fails with that message; it never skips.
- Verification before `done`: run each touched test file alone 3 times idle and 3 times under
  24 busy-loop processes, before and after the change. Record each timed region in
  `.compass/CP-62/evidence/`, using the same probe method as the table above. The full suite's
  duration before and after is recorded too. The estimated net change is about +3.5 s: +2.5 s
  for CP-56-E1, +0.6 s for CP-32-P1, and about 2 s for the new real-clock cases, minus 1.1 s
  saved by CP-4-P2 and P3 no longer sleeping.
- Out of scope, and noted so nobody assumes they are covered:
  - `server.exited` reads `child.exitCode !== null`. A process killed by a POSIX signal keeps
    `exitCode` null, so CP-4-P2, CP-4-P3 and CP-8-P1 may already fail on Linux and macOS. This is
    unverified, because this machine is Windows, and it belongs to its own task in `lib/`.
  - The `freePort()` pick-then-close pattern can lose its port to another process between close
    and reuse when suites run concurrently. That is a concurrency hazard, not a timing one.
  - CP-3-S1's second assertion, `violations.length >= 0`, is always true.

## Rủi ro hồi quy

- **Retrying hides a real regression that is intermittent.** `withinBudget` passes on any single
  try under budget. A regression that is slow only sometimes (a cache that misses one time in
  three) can pass. This bias is chosen deliberately, as in CP-55: a false pass is caught by a
  later run, while a false failure blocks `done` for everyone. Every regression the inventory
  guards against (ReDoS, quadratic loops, per-file spawns, hangs) is slow on every try. E1 and E3
  pin that case.
- **A retry multiplies the cost of a broken implementation.** Three tries of a ReDoS that takes
  minutes would take three times as long. The no-retry threshold, `max(10 × budget, 2 s)`, stops
  that, and E2 pins it.
- **CP-56-P1 loses its clock.** After this task it says nothing about speed short of a 20 s hang.
  That is a fair description of what it measured before (116 ms vs 2000 ms), but a reader of its
  name might assume a speed check. The `scanned` counts remain its regression guard.
- **CP-8-H1's longer interval** means a regression costs that test 3 × 5 s before it fails. It is
  only slow when broken. E6 runs the same helper at a 400 ms interval to show the failure cheaply.
- **CP-56-E1 now waits 3 s.** A later edit that lowers `devTimeoutMs` "for speed" reopens the
  race. A comment next to the value must cite the loaded spawn→marker figure.
- **CP-32-P1's coverage moves to larger inputs** (3200→25600). A regression that is quadratic
  only below 3200 queries would not show. The historical one shows at every size measured.
- **CP-55-E1 changes behaviour inside another task's file.** Its name, sizes, limit and pair
  count stay. Only the attempt loop and where the 5 s is checked change. CP-55's other cases must
  stay green and unedited.
- **The static guard (V2) can be dodged.** A test that times through a differently named clock
  (`process.uptime()`, a `perf_hooks` alias) gets past it. It is a tripwire for the shapes found
  today, not a proof.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `withinBudget` with an injected clock: first try takes 3 ms, budget 200 ms, `tries: 3` | returns; `run` was called exactly once; the result lists one try of 3 ms | P0 |
| H2 | Happy | `withDeadline(Promise.resolve(42), 1000, 'x')` and a promise resolving after 20 ms | both resolve to their value; no timer is left pending (the test process exits without waiting 1 s) | P1 |
| H3 | Happy | `stopTwice` against a stub server whose `stop()` resolves after 30 ms and sets `exited` | resolves; `stop` called twice; `exited` true after each call | P1 |
| V1 | Validation | `withinBudget` with `budgetMs` 0, -5, `NaN`; `tries` 0, 1.5; `run` not a function | each throws an error naming the bad argument; `run` is never called | P1 |
| V2 | Validation | Scan every `test/*.test.mjs` file at HEAD of the change | no `Date.now()`, `performance.now()` or `process.hrtime` outside `test/helpers/`, except inside CP-13-P1's child script string; each of the 21 edited test names (table rows CP-4-P2 … CP-3-S1) appears exactly once, byte-identical to a369838 | P0 |
| V3 | Validation | `withDeadline` with `ms` 0 or negative | throws an error naming `ms`; the promise passed in is not awaited | P2 |
| E1 | Error | `withinBudget`, injected clock: every try takes 250 ms, budget 200 ms, `tries: 3` | throws `AssertionError`; message contains "200" and all three "250"; `run` called 3 times | P0 |
| E2 | Error | `withinBudget`, injected clock: first try 2500 ms, budget 200 ms (over `max(10 × 200, 2000)`) | throws after **one** call to `run`; message contains "2500" and says it was not retried | P0 |
| E3 | Error | Real clock: `run` busy-waits 30 ms, budget 10 ms, `tries: 3` | throws `AssertionError`; each recorded try is ≥ 30 ms; finishes in under 1 s | P0 |
| E4 | Error | Real clock: a copy of `lib/query-outputs.mjs` in a temp dir with `const before = text.slice(lineStart, i);` replaced by a slice from `max(lastIndexOf(LF, i), lastIndexOf(CR, i)) + 1` (the historical regression); `measureGrowth` at 800→6400, 1 pair, no warm-up, up to 3 attempts, limit `QUERY_GROWTH.limit` | before timing: anchor found exactly once, copy differs from source, copy parses 800 queries; then `assertLinear` throws an `AssertionError` containing "bậc hai" in some attempt (measured 47–50, limit 16) | P0 |
| E5 | Error | `stopTwice` against three broken stubs: (a) `stop()` resolves but `exited` stays false; (b) second `stop()` rejects with `new Error('lần hai')`; (c) `stop()` never resolves, deadline 300 ms | (a) rejects with an assertion naming `exited`; (b) rejects with that same error; (c) rejects with an error containing "300"; all three in under 2 s total | P0 |
| E6 | Error | CP-8-H1's helper against a stub `waitForUrl` that sleeps `intervalMs` before its first probe, at `intervalMs: 400`, budget 200 ms, 3 tries; and against a stub that probes at once | the sleeping stub fails with `AssertionError` listing three tries ≥ 400 ms; the immediate stub passes | P0 |
| E7 | Error | CP-55-E1's attempt loop fed three injected results that read linear (ratio 7.0 each) | fails after 3 attempts; message lists the three ratios; it never reports the stub as caught | P0 |
| EC1 | Edge | `withinBudget`, injected clock: first try 600 ms (3× budget, under the no-retry line), second try 3 ms, budget 200 ms | returns on try 2; `run` called twice — one stall does not fail it | P0 |
| EC2 | Edge | `withinBudget`, injected clock: every try exactly 200 ms, budget 200 ms | throws — the budget is strict `<`, matching today's assertions | P1 |
| EC3 | Edge | `withinBudgetAsync` where `run` rejects with `new Error('fixture hỏng')` on try 1 | rejects with that same error after one call; it is not retried or reported as a timing failure | P1 |
| EC4 | Edge | CP-56-E1's marker helper pointed at a path that does not exist, with `devTimeoutMs` 3000 | throws `AssertionError` whose message contains the path and "3000"; not `ENOENT` | P1 |
| EC5 | Edge | CP-55-E1's attempt loop fed results 12.0 (small sample loaded) then 48.0, each attempt under 5 s | passes on attempt 2; a third attempt is not run | P1 |
| EC6 | Edge | CP-55-E1's attempt loop fed 48.0 but with an attempt time of 5200 ms, then 48.0 in 900 ms | attempt 1 does not count (over 5 s); passes on attempt 2 | P2 |
