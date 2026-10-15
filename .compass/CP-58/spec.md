# CP-58: A guide, a README that tells the truth, and a demo video recorded from real runs
Loại: feature-s
Phạm vi: README.md, docs/huong-dan.md (mới), docs/demo/ (mới), test/release-docs.test.mjs (mới), examples/todo/README.md, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, package.json
Gốc soi: f94ebdd

## Mục tiêu

Compass is about to go to the team's developers to try and evaluate. What they would find today
on HEAD f94ebdd:

| Thing | State |
|---|---|
| README "Trạng thái" | says "Bảy gate" and lists seven; `lib/gates.mjs` implements eight (`secrets` missing) |
| README install | `/plugin marketplace add <đường-dẫn-tới-repo>` — a placeholder, not a command |
| A usage guide | none; SKILL.md is written for the AI, 500+ lines, not for a developer's first hour |
| What Compass does and does not prove | scattered across SKILL.md sections "Giới hạn" |
| A demo | none |
| Versions | `plugin.json` and `marketplace.json` say 3.0.0, `package.json` says 0.1.0 |
| README links | point into `docs/superpowers/`, which the release branch will not carry |

Done means a developer who knows code but not Compass can, from `docs/huong-dan.md` alone, install
it, run a first task on `examples/todo` to `done`, understand what each gate catches, and know
exactly what a green `done` does **not** prove. README is accurate against the code. A short video
shows one task from `init` to `done`, including one red gate and its fix, made from commands that
really ran — with a check that fails if the video would show a result the command did not return.

Audience of the guide: developers on the team, Vietnamese.

## Ràng buộc

- **The video shows only real output.** A recording script runs the real `compass` CLI on a temp
  copy of `examples/todo`, captures stdout and exit code of every step, and renders that captured
  text in a terminal-style page that Playwright records to `.webm`. Steps an AI does inside Claude
  Code (writing the spec, writing code) appear as captions marked as such, never as a fabricated
  chat transcript. If any step's real exit code differs from what the scenario expects, the script
  stops and no video is written.
- **Output format is `.webm`.** No ffmpeg on this machine; Playwright's bundled recorder writes
  VP8/webm. The guide says how to convert if someone needs mp4.
- **The recording never writes into the repo's `examples/todo`.** Evidence, baselines and
  `node_modules` changes happen in the temp copy.
- **No local identity in shipped artifacts.** No absolute path of this machine (`D:\`, `C:\Users\`),
  and no email, in README, guide, transcript or video text.
- **Zero runtime dependency is kept.** Playwright is used only by the recording script, resolved
  from `examples/todo`, as the `ui`/`visual` gates already do.
- **The guide does not oversell.** Its "giới hạn" section carries every limitation SKILL.md states
  as current (text scan not AST, `config.json` trusted, `done` reads records not code, visual
  font-rendering noise, multi-repo status as it stands after CP-56), worded for a developer.
- The dogfood cleanup of the release branch (removing `.compass/CP-*`, `INV-*`, `docs/superpowers/`)
  is **not** part of this task's diff: it happens as one mechanical commit on `main` after all tasks
  close, verified by running `npm test` and `npm run test:deep` there. This task only makes sure
  nothing shipped links into those paths.
- Version is unified to the plugin's 3.0.0 — the number users already have installed.

## Rủi ro hồi quy

- **`test/wording.test.mjs`** scans shipped Vietnamese docs for clipped words; the new guide and
  the README rewrite fall under it and must keep it green (V3 measures the guide directly).
- **`npm install -g .` and `bin`.** Changing `package.json` (version) must not touch `bin`,
  `files` or `scripts`; H6 pins `files` still ships `skills/` and `cli.mjs`.
- **Plugin install.** `marketplace.json` `source: "./"` and plugin name `compass` stay, or every
  existing install breaks on update. V2 pins name and version agreement.
- **`examples/todo` and `test:deep`.** The deep suite drives `examples/todo`; the recorder must not
  leave files in it (S2), or the next deep run starts from a dirty tree.
- **README sections other tests read.** Reporter table and the `T-12-H1` naming example are
  referenced by users; they stay.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | README's gate count word and gate list vs `IMPLEMENTED_GATES` in `lib/gates.mjs` | same count, same names | P0 |
| H2 | Happy | Every `compass <cmd>` (or `node …/cli.mjs <cmd>`) mentioned in `docs/huong-dan.md` | each `<cmd>` is a command `cli.mjs` dispatches | P0 |
| H3 | Happy | Every relative markdown link in README.md, docs/huong-dan.md, examples/todo/README.md | each target file exists in the repo | P0 |
| H4 | Happy | `docs/demo/compass-demo.webm` | exists, starts with EBML magic `1A 45 DF A3`, size between 100 KB and 15 MB | P0 |
| H5 | Happy | `docs/huong-dan.md` headings | contains sections for: cài đặt, task đầu tiên, các gate, Compass chứng minh gì / không chứng minh gì, giới hạn, góp ý | P0 |
| H6 | Happy | `package.json` after the version change | `bin`, `files`, `scripts` byte-identical to HEAD f94ebdd; `files` includes `cli.mjs` and `skills/` | P1 |
| V1 | Validation | README install section | no `<…>` placeholder in a command line; marketplace command names `thuyetdn/compass` | P0 |
| V2 | Validation | Versions in `package.json`, `plugin.json`, `marketplace.json` plugins[0]; plugin name in both manifests | all versions equal; both names `compass` | P0 |
| V3 | Validation | `docs/huong-dan.md` against the clipped-word patterns used by `test/wording.test.mjs` | zero standalone `ca` / clipped `kiểm` | P1 |
| E1 | Error | Recorder run with a scenario whose step expects exit 0 for a command that really exits 1 | recorder exits non-zero, names the step and both codes, writes no `.webm` | P0 |
| E2 | Error | Recorder run with Playwright unresolvable | exits 2 with an install hint (`npm install -D playwright`), no stack trace | P1 |
| EC1 | Edge | Links with `#anchor` in README and guide | the anchor matches a heading slug in the target file | P1 |
| S1 | Security | Captured transcript, README, guide | no absolute path of this machine (`[A-Z]:\\`, `/Users/`, `C:\\Users`), no email address | P0 |
| S2 | Security | Repo `examples/todo` tree before vs after a recorder run (git status of that path) | unchanged — nothing written into the repo copy | P0 |
