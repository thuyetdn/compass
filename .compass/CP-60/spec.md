# CP-60: Gates scan agent worktrees nested inside the repo as if they were the project's code
Loại: bug
Phạm vi: lib/worktree.mjs (mới), lib/source-hash.mjs, lib/knowledge-scan.mjs, lib/rule-runner.mjs, lib/review-brief.mjs, test/worktree-skip.test.mjs (mới), skills/compass/SKILL.md, docs/huong-dan.md
Gốc soi: 4aba541

## Mục tiêu

Claude Code runs agents in worktrees at `.claude/worktrees/<name>/`, inside the repo. Each one is a
full checkout whose `.git` is a file. Compass walks the tree in three places and lists untracked
files in a fourth, and none of them knows what a linked worktree is. The lead measured it on this
repo with three worktrees present: `compass check` failed at gate `knowledge` with "Mới thêm (417):
.claude/worktrees/agent-…/cli.mjs, …". Here `.claude/` is not gitignored.

Measured on HEAD (a369838) in a scratch repo built with a throwaway script. The repo has
`src/App.jsx` (exports `Button`), `src/a.js`, a synced `.knowledge/`, and a `forbid-pattern` rule on
`**/*.js`. Then `git worktree add -b agent-x .claude/worktrees/agent-x`, plus `src/agent.js` with a
line the rule forbids and an untracked `.env`, both inside the worktree:

| Place | What happens on HEAD |
|---|---|
| `knowledge` gate (`scanComponents` walk → manifest) | exit 1, "Mới thêm (3): .claude/worktrees/agent-x/src/App.jsx, …/src/a.js, …/src/agent.js". The scan grows from 2 files to 5, and `Button.path` becomes `.claude/worktrees/agent-x/src/App.jsx`: after a sync, the KB would point at the agent's copy. |
| `convention` gate (`runRules` walk) | exit 1, one violation at `.claude\worktrees\agent-x\src\agent.js:1` — code the task never touched |
| `hashSource` (the `sourceHash` that `done` compares) | changes when the worktree is added, and again on every edit inside it. While an agent works, `done` calls every record stale. |
| `collectDiff` (review brief, and the diff `secrets` scans) | `git ls-files --others` lists the worktree as one entry, `.claude/worktrees/agent-x/`, and git does not descend into it. `add -N` stages it as a gitlink: `files` contains `.claude/worktrees/agent-x`, and the diff shows `new file mode 160000 … +Subproject commit 1a6f384…` — a submodule the task never added. The real index stays byte-identical. |
| `secrets` reason 2 (untracked `.env` inside the worktree) | exit 0, and the file is never named. Git does not list files inside a nested repo, so the `.env` never reaches the gate. Correct, and it must stay that way. |

Measured around the edges, because they decide the design:

- **Ignoring `.claude/` fixes only one of the four.** With `.claude/` in `.gitignore`, `collectDiff`
  drops the gitlink, but the knowledge scan still lists `.claude/worktrees/agent-y/src/App.jsx`. The
  walkers never read `.gitignore`. Today the guide's only workaround is to delete the worktrees
  before running gates.
- **Nested repos with a `.git` directory are scanned today.** A multi-repo layout like
  `store/backend`, with its own `git init`: the knowledge scan finds its `Card` component, and
  `runRules` reports `store\backend\src\api.js`. `lib/repos.mjs` only resolves directories from
  `config.repos`. It never looks at `.git`, and no walker skips a repo boundary.
- **Submodules are scanned today too.** `vendor/lib` added with `git submodule add` has a `.git`
  file (`gitdir: ../../.git/modules/vendor/lib`), and the knowledge scan finds its `Widget`.
- **Git marks the difference.** The worktree's admin directory (`.git/worktrees/agent-x/`) contains a
  `commondir` file; the submodule's (`.git/modules/vendor/lib/`) does not. Git itself uses that file
  to recognise a linked worktree.
- **An orphaned worktree is not a repo to git.** Delete the admin directory and `git ls-files
  --others` descends into the worktree and lists `.claude/worktrees/agent-y/src/App.jsx`.
- **Compass run inside the worktree works.** With the worktree as root, the scan sees only its own
  `src/App.jsx`, and `collectDiff` runs. Agents run gates exactly this way.

Done means: a directory that is a linked worktree — and only that — is invisible to all four
places. The knowledge scan, the convention walk and `hashSource` do not descend into it.
`collectDiff` does not `add -N` it. With the scratch repo above, `knowledge` and `convention` exit
0, `hashSource` is unchanged by adding or editing the worktree, and the brief carries no gitlink.
Nested `.git`-directory repos, submodules, and the walk root itself are scanned exactly as today.

