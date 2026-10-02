# CP-47: `done` reports a skipped browser gate as never run when the task uses repos
Loại: bug
Phạm vi: commands/done.mjs, test/check-done.test.mjs

## Mục tiêu

In multi-repo mode, `check` writes the skip record of a browser gate into a repo slot —
`ui@frontend` — because the skip belongs to one repo (CP-33). The required-gate loop in `done`
looks only at the bare slot `ui`. No bare record exists, so `done` reports `Gate "ui" chưa chạy`
and tells the user to run `check` again. `check` writes the same `ui@frontend` skip, and the task
can never close. Found 02/10/2026 in a workspace whose only repo in scope is `.compass` with no
`devUrl`: six tasks were green on every gate and none of them could close.

The later loop over extra slots already accepts a valid repo skip (`laBoQuaHopLe` on
`ui@frontend`). Only the required loop is wrong.

Done means: when the bare slot is missing, a required browser gate counts as covered **only if
every repo in the task's scope has a valid skip record for it**. Then the extra-slot loop reports
those skips exactly as it does today. If any repo in scope has no valid skip for it, the gate
is still "chưa chạy". This applies to a slot that was never written and to a slot whose record is not a valid skip.
A repo that declares `devUrl` when `check` runs gets a real run, not a skip, so it never has a
skip slot to lean on. A `devUrl` added after the skip was signed follows CP-33-S3: the signed skip
stands, and the closing report still says the gate never ran.

## Ràng buộc

- `done` reads the config only to know which repos are in scope, using the same
  `resolveRepos` + `reposForScope` as `check`. It still never derives a skip **reason** from the
  config (the CP-33 rule): the slot record must carry the signed skip itself.
- If the config cannot be read or resolved, fall back to today's behaviour: the gate is "chưa chạy".
  Fail closed.
- Single-repo tasks (no `repos` in config) are untouched: the bare slot is the only slot.
- No change to `check`, the gate store, or signatures.

## Rủi ro hồi quy

- **Opening the final gate too wide.** A repo that should have been measured could pass on another
  repo's skip. V1, E1 and EC1 cover this.
- **Single-repo CP-33 behaviour.** CP-33-H2, H3, V1, V2, E1, S1–S3 and EC3 run unchanged.
- **Skips must still be named in the closing report.** H1 checks that `ui@<repo>` is listed with
  the `devUrl` reason.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Config with two repos, neither declares `devUrl`; scope covers both; `check --only=ui` and `--only=visual` | `done` does not say `Gate "ui…" chưa chạy` or `Gate "visual…" chưa chạy`; it names `ui@be` and `ui@fe` as skipped for `devUrl` | P0 |
| H2 | Happy | Single repo, no `devUrl`, after `check` (CP-33-H2 setup) | Same result as before: no "chưa chạy" for ui/visual | P1 |
| V1 | Validation | Both repos skipped by `check --only=ui`, then `fe` gains a `devUrl` in config | Same rule as CP-33-S3 (`done` reads the ledger, never re-derives from config): no "chưa chạy", and the report still names `ui@fe` as never run for `devUrl` | P0 |
| E1 | Error | Both repos skipped, then the `ui@fe` key is removed from `gate.json` | `done` says `Gate "ui" chưa chạy` | P0 |
| EC1 | Edge | Two repos; only `be` is in scope and has no `devUrl`; `fe` has `devUrl` and is out of scope | `done` does not say `Gate "ui" chưa chạy` | P1 |
| EC2 | Edge | Both repos skipped, then `config.json` becomes invalid JSON | `done` says `Gate "ui" chưa chạy` (fail closed) | P1 |
