# CP-56: Multi-repo convention, ui and visual measure the wrong place and keep one record for all repos
Loại: feature-m
Phạm vi: commands/convention.mjs, commands/ui.mjs, commands/visual.mjs, commands/done.mjs, commands/check.mjs, lib/gate-store.mjs, lib/gates.mjs, lib/rule-runner.mjs, test/multi-repo-gates.test.mjs (mới), test/multi-repo.test.mjs, skills/compass/SKILL.md
Gốc soi: f94ebdd

## Mục tiêu

In multi-repo mode `check` runs `convention`, `ui` and `visual` once per repo in `Phạm vi` and passes
`{ cwd: repo.dir, taskId, repo: repo.name, gateRoot: root }` (`commands/check.mjs:143`). None of the
three reads `repo` or `gateRoot`: their signature is `{ cwd, taskId }` (`convention.mjs:19`,
`ui.mjs:32`, `visual.mjs:28`). Each calls `findRoot(cwd)`, which climbs from `repo.dir` back to the
Compass root, then measures the root, reads `dev`/`devUrl` from the root config, and calls
`writeGate(root, …)` into the bare slot. Meanwhile `check` decided whether to run them from the merged
per-repo config (`check.mjs:116`, merge at `lib/repos.mjs:56`). The two halves disagree about which
config applies, and the record keeps no repo name.

Measured on HEAD (f94ebdd) with throwaway two-repo roots (`be/`, `fe/`, `initRepo` fixture, Loại
`feature-s`):

| Setup | Result on f94ebdd |
|---|---|
| Rule `scope: src/**/*.jsx` forbidding hex colours; `fe/src/App.jsx` holds `'#fff'` | `check --only=convention` exits **0**: "[be] … 1 luật, 0 file, không vi phạm", same for [fe]. One bare `convention` slot, `scanned: 0` |
| Same rule written root-relative, `scope: fe/src/**/*.jsx` | exits 1, but the failure is printed as **[be]** `fe\src\App.jsx:1` — be's run is blamed for fe's file |
| Both repos declare `devUrl`, no design contract | `[be] ui PASSED`, `[fe] ui PASSED`, ledger holds one `ui` and one `visual` slot |
| Only fe declares `dev`/`devUrl` (repo config); be has none; no contract | ledger: `ui@be`/`visual@be` skips plus bare `ui`/`visual`; `done` exits 0 |
| Same, with a contract holding one element | `check --only=ui` exits **2** "[fe] config.json thiếu "dev" … và "devUrl"" — fe declared both; `visual` the same |
| Playwright stub installed only in `fe/node_modules`, `dev`/`devUrl` shared | `ui` exits 2 "Gate ui cần Playwright, dự án này chưa có." — resolution starts at the root |

`SKILL.md` ("Giai đoạn hiện tại") says these gates "vẫn quét đúng thư mục nhưng ghi sổ không kèm tên
repo". The first half is wrong as measured: they rescan the root, and a repo-relative rule matches no
file at all. The visual baseline has the same flaw in a second place: it lives at
`.compass/<id>/baseline/<viewport>.png`, so two repos with a `desktop` viewport share one baseline and
the second compares its page against the first one's screenshot.

Done means:

- Each of the three gates accepts `repo` and `gateRoot`, as `testCommand` already does. With a repo, it
  measures `repo.dir` with that repo's merged config (`dev`, `devUrl`, `devTimeoutMs`,
  `visualThreshold`), starts the dev server in `repo.dir`, looks up Playwright from `repo.dir`, writes
  its record to `slotFor(gate, repo)`, and keeps `sourceHash` as `hashSource(gateRoot)` so `done`
  compares like with like.
- Called without a repo in a multi-repo project — `compass convention <id>` from the CLI — a gate runs
  every repo in `Phạm vi` in turn and writes per-repo slots, the way `testCommand` resolves its own
  repos so a bare CLI call cannot overwrite per-repo evidence (CP-13-S3). For `ui`/`visual` a repo
  without `devUrl` is skipped by the same rule `check` applies, with the same signed skip record when
  the task type requires the gate.
- `done` requires, for each of `convention`, `ui`, `visual` that the task type requires, a slot
  `<gate>@<repo>` for **every** repo in `Phạm vi` that is green, or for `ui`/`visual` a valid skip
  (CP-47). A missing repo slot is "chưa chạy".
- A bare `convention`, `ui` or `visual` slot in a multi-repo task is stale: it cannot say which repo it
  measured. `done` reports it, names the repos it should have been split into, and says to rerun
  `compass check <id>` — it never counts as a pass, required gate or not. Writing a per-repo record of
  one of these three gates removes the bare slot of the same gate, so a rerun clears the problem
  without hand-editing `gate.json`.
