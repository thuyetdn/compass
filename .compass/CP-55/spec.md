# CP-55: The growth test for the knowledge scan fails under CPU load, and still misses the quadratic code it was written for
Loại: bug
Phạm vi: test/helpers/growth.mjs (mới), test/growth.test.mjs (mới), test/knowledge-command.test.mjs, .knowledge/decided/pitfalls.md
Gốc soi: f94ebdd

## Mục tiêu

`CP-10-P1 the scan grows with the file count, not its square` (`test/knowledge-command.test.mjs:238`)
already measures a ratio, not an absolute budget. It times `knowledgeCommand({ sync: true })` once
on 500 files and once on 2000 files with `Date.now()`, and asserts `do2 / max(do1, 1) < 8`. The
failing run is on disk: `.compass/CP-5/evidence/test.log:1089-1090`, "gấp 4 lần file làm thời gian
gấp 8.7 lần — bậc hai", in a test that took 4030.8 ms, while two other agents were using the CPU.
The code under test was linear.

Measured on this machine (12 logical CPUs, Node v24.19.0, idle) with throwaway scripts outside the
repo. "Quadratic copy" is `lib/` with the `usedIn` pass put back into the component × file nesting
that CP-10's pitfall describes ("bỏ được thừa số đắt nhưng giữ vòng lồng"):

| What | Ratios, one per repeat | Verdict under `< 8` |
|---|---|---|
| HEAD, `knowledge --sync`, 500→2000, today's method (one sample per size) | 3.07 · 3.22 · 3.12 · 3.43 · 3.50 | pass |
| Quadratic copy, same | 8.05 · 8.59 · 6.54 · 6.84 · 5.74 | **caught 2 of 5** |
| HEAD, 500→4000 | 7.12 · 8.45 · 10.60 | — |
| Quadratic copy, 500→4000 | 22.47 · 39.43 · 36.50 | — |

Both failures are visible in that table:

- **It flakes on linear code.** HEAD reads about 3.3, so `< 8` holds only while the 2000-file run
  is slowed by less than about 2.4× *relative to the 500-file run*. One sample per size means one
  burst of load on the second run is enough. 8.7 is that burst.
- **It does not reliably catch the regression it exists for.** At 500→2000 the quadratic copy's
  linear part (walking, reading, writing JSON, hashing the manifest) is still most of the cost, so
  its ratio straddles 8. The test comment says the same code gave 6.8 at this scale, under 8.

Durations alone say little: the 40 runs of this test recorded in `.compass/*/evidence/test.log`
range from 2475 ms to 8372 ms (median 3074 ms), all green but one. Run alone with
`--test-name-pattern` three times today: 1954, 1500, 1549 ms.

The proposed method, prototyped against the same two implementations (3 runs of HEAD and 2 of the
quadratic copy per row): one discarded warm-up per size, then interleaved pairs (500, 4000, 500, 4000, …),
with the verdict taken as the **smallest ratio among pairs**, each pair being a large sample divided
by the small sample taken just before it:

| Timed region | HEAD verdicts | Quadratic copy verdicts |
|---|---|---|
| whole `knowledge --sync` | 7.6 · 6.4 · 7.9 | 19.4 · 23.5 |
| `scanComponents(root)` alone | 7.9 · 6.8 · 7.1 | 34.7 · 34.8 |

Timing the scan alone removes the linear write and hash cost that dilutes the quadratic term. At
a limit of 16, HEAD sits 2.0× below the line and the quadratic copy 2.2× above it.

Done means:

1. **A shared harness** in `test/helpers/growth.mjs`. `measureGrowth({ run, small, large, pairs,
   warmup, now })` does the following:
   - calls `run(small)` and `run(large)` `warmup` times each, untimed;
   - takes `pairs` interleaved timed pairs, timing with `now` (default `performance.now`);
   - returns every sample, every pair ratio, and `ratio` = the minimum pair ratio.

   `assertLinear(result, limit)` throws an `AssertionError` whose message contains "bậc hai" and
   the ratio when `result.ratio >= limit`. The harness refuses input it cannot measure: a span
   `large / small` under 4, `pairs` under 1, or any timed small sample under 5 ms. It refuses with
   an error rather than a ratio — today's `Math.max(do1, 1)` turns a 0 ms sample into a meaningless
   pass.
