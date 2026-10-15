# CP-52: In a repo with a single commit, the first commit is never reviewed
Loại: bug
Phạm vi: lib/review-brief.mjs, commands/review.mjs, test/review-brief-first-commit.test.mjs (mới), test/review-command.test.mjs
Gốc soi: f94ebdd

## Mục tiêu

`resolveBase` falls back to the repository's first commit when no main branch gives a branch point,
but refuses that fallback when the first commit *is* HEAD (`lib/review-brief.mjs:102`) and returns the
literal string `'HEAD'` instead (`:105`). A repo with exactly one commit — what a developer has the
first time they try Compass on a fresh `git init` — therefore diffs HEAD against itself plus the working
tree. Only uncommitted work is ever reviewed; whatever went into the first commit is invisible to
`review` and to `secrets`, which shares `collectDiff`.

Measured on HEAD (f94ebdd) with throwaway repos, no Compass config beyond `{ "test": "true" }`:

| Repo | What `collectDiff` returns |
|---|---|
| 1 commit holding `src/a.js`, clean tree | `ok: false`, `ly_do: 'empty'`, "Không có thay đổi nào để soi" — `review` exits 2 |
| same, plus untracked `src/b.js` | `ok: true`, `base: "HEAD"`, `files: ["src/b.js"]` — `src/a.js` absent |
| 2 commits (`src/a.js`, then `src/b.js`) | `base` = the root commit, `files: ["src/b.js"]` |
| 0 commits, untracked `src/a.js` | `ok: false`, "Repo chưa có commit nào — commit lần đầu rồi mới soi được." |

`secrets` on the same shapes:

| Repo | `secrets` |
|---|---|
| 1 commit whose `src/cfg.js` calls `readFileSync('.env')`, spec has no `Dùng .env:` | **exit 0, PASSED** |
| same line, uncommitted, on top of an empty first commit | exit 1 (reason 3) |
| same line in a second commit | exit 1 (reason 3) |
| 1 commit that tracks `.env` | exit 1 — reason 1 reads `git ls-files`, not the diff, so it survives |

So the `review` side fails closed ("no changes", exit 2), but the `secrets` side does not: reason 3 —
the only reason guarded by a reviewer's signature — goes green over an undeclared `.env` read that sits
in the first commit. That is the half of this bug that can turn a gate green by mistake.

A declared base cannot route around it. `Gốc soi:` goes through `safeRef`, which requires `^{commit}`,
and nothing comes before the first commit. Declaring the only commit gives "Gốc soi đang trùng HEAD …
Trỏ nó vào commit ngay TRƯỚC khi task bắt đầu" — advice that cannot be followed in this repo.

Done means: when no base is declared and HEAD has no parent, `collectDiff` diffs against git's empty
tree, so the first commit plus the working tree are both in the diff for `review` and `secrets`. The
empty tree id comes from git (`git hash-object -t tree --stdin` on empty input), never a hard-coded
sha: in a SHA-256 repository it is `6ef19b41…`, not `4b825dc…` (measured with `git init
--object-format=sha256`, git 2.39.2). The brief says in words that the diff starts from the empty tree.
Repos with two or more commits, and repos with zero commits, behave exactly as on f94ebdd.

## Ràng buộc

- Only the "nothing to branch from and HEAD is the root" branch of `resolveBase` changes. The
  main-branch merge-base search, the root-commit fallback for repos with ≥2 commits, and every
  declared-base check (`-` prefix, type, `safeRef`, ancestor of HEAD) are untouched.
- A declared `Gốc soi:` or `reviewBase` still accepts commits only. This task does not add a way to
  declare the empty tree; the auto-resolved path is the fix. What changes for a declared base is one
  hint: when a declared base equals HEAD, the diff is empty and HEAD has no parent, the message says
  the repo has a single commit and that removing the `Gốc soi:` line makes Compass review from the
  empty tree — instead of asking for a commit before the first one.