- Single-repo projects behave exactly as today: bare slots, no `repo` field, same paths, same output.
- `SKILL.md` stops telling multi-repo projects to trust only `test` and `knowledge`, and says what now
  holds.

## Ràng buộc

- **Single-repo is byte-for-byte unchanged.** No `repo` field in records, slots `convention`/`ui`/
  `visual`, baseline at `.compass/<id>/baseline/<viewport>.png`, evidence at `evidence/ui.json` and
  `evidence/visual-<viewport>-diff.png`. Every existing test in `test/ui-command.test.mjs`,
  `test/visual-command.test.mjs`, `test/convention-command.test.mjs` and `test/check-done.test.mjs`
  stays green without edits.
- **`test` keeps its aggregated bare slot.** In multi-repo mode `check` calls `testCommand` once with
  every repo and it writes the bare `test` slot (`check.mjs:105`), because test IDs are compared on the
  merged output (CP-13-H7). This task does not change that; the bare-slot rule above applies to
  `convention`, `ui`, `visual` only, listed once in `lib/gates.mjs`.
- **One conventions file, matched per repo.** Rules come from the Compass root's
  `.knowledge/decided/conventions.md`, as today. Only files under `repo.dir` are scanned. A rule's
  `scope` glob matches if it matches the path relative to the repo (`src/App.jsx`) **or** relative to
  the root (`fe/src/App.jsx`), so rules written root-relative to work around today's behaviour keep
  working. Violations are printed root-relative, so the reader knows which repo the file is in.
- **One design contract per task.** `.compass/<id>/design-contract.json` is measured in every repo in
  `Phạm vi` that declares `devUrl`. Two front-ends with different DOMs in one task will need a
  per-repo contract; that is not in this task, and SKILL.md says so.