2. **CP-10-P1 keeps its name** (CP-10's evidence counts it) and becomes a call to the harness:
   - it builds trees of 500 and 4000 files once, outside the timed region;
   - it times `scanComponents(root)` with 1 warm-up and 5 pairs;
   - it asserts `assertLinear(result, 16)`;
   - before timing, it asserts each tree scans to exactly 500 and 4000 components, so a broken
     fixture cannot time an empty walk.

   The settings live in one exported constant that the tests in `test/growth.test.mjs` reuse.
3. **Shown to still catch quadratic code.** A stub with the historical component × file shape,
   timed for real through the same harness and limit, must make `assertLinear` throw.

## Ràng buộc

- Only test code changes. `lib/` and `commands/` are untouched. No new dependency.
- `package.json`'s `test` glob (`test/**/*.test.mjs`) is unchanged. The helper does not end in
  `.test.mjs`, so it is not run as a test file.
- Harness behaviour is tested with an injected clock (`now`), so its decisions are deterministic.
  Only E1 uses the real clock, and it must stay a small part of the suite: its stub's small sample
  takes roughly 10–50 ms here, and the whole case finishes in under 5 s. E1 may use fewer pairs
  than CP-10-P1. It keeps the same sizes and limit.
- Verification before `done`: run `node --test --test-name-pattern="CP-10-P1"
  test/knowledge-command.test.mjs` five times, before and after the change, and record each run's
  duration and (after) its ratio in `.compass/CP-55/evidence/`. Estimated cost: writing the
  fixtures alone took 236 ms for 500 files and 1743 ms for 4000 files here, against 886 ms for
  today's 2000. That puts the test around 3.5 s alone, up from about 1.5 s.
- The remaining absolute-budget performance tests (`CP-42-P1` "under 200 ms", others "under 5 s")
  are out of scope. They can adopt the harness in their own tasks.
- Known limit, stated rather than hidden: load that starts between the small and the large sample
  of *every one* of the five pairs can still push the minimum over 16. This needs five coincident
  bursts instead of one. The minimum is lenient in the other direction: a single small sample
  slowed more than about 2.2× lets the quadratic stub pass *that* run. A false pass on a loaded
  machine is caught by the next quiet run; a false failure blocks `done` for everyone, so the bias
  is chosen on purpose.

- The pitfall "CP-10: Ngưỡng thời gian tuyệt đối không canh được hiệu năng" in
  `.knowledge/decided/pitfalls.md` states that a ratio test "vừa canh được vừa không chập chờn".
  This task measured the opposite (one loaded sample turned a linear 3.5 into 8.7). The owner
  approved correcting that sentence in this task; the rest of the entry and every other entry stay
  byte-identical.

## Rủi ro hồi quy

- **Coverage moves from the command to the scan.** CP-10-P1 stops timing `writeDerived` and the
  manifest hash, so a quadratic regression there would no longer trip it. The trade is deliberate:
  timed as a whole command, the quadratic copy cleared 16 by only 1.2×. The regression CP-10
  actually had lived in `scanComponents`. Calling this out so the next perf task does not assume
  the command is covered.
- **The test could pass vacuously.** A fixture that scans to nothing times two near-zero walks,
  and their ratio means nothing. The component-count assertion in CP-10-P1 and the 5 ms floor (V2)
  both guard that.
- **The harness could make the test blind to quadratic code** — for example, taking the minimum
  of the *large* samples over the maximum of the small ones. E1 (real clock, real quadratic stub)
  and E3 (the measured quadratic numbers replayed through the injected clock) pin the decision in
  the direction that matters.
- **CP-10's evidence** expects a passing line named `CP-10-P1 …`. The name is unchanged, and the
  test still runs in `test/knowledge-command.test.mjs`.
- **Suite duration** grows by an estimated 2 s for this test. The before/after durations recorded
  under Ràng buộc make that visible instead of assumed.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Injected clock scripting a linear workload: every small sample 30 ms, every large sample 220 ms, 5 pairs | `result.ratio` is 220/30 (7.33 to two decimals); `assertLinear(result, 16)` does not throw | P0 |
| H2 | Happy | Call order with `warmup: 1, pairs: 5` | `run` receives exactly `[500, 4000]` once, then `[500, 4000]` five more times in that interleaved order — 12 calls; `result.small` and `result.large` each hold 5 samples | P1 |
| V1 | Validation | `measureGrowth` with `large` equal to `small`, with `large / small` of 2, and with `pairs: 0` | each throws an error naming the bad argument; `run` is never called | P1 |
| V2 | Validation | Injected clock where every small sample measures 1 ms | throws an error containing "nhỏ" and the measured ms; no `ratio` is returned | P0 |
| E1 | Error | Real clock: a stub with the historical component × file shape (for each of n names, test each of n in-memory import clauses), at 500 and 4000 with limit 16 | `assertLinear` throws an `AssertionError` whose message contains "bậc hai"; `result.ratio >= 16`; the case finishes in under 5 s | P0 |
| E2 | Error | `run` throws `new Error('fixture hỏng')` on the large size | `measureGrowth` throws that same error (same message); nothing is swallowed into a ratio | P1 |
| E3 | Error | Injected clock replaying the measured quadratic pairs (63/2224, 67/2326, 58/2063, 58/2035, 58/2053 ms) | `result.ratio` is above 34; `assertLinear(result, 16)` throws | P0 |
| EC1 | Edge | H1's linear script with the large sample of pair 2 inflated to 660 ms (one burst of load) | `result.ratio` stays 7.33; `assertLinear` does not throw. Today's single-sample method on that pair would read 22 | P0 |
| EC2 | Edge | H1's script with load from pair 3 onward: both samples of pairs 3–5 multiplied by 2.5 | `result.ratio` stays 7.33; no throw | P1 |
| EC3 | Edge | Warm-up runs scripted 3× slower than the timed ones | `result.ratio` is unchanged at 7.33; warm-up durations appear in neither `result.small` nor `result.large` | P1 |
| EC4 | Edge | Load on a small sample instead: E3's quadratic replay with pair 4's small sample inflated to 90 ms | `result.ratio` drops to 2035/90 (22.6 to one decimal) and `assertLinear(result, 16)` still throws — one pair pushed toward passing lowers the verdict but cannot hide a 35× shape unless it is slowed more than 2.2× | P2 |
| H3 | Happy | `.knowledge/decided/pitfalls.md`, entry "CP-10: Ngưỡng thời gian tuyệt đối…" | no longer contains "không chập chờn"; its Phòng tránh line names taking several interleaved pairs and the smallest ratio; every other entry is byte-identical to HEAD f94ebdd | P1 |