- The empty tree id is asked of git in the repository being diffed, once per `collectDiff` call. It
  works whether or not the empty tree object exists in `.git/objects` (`git cat-file -t` reports
  `tree` for it in a fresh repo — git knows it without storing it).
- `collectDiff(root, {...})` keeps its signature. The return shape only gains a field (for example
  `fromEmptyTree: true`) that `buildBrief` uses for its wording; `base` holds the empty tree id, not
  the string `'HEAD'`.
- The brief keeps the sentence "Compass tự lần ra, vì không ai khai gốc soi." — `CP-36-H3` asserts it
  on a one-commit fixture — and adds one line saying the diff starts from the empty tree because the
  repo has a single commit, so the first commit is reviewed too.
- `EXCLUDED`/`OWN_STATE` filtering, the scratch index, `ADD_BATCH_CHARS` batching and the 2MB limit are
  untouched. The `.compass/` files that a first commit usually carries (config, spec) stay out of the
  diff.
- `secrets.mjs` is not edited. It picks the change up through `collectDiff`, which is the point of
  sharing it.
- No new dependency.

## Rủi ro hồi quy

- **`CP-6-E2` encodes the bug.** Its fixture is a one-commit repo holding `src/filter.js` with a clean
  tree, and it asserts "Không có thay đổi". After the fix that repo has a file to review. The test's
  intent — nothing changed, nothing to brief — is kept by making its single commit hold only
  `.compass/` files: then the diff against the empty tree is empty and the message is the same. The
  test is rewritten that way, not deleted.
- **Most of `test/review-command.test.mjs` runs on a one-commit `makeRepo()`.** 64 call sites, most of them adding no further commit. Their briefs
  will show `src/filter.js` as a new file instead of an edit. A grep finds no assertion on a `-` diff
  line of that file; assertions match file names, `x.country === country`, and injected markers, which
  are all still present. The whole file must stay green.
- **Fixtures built by `test/helpers/git-repo.mjs` `initRepo` start with an empty commit.** Their root
  tree is the empty tree, so for every test that adds no further commit the diff is byte-identical
  before and after. H4 pins this, because `secrets`, `check-done`, `multi-repo` and `integration`
  tests rely on it.
- **A first commit that is a whole imported project.** Today task one on top of it reviews only the
  uncommitted work. After the fix the brief carries the entire first commit; above 2MB both `review`
  and `secrets` refuse with the existing size message, which already names `Gốc soi`. Declaring
  `Gốc soi: <first commit>` restores today's scope (measured on f94ebdd: declared base = the only
  commit, with an untracked file, returns `files: ["src/b.js"]`). This is a deliberate trade: a gate
  that refuses with a way out is acceptable, a gate that never looks at the first commit is not. EC2
  measures both halves.
- **`secrets` gets stricter in one-commit repos.** An undeclared `.env` read in the first commit turns
  it red where it was green. That is the fix, not a side effect; E1 pins it.
- **`resolveEnd` receives the base.** It runs `safeRef(base) ?? base` and `merge-base --is-ancestor
  base end`, which would fail on a tree id. In a one-commit repo the only `Soi đến` that is an ancestor
  of HEAD is HEAD itself, which returns early as "at HEAD" before the base is touched. EC3 pins that
  path so a later change to `resolveEnd` cannot start feeding it a tree.
- **The `stagedNew` step diffs `--cached` against the base.** Against the empty tree every indexed path
  is an addition, so every tracked path would go through `add -N`. Those paths are already in the
  scratch index (it is a copy of the real one), so this must not change the diff; P1 keeps it from
  becoming slow on a large first commit.
- **Repos with ≥2 commits and repos with 0 commits.** H3 and E2 assert the returned `base`, `files` and
  reason are what f94ebdd returns.
- **Not addressed:** a repo with later commits whose task began in its first commit still cannot be
  reviewed from before that commit — the root-commit fallback excludes the root's own content, and
  `Gốc soi` accepts commits only. Declared bases in SHA-256 repositories are also out of scope:
  `safeRef` checks for 40 hex characters.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | One-commit repo holding `src/a.js`, clean tree, no base declared | `collectDiff` returns `ok: true`, `files` contains `src/a.js`, `base` equals the output of `git hash-object -t tree --stdin` on empty input, never the string `HEAD` | P0 |
