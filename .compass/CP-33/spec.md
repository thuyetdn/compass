# CP-33: `done` demands browser gates that `check` refused to run
Loại: bug
Phạm vi: commands/check.mjs, commands/done.mjs, lib/gates.mjs, test/check-done.test.mjs

## Mục tiêu
A `feature-m` or `feature-l` task in a repo with no `devUrl` cannot be closed. `check`
skips `ui` and `visual` because there is no browser target, prints every remaining gate
green, and exits 0. `done` then requires both gates for that task type, finds no record,
and fails with `Gate "ui" chưa chạy` — naming a gate the tool itself declined to run.
The advice it prints (`Chạy: compass check <id>`) leads back to the command that just
skipped them, so the loop never terminates.

Reproduced on CP-32 (`feature-m`, this repo, config has no `devUrl`): `compass check CP-32`
exits 0 with `Bỏ qua (chưa cài ở giai đoạn này): ui (không khai devUrl), visual (không khai
devUrl)`, and `compass done CP-32` then fails on exactly those two gates.

The fix: `check` records why it skipped a browser gate, and `done` accepts that record in
place of a pass. A skip stays visible in the final output — silently dropping the
requirement would turn a real coverage gap into a green gate.

## Ràng buộc
- A skip is only ever valid for `ui` and `visual`, and only for the reason `check` already
  uses: the repo declares no `devUrl`. No other gate may be skipped by this path.
- `done` must not re-derive the reason from `config.json`. Config is a trusted input
  (SKILL.md: "config.json được tin"), so reading it at `done` time would let someone
  delete `devUrl` after a red `ui` run and have the gate disappear. `done` reads the
  ledger record `check` wrote, which is signed like every other record.
- The skip record carries the same identity fields as a pass record (`taskId`, `sig`), so
  a skip copied from another task is rejected by the existing checks.
- A skip record must be distinguishable from a pass in the ledger — not `exitCode: 0`.
  A reader of `gate.json` must be able to tell "this gate did not run" from "this gate
  measured something and found it correct".
- `done` output must state which gates were skipped and why. Closing a task while two
  gates never ran is a fact the report has to carry.
- Zero runtime dependency: `node:*` and relative imports only.
- `lib/` returns values, never calls `process.exit` or `console.log`.

## Rủi ro hồi quy
- CP-16 made `done` fail on any red gate outside the required list. A skip record must not
  read as red there, nor as green — a `ui` record with `exitCode: 1` from a real run must
  still block, exactly as it does today.
- The hash checks (`sourceHash`, `specHash`, `configHash`) run over every record in the
  ledger. A skip record has no measurement behind it; it must not be exempted from the
  identity/`sig` check, and must not crash the hash loop by missing a field it needs.
- Multi-repo slots: `check` names browser-gate skips `ui@frontend`. `done` parses slots
  with `parseSlot`, so a skip in one repo must not satisfy the requirement for another
  repo that does declare `devUrl`.
- Tasks that already closed (CP-6 has real `ui`/`visual` pass records) must still close.
  Adding the skip path must not change how an existing pass record is read.
- `compass check --only=ui` on a repo without `devUrl` currently skips; it must keep the
  same behaviour and write the same record.

## Test cases

The dangerous direction is a skip that hides a real failure, so V- and S-cases outnumber
the happy path. `check` writing the record and `done` reading it are tested separately:
one function producing what another consumes is the seam where CP-15's mismatch lived.

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `check` on a `feature-m` task in a repo with no `devUrl` | Writes a `ui` and a `visual` record marked skipped, each naming the reason; still exits 0 | P0 |
| H2 | Happy | `done` on that task, every other gate green | Exit 0 — a skipped browser gate no longer blocks | P0 |
| H3 | Happy | `done` output when gates were skipped | Names `ui` and `visual` and says they never ran for want of a `devUrl` — the closing report carries the gap | P0 |
| H4 | Happy | `check` in a repo that DOES declare `devUrl` | Runs the gate and writes a normal pass record; no skip record is written | P0 |
| H5 | Happy | An existing task holding real `ui`/`visual` pass records (CP-6 shape) | `done` reads them exactly as before; the skip path changes nothing | P0 |
| V1 | Validation | A skip record for a gate that is not `ui`/`visual` (hand-written into the ledger) | `done` refuses it and reports the gate as not run — only browser gates may be skipped | P0 |
| V2 | Validation | A skip record whose stated reason is not the no-`devUrl` reason | `done` refuses it; the only accepted reason is the one `check` produces | P0 |
| V3 | Validation | A skip record missing its identity fields | Treated as a stale record from an older version, same as any other record lacking them | P1 |
| E1 | Error | A `ui` record with `exitCode: 1` from a real run, in a repo that later dropped `devUrl` | Still blocks `done` — a red measurement is never re-read as a skip (CP-16) | P0 |
| E2 | Error | The ledger holds both a skip record and a real pass record for the same slot | Impossible by construction; if it occurs the later write wins and `done` reports one state, never two | P1 |
| EC1 | Edge | Multi-repo: `ui@frontend` skipped, `ui@backend` a real pass | `done` reports the frontend skip and accepts the backend pass; neither satisfies the other | P0 |
| EC2 | Edge | Multi-repo: one repo declares `devUrl`, the other does not, both required | Exit 0 with only the no-`devUrl` repo named as skipped | P0 |
| EC3 | Edge | A `fix`/`bug` task, which never required `ui`/`visual` | No skip record is written and no skip line appears in `done` output — nothing to report | P1 |
| EC4 | Edge | `compass check --only=ui` in a repo with no `devUrl` | Writes the same skip record as a full `check` run | P1 |
| S1 | Security | A skip record copied from another task's `gate.json` | Rejected by the existing identity check — a skip is signed like any other record | P0 |
| S2 | Security | A skip record edited by hand to change its gate or reason | Rejected: the signature covers the reason, so an unrunnable gate cannot be relabelled into a skippable one | P0 |
| S3 | Security | The skip is recorded, then `devUrl` is added to config and the gate never re-run | `done` still accepts the skip, and the report says the gate never ran — `done` reads the ledger, not config, so nothing silently flips to green | P0 |
