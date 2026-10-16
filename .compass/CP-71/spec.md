# CP-71: Four tests pin commit SHAs, so rewriting history turns them red
Loại: fix
Phạm vi: test/release-docs.test.mjs, test/growth.test.mjs, test/spec-hint.test.mjs, test/spec-parser.test.mjs, test/secrets-command.test.mjs
Gốc soi: 7ec85f6

## Mục tiêu

Cleaning 33 MB of deleted files out of git history rewrites every SHA. Measured on a rewritten
clone: 1334 of 1338 tests pass, and the four that fail all fail for the same reason — they name a
commit by its hash, and that hash no longer exists.

- `test/release-docs.test.mjs:19` and `test/growth.test.mjs:210` hold `SPEC_BASE = 'f94ebdd'`,
  read with `git show f94ebdd:package.json`. After the rewrite that commit is `897c641`.
- `test/spec-hint.test.mjs:109` holds `c50b51b`, now `9f92618`.
- `test/spec-parser.test.mjs:196` holds `a509f50`, now `38cf7ba`.
- `test/secrets-command.test.mjs` CP-40-H7 and CP-40-P2 scan this repo's own diff, which fails
  while the pinned base is unreachable.

A hash is the wrong way to name a commit in a test. It breaks on any history rewrite, on a shallow
clone, and on a fork that grafted its history — and the failure says nothing about the thing the
test measures. Done means every test names its commit by something stable, and the suite passes on
both the current history and a rewritten one.

## Ràng buộc

- What each test measures must not change. CP-58-H6 still compares today's `bin`, `files` and
  `scripts` against the same historical commit; it just finds that commit differently.
- No new dependency, Node built-ins only.
- A test that genuinely cannot find its base must still fail loudly, not pass by skipping. A green
  test over a lookup that silently returned nothing is the failure mode Compass exists to prevent.
- Strings that only look like hashes (`deadbeefcafe`, `aaaaaaa`, `6ef19b41`) are fixtures, not real
  commits. They stay.

## Rủi ro hồi quy

- CP-58-H6 is the guard that stops `package.json`'s `bin`/`files`/`scripts` drifting; if the new
  lookup picks the wrong commit, the guard silently compares the wrong thing.
- CP-40-H7 asserts this repo scans clean for secrets against its own history. A lookup that returns
  nothing would make the gate red for the wrong reason, which reads as a secret leak.
- The growth tests use the base to size a historical scan; a different commit changes the measured
  shape and may flake.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Whole suite on the current history | 1338 pass, 0 fail | P0 |
| H2 | Happy | Whole suite on a history-rewritten clone | same count passes, 0 fail | P0 |
| H3 | Happy | CP-58-H6 resolves its base commit | finds a commit, reads package.json from it | P0 |
| H4 | Happy | The resolved base is the same commit as before the rewrite | same subject line | P0 |
| V1 | Validation | No test file holds a real commit SHA any more | grep finds only fixture strings | P0 |
| E1 | Error | The base cannot be resolved at all | the test fails with a message naming what it looked for | P0 |
| EC1 | Edge | Fixture strings that look like hashes | untouched, their tests still pass | P1 |
| EC2 | Edge | CP-40-H7 on a rewritten clone | passes: the repo still scans clean | P0 |