**Why structure, not name.** Skipping `.claude/worktrees/` by name fixes the one path Claude Code
uses today and nothing else. `git worktree add .worktrees/x` or another tool's folder would still
break the gates, and the list would grow with every new name, like the `.probe-tmp/` list in
`.gitignore`. A name also hides whatever sits there when it is not a worktree. SKILL.md refuses that
trade for scratch folders ("Thư mục nháp làm gate đỏ oan": guessing by pattern misses real folders
and skips a real `.env`). A linked worktree, unlike a scratch folder, can be recognised from what is
on disk, so that objection does not apply.

**Why not every `.git` file.** A submodule has one too. Skipping it would change two behaviours that
work today: `hashSource` would stop seeing edits in a submodule, so `done` would accept stale
evidence without a word, and a `config.repos` entry that happens to be a submodule would drop out of
the knowledge scan. That may be worth deciding one day. It is not this bug.

The rule, therefore: a directory D, other than the walk root, is a linked worktree when `D/.git` is a
regular file, its first line is `gitdir: <p>`, and `<p>` (resolved against D) is a directory
containing a file named `commondir`.

## Ràng buộc

- One predicate, in `lib/worktree.mjs`, used by all four places. Three walkers that each test "is
  this a worktree" in their own way would drift the way the two `.gitignore` writers in CP-59 did.
- A `.git` **directory** never triggers the skip. Multi-repo projects keep their nested repos scanned.
- The walk root is never skipped, even when it is itself a linked worktree.
- When the predicate cannot decide — `.git` unreadable, first line not `gitdir:`, target missing, no
  `commondir` — the directory is scanned, as on HEAD. Wrong and loud (a red gate over worktree code)
  beats wrong and silent (a skipped directory holding a real `.env`). This is also how git behaves:
  an orphaned worktree is listed file by file.
- In `collectDiff`, drop only untracked entries that git lists as a directory (trailing `/`, meaning
  git saw a nested repo) **and** that satisfy the predicate. Files git lists one by one are never
  dropped. The scratch-index rules from CP-46 stay: `GIT_INDEX_FILE` in a temp directory, real index
  byte-identical, `EXCLUDED` filtering and `ADD_BATCH_CHARS` batching unchanged.
- `commands/secrets.mjs` and `lib/secrets-scan.mjs` are not touched. Reason 2 keeps reading
  `git ls-files --others`, not a walker, so the predicate cannot hide a `.env` from it. The only
  change `secrets` sees is a diff without the gitlink.
- No git process per directory. The predicate reads at most one small file, and only for directories
  that contain a `.git` file. A directory without `.git` costs nothing extra.
- Skipped worktrees add no output line to `knowledge` or `convention`. Their output stays as it is.
- `hashSource` of a tree with no linked worktree keeps its exact value, or every gate record written
  before the fix turns stale for no reason.
- Out of scope, measured on the way: a nested repo with a `.git` directory and **no commit** makes
  `git add -N -- be/` fail, so `collectDiff` returns "Không lấy được diff" and `secrets` goes red.
  It exists on HEAD with no worktree involved. It deserves its own task, and this one must not make
  it worse.
- A known limit: a hand-made `.git` file that points at any directory containing `commondir` hides
  its directory from the three walkers (not from `secrets` reason 2, which asks git). Compass guards
  against accidents, not deliberate evasion — the boundary SKILL.md states under "Hai giới hạn còn
  lại".
- SKILL.md says what is skipped and why. The list "`node_modules`, `dist`, `build`, `coverage`, `.git`
  không bị quét" gains linked worktrees. The "Thư mục nháp" paragraph says a worktree from
  `git worktree add` is recognised and needs no `.gitignore` line, while a scratch folder without
  `.git` still does. The "Worktree của agent nằm trong repo" bullet in `docs/huong-dan.md` (Giới
  hạn) is removed or rewritten to match.

## Rủi ro hồi quy

- **Multi-repo nested repos vanish from the gates.** A rule written too wide (any nested `.git`)
  would drop `store/backend` from `convention@store/backend`, the knowledge scan, and `hashSource`. V2
  measures all three.
- **Submodules change behaviour.** Skipping every `.git` file would make `hashSource` blind to
  submodule edits and drop submodule components from the KB. V1 pins today's behaviour.
- **An agent running Compass inside its own worktree sees an empty project.** That happens if the
  root is tested like a child. EC1 runs all three walkers with the worktree as root.
- **A name-based shortcut sneaks in.** V3 (a worktree at `.worktrees/feature`) must be skipped, and
  EC3 (a plain folder named `.claude/worktrees/notes/` with no `.git`) must be scanned. Either
  shortcut fails one of them.
- **Orphaned worktrees get skipped silently** while git lists their files. E2 asserts they are
  scanned, and that `secrets` names the `.env` inside.
- **`sourceHash` drifts for every project.** Changing the walk must not change the hash of a tree
  without worktrees. H3 pins the exact value HEAD computes for a fixed fixture:
  `sha256:dceccdfb18c073cfb213b9dc8fffb003d92c2b539741d23254d676e653fde46c`.
