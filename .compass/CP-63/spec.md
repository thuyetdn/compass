# CP-63: Another task's bare-named test fills the one ID this task left out
Loại: bug
Phạm vi: lib/test-parser.mjs, commands/test.mjs, skills/compass/SKILL.md, README.md, docs/huong-dan.md, test/test-own-prefix.test.mjs (mới)
Gốc soi: 4aba541

## Mục tiêu

When the gate matches a spec ID against the test output, a test that names the ID with no
task id in front (`S1 renders …`) is credited to whichever task is asking, as long as it is the
only passing line carrying that ID. The "one ID matches several tests → red" rule cannot fire on a
single match, and `khaiChuNaoDo` only rejects a line that claims *another* task. A bare name
claims nobody, so it is accepted.

That is fine for a task that names all its tests bare. It is wrong for a task that has already
shown how it names its tests. Measured on HEAD (4aba541) with real Vitest, on a copy of
`examples/todo`: `docs/demo/scenario/` copied in as task TD-002, with the `TD-002-S1` test
deleted. TD-001's 13 tests are all bare (`H1 adds a todo…` … `S1 renders a script tag as text,
not markup`). TD-002's 12 remaining tests are all prefixed (`TD-002-H1 …` … `TD-002-EC3 …`).

```
$ compass test TD-002
✓ Gate test PASSED — 13/13 test cases đã chạy
```

`evidence/test.log` has exactly one line mentioning S1: `ok 13 - S1 renders a script tag as
text, not markup`, in `test/App.test.jsx`, which is TD-001's file. `gate.json` records
`ranIdCount: 13`, `missingIds: []`, `seenOnOtherTasks: []`. TD-002 wrote no S1 test and the gate
says it ran 13 of 13.

Two variants, measured with `extractRanIds` directly on HEAD:

| Output (pass lines) | Task | `ran` today |
|---|---|---|
| `TD-002-H1 b`, `S1 renders a script tag`, `TD-002-S1 c # SKIP` | TD-002 | `H1, S1`. The task's own S1 test is skipped, and the bare one stands in for it. The skip is not even reported, because the final dedup removes S1 from the non-pass bucket. |
| `TD-002-H1 b`, `H1 a`, `S1 bare` | TD-003, which has written nothing | `S1` ran, `H1` collided |

Done means a new rule in `extractRanIds`: **if any passing line in the output claims this task**,
in the ownership form `ownsLine` already recognises (`TD-002-H1`, `TD-002: H1`, `[TD-002] H1`,
`TD-002 — H1`, and the same after `>`/`›`/`»`), then a spec ID counts only when a passing line
claims it for this task. A bare match no longer counts. The gate says so and names the bare test it
ignored:

```
✗ Gate test FAILED
  Spec khai báo 13 test cases, chỉ tìm thấy 12 đã chạy.
  Task này đặt tên test kèm "TD-002-", nên test tên trần không được tính: S1
        S1 renders a script tag as text, not markup

→ Test tên trần không cho biết nó của task nào. Nếu đó là test của task này, đổi tên thành `TD-002-S1 …`. Nếu không, viết test `TD-002-S1 …` cho case đó. Không cần đổi test của task khác.
```

The wording above is a proposal. The tests assert on what it must carry: the ID, the bare test's
name, the task id, and the exact rename `TD-002-S1`.

When no passing line claims this task, behaviour stays exactly as it is today. TD-001 in
`examples/todo`, alone, still passes 13/13.

