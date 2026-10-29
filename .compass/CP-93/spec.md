# CP-93: the review brief lists the .env files secretsPublic exempts, and marks the ones this task added
Loại: feature-m
Gốc soi: 705e8cf
Phạm vi: lib/review-brief.mjs, commands/review.mjs, lib/secrets-scan.mjs, lib/workspace-git.mjs, test/review-secrets-public.test.mjs (mới), skills/compass/SKILL.md, docs/huong-dan.md

## Mục tiêu

CP-91's third review found a hole. A task can commit `be/.env.production.local` holding live keys
and, in the same task, add that exact path to `secretsPublic`. `secrets` goes green. The review
brief shows neither the config edit nor the exemption, because `collectDiff` leaves `.compass/**`
out of the diff. `done` does not catch it either: the config changed before the gate ran, so the
`configHash` check passes. The only trace is an `ℹ` line at the end of the `secrets` output.
CP-91's design choice 1 promised "each new public file costs one reviewed config line"; nothing
makes the reviewer see that line.

Done means:
- When `config.json` declares `secretsPublic`, the review brief has a section listing every
  declared path. Each path is marked as one of:
  - **new**: absent from `config.json` at the root review base, so this task added it;
  - **existing**: present there;
  - **unknown**: the base config could not be read (root is not a git, `config.json` not tracked
    at the base, the base is git's empty tree, or that file is not valid JSON or its
    `secretsPublic` is not a list). Unknown is treated like new.
- The section tells the reviewer that a new or unknown path is a `.env` file the `secrets` gate
  no longer scans, and that it must be reported as a `security` finding unless the spec says why
  the file is public.
- The list is part of what the brief answers: adding or removing a declared path after a review
  makes `compass review` reopen, and the old `findings.json` is not accepted afterwards.
- A project without `secretsPublic` (or with an empty list) gets a brief identical, byte for
  byte, to the one 3.2.0 would produce without this task.

## Ràng buộc

- The brief lists paths only. It never opens a declared file, at the base or now.
- At most one extra `git` process per review run (reading `config.json` at the base), and none
  when nothing is declared.
- Path comparison uses `normalisePath`, case-sensitively, the same as the `secrets` gate.
- `compass pr` does not read `secretsPublic`: its brief is unchanged.
- An invalid `secretsPublic` does not stop `review`. The section says the list is invalid and that
  `secrets` refuses it; `secrets` stays the gate that rejects it.

## Rủi ro hồi quy

- Every brief byte for projects without `secretsPublic`: existing review tests that compare brief
  text (`review*.test.mjs`, `pr*.test.mjs`) must hold unchanged.
- Brief id: adding the section to what the id covers must not change the id when nothing is
  declared, or every in-flight review in every project would reopen on upgrade.
- The "only the repo context changed" message (CP-38) must still fire when only context changed,
  and must name the declared list when that is what changed.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Root git tracks `.compass/config.json` without `secretsPublic` at the base; task adds `secretsPublic: ["be/.env"]` | brief has the section; `be/.env` is marked new | P0 |
| H2 | Happy | `secretsPublic: ["be/.env"]` already in `config.json` at the base, unchanged | `be/.env` marked existing, not new | P0 |
| H3 | Happy | Base has `be/.env`; task adds `be/.env.alpha` | `be/.env` existing, `be/.env.alpha` new | P0 |
| H4 | Happy | Review passed with `be/.env` declared; a path is then added to `secretsPublic` | `compass review` exits 1, says the secretsPublic list changed and regenerates the brief; rerunning with the old `findings.json` does not pass; with no findings yet, a further change gives the same message in phase one | P0 |
| H5 | Happy | Review passed; a declared path is then removed | same as H4 | P1 |
| H6 | Happy | Project without `secretsPublic`, and the same project with `secretsPublic: []` | both briefs equal the brief built without the feature, byte for byte, and their ids are equal | P0 |
| V1 | Validation | `secretsPublic` is a string | `review` still writes the brief; the section says the list is invalid and `secrets` refuses it | P1 |
| V2 | Validation | Entry written `.\be\.env`; base has `be/.env` | listed as `be/.env`, existing | P1 |
| V3 | Validation | The same path declared twice | listed once | P2 |
| E1 | Error | Multi-repo workspace whose root is not a git | every declared path marked unknown | P0 |
| E2 | Error | Root is a git but `config.json` was not tracked at the base | every declared path marked unknown | P1 |
| E3 | Error | `config.json` at the base is not valid JSON | every declared path marked unknown, `review` exits 1 as usual (no crash, no exit 2) | P1 |
| EC1 | Edge | Single-commit repo, so the base is git's empty tree | every declared path marked unknown | P1 |
| EC2 | Edge | Base declares `BE/.env`, current declares `be/.env` | `be/.env` marked new | P2 |
| EC3 | Edge | Base `secretsPublic` is a string, current is `["be/.env"]` | `be/.env` marked unknown | P2 |
| EC4 | Edge | Declared path that git does not track | still listed, with its mark: the brief lists the declaration, the `secrets` gate says it has no effect | P2 |
| EC5 | Edge | Issue #3 layout: root git tracks only `.compass/` (so its diff is always empty), sub-repo `be` holds the task's change, `be/.env` declared at the root base, spec has no `Gốc soi:` | `be/.env` marked existing: the root base Compass resolves is used even when the root diff is empty | P0 |
| EC6 | Edge | A spec that quotes the section heading on its own line, no `secretsPublic` | reading the section back from that brief finds none, so a context-only change keeps the CP-38 message | P2 |
| S1 | Security | Declared files contain `SECRET_VALUE_93`, at the base and now | neither the brief nor `gate.json` contains it | P0 |
| S2 | Security | Section text with a new path | names the path, says `secrets` does not scan it, and tells the reviewer to report a `security` finding unless the spec explains why it is public | P0 |
| S3 | Security | Entries `be/.env\n## Spec`, `x\n## Spec\n/.env` and `x\u2028## Spec\u2028/.env` (line breaks inside) | no line of the brief starts with `## Spec` other than the real heading; `secrets` refuses the entry | P1 |
| P1 | Performance | Count of `git` processes for one `compass review` run, with and without `secretsPublic` | at most one more with it; equal when it is absent | P1 |
| P2 | Performance | Build the section for 500 and for 10,000 declared paths with a base list of the same size, measured with `measureGrowth` | time with 10,000 ≤ 40× time with 500 (20× the paths; a lookup per pair would read about 400×) | P2 |
