CP-55 — `node --test --test-name-pattern="CP-10-P1" test/knowledge-command.test.mjs`, 5 runs each, machine shared with other agents.

Before (HEAD c03e913, single-sample knowledge --sync 500->2000, `< 8`), test duration_ms:
2377.7 · 2416.8 · 3923.6 · 3035.8 · 2920.9   (all pass; old test prints no ratio)

After (b7652b3, scanComponents 500->4000, 1 warm-up, 5 pairs, min ratio, limit 16):
| run | duration_ms | verdict (min) | pair ratios |
|---|---|---|---|
| 1 | 6074.6 | 7.58 | 7.58 · 7.77 · 7.92 · 9.33 · 8.06 |
| 2 | 7673.0 | 5.70 | 13.73 · 5.70 · 6.98 · 11.14 · 7.46 |
| 3 | 9828.6 | 6.01 | 6.85 · 6.95 · 7.28 · 6.01 · 9.15 |
| 4 | 8715.1 | 6.37 | 6.37 · 7.84 · 7.86 · 7.70 · 6.57 |
| 5 | 8247.1 | 6.98 | 8.29 · 9.22 · 8.00 · 6.98 · 8.23 |