| H2 | Happy | Same repo plus untracked `src/b.js` and an edit to `src/a.js` | `files` contains both; the diff text holds the edited content of `src/a.js` as added lines | P0 |
| H3 | Happy | Two-commit repo (`src/a.js`, then `src/b.js`), no base declared | `base` is the root commit sha, `files` is exactly `["src/b.js"]` — same as f94ebdd | P0 |
| H4 | Happy | Repo from `initRepo` (empty first commit) plus an untracked file | `files` and diff text are identical to what f94ebdd returns for the same repo | P0 |
| H5 | Happy | `compass review` on the H1 repo | exit 1 with a brief written; the brief lists `src/a.js`, contains "Compass tự lần ra, vì không ai khai gốc soi." and a line naming the empty tree | P0 |
| V1 | Validation | One-commit repo, spec declares `Gốc soi: <the only commit>`, clean tree | `review` exits 2; the message says the repo has a single commit and tells the reader to remove the `Gốc soi:` line; it no longer says "Trỏ nó vào commit ngay TRƯỚC" | P1 |
| V2 | Validation | Same declared base, with an untracked `src/b.js` | `ok: true`, `files` is exactly `["src/b.js"]` — a declared base is still honoured, first commit excluded | P1 |
| V3 | Validation | One commit holding only `.compass/config.json` and a spec (the rewritten `CP-6-E2` fixture), clean tree | `ok: false`, `ly_do: 'empty'`, "Không có thay đổi nào để soi"; `review` exits 2 and writes no brief | P0 |
| E1 | Error | One-commit repo whose committed `src/cfg.js` calls `readFileSync('.env')`, spec without `Dùng .env:` | `secrets` exits 1 and names `src/cfg.js` with its line number (exit 0 on f94ebdd) | P0 |
| E2 | Error | Repo with no commits and an untracked file | `collectDiff` returns `ok: false` with "Repo chưa có commit nào"; `review` exits 2; `secrets` exits 1 with the same reason — all as on f94ebdd | P0 |
| E3 | Error | One-commit repo with `.env` listed in `.gitignore` and present on disk | `secrets` passes: the empty-tree base does not pull an ignored file into the diff | P1 |
| EC1 | Edge | One-commit repo created with `git init --object-format=sha256` | `base` is the 64-hex SHA-256 empty tree id `6ef19b41…`; `files` contains the committed file | P1 |
| EC2 | Edge | One-commit repo whose first commit holds a 3MB generated text file, plus an untracked `src/b.js`; then the spec declares `Gốc soi: <that commit>` | without the declaration `review` exits 2 with "Diff quá lớn" naming `Gốc soi`, and `secrets` exits 1 with the same reason; with it `files` is exactly `["src/b.js"]` and `secrets` exits 0 | P1 |
| EC3 | Edge | One-commit repo, spec declares `Soi đến: HEAD`, untracked `src/b.js` | treated as no end declared: `ok: true`, `endAtHead: true`, `files` contains `src/a.js` and `src/b.js` | P1 |
| EC4 | Edge | One-commit repo whose commit also carries `.compass/T-1/spec.md` and `.compass/config.json` | neither path appears in `files`; `EXCLUDED` holds against the empty tree | P0 |
| EC5 | Edge | One-commit repo holding `src/a.js` and `src/c.js`, then `git rm src/c.js` (staged deletion) | `files` contains `src/a.js` and not `src/c.js` — the empty tree has nothing to delete from, and the scratch index does not resurrect it | P2 |
| S1 | Security | The real `.git/index` before and after `collectDiff` on the H2 repo | byte-identical | P1 |
| P1 | Performance | One-commit repo whose first commit holds 2000 small files, no changes | `collectDiff` returns `ok: true` with 2000 entries in `files` in under 5 s | P2 |
