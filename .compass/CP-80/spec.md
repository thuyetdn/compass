# CP-80: init does not ignore review-brief.md
Loại: bug
Phạm vi: lib/signature.mjs, commands/init.mjs, skills/compass/SKILL.md, test/compass-gitignore.test.mjs, test/salt-gitignore.test.mjs, test/review-brief-ignore.test.mjs (mới), .compass/.gitignore, README.md, docs/index.html

## Mục tiêu

`compass review` writes `.compass/<id>/review-brief.md` on every phase one. The brief is a throwaway
copy of the spec, the diff and the repo context, and it changes each time the code does. The
`.compass/.gitignore` that `init` writes covers `.salt` and `data/` only, so in a new project every
brief shows up in `git status` and ends up in commits. This repo hides it only because someone added
`*/review-brief.md` by hand.

Done means a project opened by `init` (or by the first gate that touches `.compass/`) ignores every
`review-brief.md` under `.compass/`. A project whose `.gitignore` is one that an older Compass wrote is
upgraded the same way, and `init` says so in one line.

## Ràng buộc

- One constant, one writer, as CP-59 set up: the new line goes into `COMPASS_GITIGNORE`, and
  `ensureCompassGitignore` stays the only place that writes the file.
- The pattern is `review-brief.md` with no slash, so git matches it at any depth under `.compass/`,
  the same way `data/` does.
- Old defaults are recognised exactly: the one-line `.salt` file and the two-line `.salt`/`data/`
  file, with LF, CRLF or no final newline. Anything else is the user's file and is not touched.
- A user's own file gets no warning about the brief: it holds no secrets, unlike `data/`. The
  existing `data/` warning stays as it is.
- `evidence/` and `findings.json` stay tracked: evidence must be reviewable (CP-59).

## Rủi ro hồi quy

- CP-59 tests pin the file content to `.salt\ndata/\n` and the upgrade line to mention `data/`. They
  change to the new default on purpose. What they check about `data/` must still hold.
- CP-59-V2 and V3: a user file must stay byte-identical, and the `data/` warning must not change.
- CP-59-EC1: running `init` and `getSalt` repeatedly must not duplicate a line.
- The salt and signature tests read `.compass/.gitignore` through `getSalt`; signing must not change.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | `init` in a new git repo, then a brief written under `.compass/T-1/` | git ignores the brief; `findings.json` and `gate.json` are not ignored | P0 |
| H2 | Happy | A project whose `.gitignore` is the two-line `.salt`/`data/` default | `init` upgrades it to the new default and prints one line naming `review-brief.md` | P0 |
| V1 | Validation | The two-line old default with CRLF, and without a final newline | both upgraded | P1 |
| V2 | Validation | A user `.gitignore` (`.salt`, `data/`, plus a line of their own) | byte-identical after `init`, no line about the brief | P0 |
| E1 | Error | The two-line old default in a read-only `.gitignore` | `init` still creates the task and does not claim it upgraded the file | P1 |
| EC1 | Edge | `init`, `getSalt`, `init`, `getSalt` on a new project | `review-brief.md` appears exactly once, file equals the default | P1 |
| EC2 | Edge | The one-line `.salt` file from the oldest Compass | upgraded straight to the new default, the line names both `data/` and `review-brief.md` | P1 |