- **The knowledge manifest of a project synced while worktrees were present** lists worktree paths.
  After the fix the gate turns red once, with those paths under "Đã xóa", until `--sync`. That is
  intended and loud; EC5 pins it.
- **`collectDiff` loses ordinary new files**, staged files, or touches the real index. H4 covers new
  files and the index; `test/review-brief-staged.test.mjs`, `test/review-command.test.mjs`,
  `test/review-compass-scope.test.mjs` and `test/review-brief-first-commit.test.mjs` stay green.
- **`secrets` output changes.** EC4 pins that a `.env` inside a live worktree is still not reported;
  `test/secrets-command.test.mjs` and `test/secrets-scan.test.mjs` stay green.
- **The walk gets slower.** `test/growth.test.mjs` (CP-55's knowledge-scan growth) stays green.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Scratch repo with synced `.knowledge`, then a linked worktree at `.claude/worktrees/agent-x` holding an extra `.jsx` | `compass knowledge` exits 0; `scanComponents(root).files` has no path starting `.claude/worktrees/`; `Button.path` is `src/App.jsx` | P0 |
| H2 | Happy | `no-debugger` rule (`pattern: debugger`) on `**/*.js`; a `debugger;` line only inside the worktree, then a second one in `src/b.js` | first run: `compass convention T-1` exits 0. Second run: exits 1, names `src/b.js`, and no output line contains `worktrees` | P0 |
| H3 | Happy | `hashSource` on the fixed fixture (`src/App.jsx`, `src/a.js` with the scratch contents), then after `git worktree add`, then after editing a worktree file, then after editing `src/a.js` | the first three equal `sha256:dceccdfb18c073cfb213b9dc8fffb003d92c2b539741d23254d676e653fde46c`; the fourth differs. At command level, the `sourceHash` in the `knowledge` record equals `hashSource(root)` after the worktree edit | P0 |
| H4 | Happy | Untracked linked worktree plus an untracked `src/new.js`, then `collectDiff` | `files` contains `src/new.js` and not `.claude/worktrees/agent-x`; the diff has no `Subproject commit`; `.git/index` byte-identical before and after | P0 |
| V1 | Validation | Submodule `vendor/lib` (`.git` file, admin dir without `commondir`) holding `Widget.jsx` | knowledge scan lists `vendor/lib/Widget.jsx`; editing it changes `hashSource` — as on HEAD | P0 |
| V2 | Validation | Multi-repo project, nested repo `store/backend` with a `.git` directory, declared in `config.repos` | `convention@store/backend` reports `src/api.js`; the knowledge scan lists `store/backend/src/Card.jsx`; editing it changes `hashSource` | P0 |
| V3 | Validation | Linked worktree at `.worktrees/feature`, created with `git worktree add` | skipped by the knowledge scan, `runRules` and `hashSource`, and absent from `collectDiff` `files` — the rule follows structure, not a name | P0 |
| E1 | Error | A directory whose `.git` is a file containing `hello` (no `gitdir:` line) and a `.js` file with a `debugger;` line | the directory is scanned: `convention` reports the file; no throw | P1 |
| E2 | Error | Orphaned worktree: its admin dir under `.git/worktrees/<name>` deleted; an untracked `.env` inside | all three walkers scan it; `compass secrets T-1` exits 1 with reason 2 naming that `.env` — git lists it, so the gate must too | P0 |
| EC1 | Edge | Compass root is itself the linked worktree (`.git` file at the root) | `scanComponents` lists `src/App.jsx`; `runRules` reports a violation inside it; editing it changes `hashSource` | P0 |
| EC2 | Edge | Multi-repo project with a linked worktree inside a declared repo, `fe/.claude/worktrees/x` | `convention@fe` reports nothing from it; the knowledge scan from root lists none of its files | P1 |
| EC3 | Edge | Plain folder `.claude/worktrees/notes/` with no `.git`, holding a `.js` with a `debugger;` line and a `.env` | `convention` reports the `.js`; `compass secrets T-1` exits 1 with reason 2 for the `.env` — nothing is skipped by name | P0 |
| EC4 | Edge | Untracked `.env` inside a live linked worktree | `compass secrets T-1` exits 0 and its output does not contain that path — unchanged from HEAD | P1 |
| EC5 | Edge | Manifest written with worktree paths in `sources` (the state left by a sync on HEAD while a worktree existed) | `compass knowledge` exits 1 listing those paths under "Đã xóa"; after `--sync` it exits 0 | P1 |
| EC6 | Edge | Three linked worktrees, each a full checkout of the scratch repo | knowledge scan file count equals the count with no worktree; `compass knowledge` exits 0 — the shape of the lead's "Mới thêm (417)" | P1 |