- **Per-repo artifact paths.** In multi-repo mode: baseline at `.compass/<id>/baseline/<repo>/<viewport>.png`,
  evidence at `.compass/<id>/evidence/repos/<repo>/ui.json` and
  `.compass/<id>/evidence/repos/<repo>/visual-<viewport>-{actual,diff}.png`. The `repos/` level keeps a
  repo name from colliding with `gate.json`, `test.log` or `findings.json`. A repo name containing `/`
  (`store/frontend`, documented in SKILL.md) nests directories. A name with an empty, `.` or `..`
  segment, a `\`, a `:`, or a leading `/` makes `ui`/`visual` exit 2 naming the repo before anything is
  written.
- **Sequential, as today.** Repos run one after another and each dev server is stopped before the next
  one starts (CP-8, CP-13-P1). No parallelism.
- **`done` still reads config only to learn which repos are in scope** (the existing rule above
  `phamViBoQuaHet`); it never derives a pass or a skip from config. If config cannot be read, the
  three gates are "chưa chạy" and the bare slot is not used as a fallback. No task that closes today
  stops closing because of this: a config that breaks after `check` already fails `done` through the
  `test` record's `configHash`, and a config broken before `check` stops `check` itself.
- **Signatures and slots.** Records are written through `writeGate(root, taskId, record, repo)`, so the
  repo name is signed and `verifyAllGates` catches a record moved between repo slots, as it does for
  `test@<repo>` today.
- No new dependency. Unit tests do not need a real browser (see Test cases).

## Rủi ro hồi quy

- **CP-33 and CP-47 in `test/check-done.test.mjs`.** They pin the skip slots `ui@<repo>` and the
  "every repo in scope" rule. The new required-slot logic in `done` generalises CP-47's
  `phamViBoQuaHet`; CP-47-V1 (a devUrl added after the skip is recorded still reads the ledger) and
  CP-47-EC2 (unreadable config keeps the gate unrun) must stay green as they are.
- **`done` closing a multi-repo task that closes today.** On f94ebdd a multi-repo `feature-s` task whose
  repos run `ui` closes on a bare `ui` slot. After this task that slot is stale and the task needs a
  rerun of `check`. That is intended — the bare slot described only the last repo — and the message
  must say exactly what to run.
- **`check` output.** Lines keep their `[repo]` prefix. The skip list keeps printing `ui@be (không khai
  devUrl)` as CP-33-EC2 asserts.
- **The CLI path.** `compass convention|ui|visual <id>` in a single-repo project must not start
  reading `repos` or change its output. In a multi-repo project it changes from one root run to one
  run per repo in scope; a scope that matches no repo gives the same exit 2 as `check`.
- **The dev server's working directory.** Today it is the root for every repo. A project whose `dev`
  command only worked from the root (for example `pnpm --filter fe dev`) and whose `devUrl` sits at the
  shared level will now start in `repo.dir`. SKILL.md already documents per-repo `dev`; the change is
  called out in the SKILL.md update.
- **Repo-relative scope matching widens rules.** A rule `src/**/*.jsx` that matched nothing in a
  multi-repo root will now match `src/` of every repo in scope, and may turn the gate red on existing
  code. That is the false green going away; it is still a visible change.
- **Hash checks.** Per-repo records carry `hashSource(gateRoot)`. Hashing `repo.dir` instead would make
  `done` report "Code đã thay đổi" on every per-repo record right after a green run, because `done`
  hashes the root.
- **`test/multi-repo.test.mjs`.** Three CP-13 tests claim more than they measure and are rewritten in
  place, keeping their CP-13 names (SKILL.md: only rename tests of the task being worked on):
  - `CP-13-EC1` (:163) hand-writes signed `test@be`/`test@fe` records and reads them back — it tests
    `JSON.parse`, not the gates. It becomes a real `check` run in both repos asserting `convention@be`
    and `convention@fe` both survive, with no bare `convention`.
  - `CP-13-V3` (:227) runs `check --only=test` and then asserts on the config file it wrote itself. It
    becomes a real `check --only=ui` on a feature-s/m task: `ui@be` is a skip, `ui@fe` is a measured
    record (no contract, so it passes with `measured: 0`) and is not a skip.
  - `CP-13-EC3` (:248) uses Loại `fix`, which never runs `ui` or `visual`, so "not FAILED" holds
    trivially. It becomes a feature-s/m task with no `devUrl` anywhere, asserting the four skip slots
    exist and no bare `ui`/`visual` slot does.
- **`test/deep-integration.deep.mjs`** drives a real browser against `examples/todo`, a single-repo
  project, and is not part of `npm test`. It must still pass; this task adds no deep test.

## Test cases

New cases live in `test/multi-repo-gates.test.mjs`. Playwright follows the existing pattern: unit tests
never need a real browser. `test/browser.test.mjs` installs a stub `playwright` package under
`<dir>/node_modules/` that `findPlaywright` resolves; here the stub's `chromium.launch()` returns a fake
browser whose `page.evaluate` returns measurement results and whose `page.screenshot` returns PNG bytes
built with `lib/png.mjs`. The dev server is a `node` one-liner HTTP server on a free port. Measured on
f94ebdd in a single-repo root: this stub plus server takes `ui` to "1 thuộc tính, 1 viewport, không
lệch" in 444 ms, and the server's `process.cwd()` shows where it was started.

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Two repos be, fe; rule `scope: src/**/*.jsx` forbids hex colours; `fe/src/App.jsx` holds `'#fff'`, `be/src/x.jsx` is clean; `check --only=convention` | exit 1; `convention@be` has `exitCode: 0`, `convention@fe` has `exitCode: 1`, `errorCount: 1`; output names `fe/src/App.jsx:1` (with the platform separator, as single-repo output does today) under `[fe]`; no bare `convention` slot (f94ebdd: exit 0, `scanned: 0`) | P0 |
| H2 | Happy | Same rule, both repos clean, be has 1 `.jsx` file and fe has 2 | exit 0; `convention@be.scanned` is 1, `convention@fe.scanned` is 2 | P0 |
| H3 | Happy | `dev`/`devUrl` declared only in fe's repo config, a contract with one element, stub Playwright in `fe/node_modules`; `check --only=ui` | exit 0; `ui@fe` has `exitCode: 0`, `measured: 1`, `devUrl` equal to fe's URL; `ui@be` is a skip; no bare `ui` (f94ebdd: exit 2 "config.json thiếu") | P0 |
| H4 | Happy | Same setup, `check --only=visual` | exit 0; `.compass/T-1/baseline/fe/desktop.png` exists, `.compass/T-1/baseline/desktop.png` does not; `visual@fe.createdBaselines` is `["desktop"]` | P0 |
| H5 | Happy | Full `check` then `done` on a two-repo feature-s task (fe measured, be skipped) | `done` exits 0; output names `ui@be`, `visual@be` as never run for lack of `devUrl` | P0 |
| H6 | Happy | Single-repo project with `dev`/`devUrl`, a contract, stub Playwright at the root; full `check` then `done` | slots `convention`, `ui`, `visual` with no `repo` field; baseline at `baseline/desktop.png`; `evidence/ui.json` exists; `done` exits 0 | P0 |
| V1 | Validation | Multi-repo task whose ledger holds a signed green bare `convention` record (run before `repos` was declared) and no per-repo slots | `done` exits 1; the output names `convention`, lists `be, fe`, and says `compass check T-1`; it does not count the record as a pass | P0 |
| V2 | Validation | V1's ledger, then `check --only=convention` | the bare `convention` slot is gone, `convention@be` and `convention@fe` exist, and `done` no longer mentions the stale record | P0 |
| V3 | Validation | `conventionCommand({ cwd, taskId, repo: 'khong-co', gateRoot })` | exit 2 naming `khong-co`; no record written | P1 |
| V4 | Validation | A bare green `ui` slot in a multi-repo task whose type does not require `ui` (Loại `bug`) | `done` exits 1 and reports the bare slot as stale, with a hint to rerun or delete the key — extra gates are not exempt | P1 |
| E1 | Error | fe's repo config declares `dev` as a script that writes `process.cwd()` to a marker and exits, `devUrl` on a port nothing listens on, `devTimeoutMs: 500`; stub Playwright in fe | `ui` exits 2 with "Dev server không phản hồi"; the message quotes fe's `dev`; the marker holds the path of `fe/`; no green `ui@fe` | P0 |
| E2 | Error | Stub Playwright only in `be/node_modules`, fe declares `dev`/`devUrl` and a contract has elements | fe's `ui` exits 2 with the Playwright install hint — resolution starts at `fe/` and does not borrow a sibling's install | P1 |
| E3 | Error | `be` red on convention, `fe` would be green; full `check`, then `done` | `check` stops after be (no `convention@fe` written); `done` reports `convention@be` red and `convention@fe` not run | P1 |
| E4 | Error | Per-repo slots green for every repo, then `config.json` replaced with invalid JSON | `done` exits 1 and reports `convention`, `ui`, `visual` as not run; it does not fall back to any bare slot | P1 |
| EC1 | Edge | Rule written root-relative, `scope: fe/src/**/*.jsx`, violation in `fe/src/App.jsx` | the violation lands in `convention@fe`; `convention@be` is green (f94ebdd: printed under `[be]`) | P0 |
| EC2 | Edge | `Phạm vi: be/src` only, fe declared in config | only `convention@be` is written; `done` does not ask for `convention@fe` | P1 |
| EC3 | Edge | `dev` declared at the shared level, `devUrl` only in fe | fe's merged config is used: the shared `dev` starts in `fe/` and `ui@fe` is measured | P1 |
| EC4 | Edge | Repo key `store/frontend` with `devUrl`, a contract, stub Playwright | slot `ui@store/frontend` and `visual@store/frontend`; baseline at `baseline/store/frontend/desktop.png`; `done` accepts them | P1 |
| EC5 | Edge | Bare `conventionCommand({ cwd: root, taskId })` and `uiCommand` the same way, in a two-repo project | per-repo slots for every repo in scope, never a bare slot; a repo without `devUrl` gets the same skip record `check` writes | P0 |
| EC6 | Edge | Two repos both with `devUrl` and no contract | `ui@be`, `ui@fe`, `visual@be`, `visual@fe` all present with `exitCode: 0`; no bare slot (f94ebdd: one `ui`, one `visual`) | P1 |
| EC7 | Edge | `skills/compass/SKILL.md` after the change | no longer contains "chỉ nên tin `test` và `knowledge`" nor "vẫn quét đúng thư mục"; names the slot `<gate>@<repo>` for `convention`, `ui`, `visual` and the per-repo baseline path | P2 |
| S1 | Security | A signed `convention@be` record copied into the `convention@fe` key | `done` reports the slot as moved ("không thuộc slot này") and fe as not run | P0 |
| S2 | Security | `check` leaves `convention@fe` red; then a signed green bare `convention` record from an earlier single-repo run of this task is put back into the ledger | `done` exits 1, naming both the red `convention@fe` and the stale bare slot | P0 |
| S3 | Security | Repo key `../x` with `path: "fe"` and `devUrl`, a contract, stub Playwright; `check --only=visual` | exit 2 naming `../x`; no new file or directory appears under `.compass/` (compared by listing before and after), and nothing appears next to `.compass/T-1/` | P0 |
| S4 | Security | Green two-repo `check`, then a new file in `be/src/` | `done` exits 1 with "Code đã thay đổi" for `ui@fe` and `convention@fe` — a per-repo record does not survive an edit in another repo | P1 |
| S5 | Security | Two repos with `devUrl`, the same `desktop` viewport, stubs whose screenshots differ per repo; run `visual` twice | `baseline/be/desktop.png` and `baseline/fe/desktop.png` hold different bytes; the second run is green in both repos (f94ebdd: one shared baseline, fe compared against be's image) | P1 |
| P1 | Performance | fe holds 500 `.jsx` files, be holds 3; `check --only=convention` | `convention@fe.scanned` is 500 and `convention@be.scanned` is 3 — each repo walked once, not the root twice; finishes in under 2 s (f94ebdd: 116 ms for two root walks) | P1 |
| P2 | Performance | Two repos whose dev servers share one port and answer with their repo name; the stub's `page.goto` fetches the URL and appends the body to a marker | marker reads `be` then `fe` — each server stopped before the next starts, so fe never measures be's page | P1 |
| P3 | Performance | `done` on a two-repo task with six per-repo slots and the 500-file fixture | returns in under 2 s | P2 |