**Why this rule and not another.** A prefixed name is the user *telling* the gate which tests are
theirs. Once a task has said that for even one test, a bare test is not "probably mine". It is a
test the user chose not to claim, and in a shared suite it is as likely to be someone else's as
theirs. The gate cannot tell which (pitfall CP-32: "dữ liệu không trả lời được thì báo lỗi, đừng
đoán"), so it asks for a one-word rename. A wrong red that names its fix costs that rename. A wrong
green costs a case nobody tested.

Three alternatives were weighed and rejected:

- **Exempt single-task projects (`knownTasks.length === 1`).** In that case the bare match really
  is this task's own test. But the exemption would flip a green check to red the day a second task
  directory appears, with no change to code or tests. That is worse than one consistent rule. A
  task that mixes prefixed and bare names goes red, and the message says what to rename (V2).
- **Mirror the rule for tasks without a prefix** (ignore lines that claim another task, so a single
  remaining bare line counts). That would make TD-001 green again next to TD-002. Measured today,
  `compass test TD-001` on that copy is red: 11 IDs collide between `H1 adds a todo…` and
  `TD-002-H1 …`. But the same change lets a test-less TD-003 pass on TD-001's bare tests. That is
  INV-2 reopened, so TD-001 stays as it is (EC6).
- **Also trigger on a prefixed line that did not pass** (skip/fail). `testNameOn` does not strip a
  bare `SKIP`/`FAIL` word, so the claim check would misread those lines. The trigger is a passing
  line only. E1 shows that a skipped prefixed test is still caught whenever any other prefixed test
  of the task passed.

**What stays open, stated plainly:** a task that never prefixes anything is still credited a
single bare match from another task (TD-003's S1 above). The gate has no signal in that case. The
docs must say it: in a suite shared with other tasks, prefix *every* test of the task.

## Ràng buộc

- What counts as a claim does not change. `ownsLine` stays the only definition, and no new form is
  added. `khaiChuNaoDo`, the `knownTasks` check, and the existing collision / other-task buckets
  keep their behaviour for every task that has no passing claimed line.
- The rule needs only `taskId`. It must apply when `knownTasks` is `null`, and it must not apply
  when `taskId` is `null`. Callers without a task id get today's result.
- Order of decisions per ID: a line claims it for this task → counts (today's escape, multi-repo
  included). Otherwise, every line claims another task → `seenOnOtherTasks` (today). Otherwise, if
  the task uses prefixes → the new bucket, even when the ID has two or more bare lines. One group,
  one explanation, never also `collided`. Otherwise → today's single-match / collision logic.
- `extractRanIds(output, knownIds, opts)` keeps its signature and every existing return field. It
  adds `seenOnBareLines` (IDs) and `bareMatches` (ID → bare test names). The gate writes
  `seenOnBareLines` to `gate.json` next to `seenOnOtherTasks`. `done` must not require the field,
  so records written before this task stay valid.
- The `Kiểm tra bằng: mắt` branch of `testCommand` returns before `extractRanIds` and is not
  touched. Incidental finding, out of scope: the `esc` helper on line 84 of `commands/test.mjs` is
  double-escaped and escapes nothing (`esc("v1.0+x")` returns `v1.0+x`). That belongs to a separate
  task.
- Docs: SKILL.md "Cách Compass đếm test ID" gets a row for the new outcome and a sentence giving
  the rule ("task đã đặt tên kèm task id thì test tên trần không được tính"). README "Khi một ID
  khớp nhiều test" and `docs/huong-dan.md` (the naming paragraph) say the same: in a shared suite,
  name every test of the task with its task id, not only the colliding ones.
- No new dependency. Tests replay the measured Vitest TAP through a `node` script, so the suite
  stays zero-dependency.

## Rủi ro hồi quy

- **Suites that mix prefixed and bare names for one task go red.** This is deliberate, and V2 pins
  it. This repo is not affected: no test in `test/` starts with a bare spec ID (measured with grep;
  CP-18-H1 already enforces it). `examples/todo` TD-001 is all bare and stays green (V1). The demo
  scenario's TD-002 is all prefixed and stays 13/13.
- **Existing parser tests.** Any test in `test/test-parser.test.mjs` or `test/test-command.test.mjs`
  that feeds a prefixed line and a bare line for the same task, and expects the bare one to count,
  encodes the old rule. Changing such an expectation has to be named in the commit message, not
  done quietly. The escape tests (`CP-15-EC42`, the multi-repo "đường thoát vẫn phải sống" case)
  must stay green untouched.
- **The reporter-suspicion hint.** `seenAnywhere` must include the new bucket. Otherwise a task
  whose IDs all land there reads as "reporter không in tên test", which is the same contradiction
  the `collided` comment in `commands/test.mjs` warns about. H3 asserts the hint is absent.
- **The final dedup.** IDs in the new bucket are removed from `ran`, but a skipped or failed claimed
  line must stay in `seenOnNonPassLines` (E1). Today the dedup hides it.
- **"Không tìm thấy dấu vết".** The new bucket must be excluded from `neverSeen`, or S1 is reported
  twice with two different stories.
- **Prefix boundaries.** `CP-1` must not be triggered by `CP-15-H1` (EC1), and a task id containing
  regex characters must not be triggered by a lookalike (S1). Both depend on `ownsLine` keeping its
  escaping and boundary checks.
- **Multi-repo output.** The trigger looks at the whole combined output across `# repo` blocks.
  A task that prefixes its tests in one repo and leaves them bare in another goes red for the bare
  ones (EC2). That is consistent with the rule, and the message names the bare test.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Gate level: fixture project with TD-001 and TD-002 specs, whose test command replays the measured Vitest TAP (TD-001's 13 bare tests, TD-002's 12 prefixed, no S1). Run `testCommand` for TD-002 | exit 1; output contains "chỉ tìm thấy 12 đã chạy", the ID S1, and the line `S1 renders a script tag as text, not markup`; `readGate` gives `exitCode` 1, `ranIdCount` 12, `missingIds` `["S1"]`, `seenOnBareLines` `["S1"]` | P0 |
| H2 | Happy | Same fixture with a passing `TD-002-S1 …` line added | exit 0, output "13/13 test cases đã chạy", `seenOnBareLines` empty | P0 |
| H3 | Happy | H1's output, read for advice | the hint contains `TD-002-S1`; output has no "Không tìm thấy dấu vết", no "Khớp nhiều test khác nhau" and no "reporter không in tên" line | P0 |
| H4 | Happy | Parser level: `extractRanIds` on H1's TAP with `taskId` TD-002 (H1 covers the same case at gate level) | `ran` has the 12 prefixed IDs and not S1; `seenOnBareLines` is `["S1"]`; `bareMatches.S1` is `["S1 renders a script tag as text, not markup"]` | P0 |
| H5 | Happy | Docs: SKILL.md "Cách Compass đếm test ID", README and `docs/huong-dan.md` | each states that once a task names a test with its task id, bare-named tests do not count for it; a test reads the three files and finds the sentence | P2 |
| V1 | Validation | Single-task project, TD-001 only, all 13 tests bare (the `examples/todo` suite as committed) | exit 0, "13/13"; `gate.json` fields equal today's apart from an empty `seenOnBareLines` | P0 |
| V2 | Validation | Single-task project, TD-001 only: `TD-001-H1 …` prefixed, the other 12 tests bare | exit 1; the 12 bare IDs are in `seenOnBareLines`, each followed by its test name; H1 counts | P0 |
| V3 | Validation | Task id mentioned outside the ownership form: passing `H1 writes TD-002.log` and bare `S1 …`, task TD-002 | rule not triggered; `ran` is `H1, S1`, the same result as on HEAD | P1 |
| E1 | Error | `TD-002-H1` passes, `TD-002-S1 … # SKIP`, bare `S1 renders …` passes, suite exit 0 | exit 1 (today exit 0); S1 is in `seenOnNonPassLines` and in `seenOnBareLines`; output names both | P0 |
| E2 | Error | Parser called with `taskId` TD-002 and `knownTasks` `null`, then with `taskId` `null`, on H1's TAP | first call: S1 in `seenOnBareLines`, not in `ran`; second call: S1 in `ran`, the same result as on HEAD | P1 |
| EC1 | Edge | Task CP-1 on output `CP-15-H1 a`, `S1 bare`, with `knownTasks` CP-1 and CP-15 | CP-15's prefix does not trigger CP-1's rule; `ran` is `["S1"]` and `seenOnOtherTasks` is `["H1"]`, as on HEAD | P0 |
| EC2 | Edge | Two repos: `# repo be` with `TD-002-H1 x`, `# repo fe` with bare `S1 y`, task TD-002 | S1 is not counted; `bareMatches.S1` is `["S1 y"]`; exit 1 | P1 |
| EC3 | Edge | Task uses prefixes and S1 has two bare lines (`S1 a`, `S1 b`), none claimed | S1 is in `seenOnBareLines` with both names, and absent from `collided` | P1 |
| EC4 | Edge | Each ownership form triggers the rule: `TD-002: H1`, `[TD-002] H1`, `TD-002 — H1`, plus bare `S1 z` | in all three runs S1 is in `seenOnBareLines` and H1 is in `ran` | P1 |
| EC5 | Edge | A third task TD-003 in H1's fixture whose spec says `Kiểm tra bằng: mắt`: once with only bare matches for its IDs, once with a passing `TD-003-H1 …` line added | first run: exit 0 and "máy không đo gì", as on HEAD; second run: exit 2 with the contradiction message, as on HEAD | P1 |
| EC6 | Edge | TD-001 (no prefix) in the H1 fixture, where TD-002's tests carry its prefix | output and `collidedIds` identical to HEAD: 11 IDs collide and exit 1. The mirror rule is deliberately not added | P1 |
| S1 | Security | Task id `T.1` on output `TX1-H1 a`, `S1 bare`, with `knownTasks` `T.1` | `.` is not a wildcard: the rule is not triggered and S1 is in `ran` | P1 |
