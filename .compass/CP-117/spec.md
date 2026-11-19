# CP-117: the source hash reads only files git knows, not ignored folders
Loại: bug
Gốc soi: 75eef94
Phạm vi: lib/source-hash.mjs, skills/compass/SKILL.md, test/

## Mục tiêu

Every gate and `done` call `hashSource(root)`, which reads every file under the Compass root except
eight fixed folder names. It ignores `.gitignore`. On one multi-repo project it reads a 4.7 GB Python
`.venv` (35,487 files), a PHP `vendor` folder (334 MB) and 50,015 leftover test files of which git tracks
14. One call did not finish in 10 minutes there, and a single `compass check` makes several calls; the
secrets gate alone took 14 minutes. Listing the same project's files with git takes about 10 s in total
(`git ls-files` on 17 repositories, measured).

Done means:

- **Git decides what is source.** When the root is inside a git work tree, the hash covers the files git
  lists as tracked or as untracked-and-not-ignored, under the root, that exist on disk as regular files.
  Repositories nested under the root with their own `.git` folder (multi-repo projects) and submodules
  are listed the same way with their own git. Ignored files are not read.
- **Ignored `.env` files still count by size**, as today: a `.env` that `.gitignore` hides still changes
  the hash when its size changes, and its content is never read (CP-40).
- **What stays the same.** The eight skipped folder names (`.compass`, `.knowledge`, `node_modules` and
  the rest) stay skipped even when git tracks files in them. Symlinks are not followed. Linked worktrees
  inside the tree stay skipped (CP-60). The 5 MB rule and the digest format are unchanged, so a tree with
  no ignored files outside those folders hashes byte-identically to today.
- **Fallback.** Not a git work tree, or any git listing fails: the hash walks the tree exactly as today.
  Never fewer files because git failed.
- The skill says that the source hash, like the secrets gate, follows `.gitignore`.

Records written before this change stay valid wherever the tree has no ignored files outside the skipped
folders; elsewhere `done` asks for one more `compass check`.

## Ràng buộc

- Zero dependencies, Node built-ins only; git is already required by the secrets gate.
- Gates never open `.env` files.

## Rủi ro hồi quy

- All gates, `done`, review and preflight compare this hash: any difference between two calls on an
  unchanged tree makes `done` report changed code after a green check.
- CP-60 worktree skip, CP-40 `.env` size rule, the 5 MB rule, unreadable files counting as changed.
- Tests that hash temporary folders without git must keep the walk.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Git repo whose .gitignore lists .venv/, change a file inside .venv | the hash does not change | P0 |
| H2 | Happy | Same repo, change a tracked file | the hash changes | P0 |
| H3 | Happy | Same repo, add a new file that is not ignored and not committed | the hash changes | P0 |
| H4 | Happy | Root git with a nested repo that has its own .git and ignores vendor/ | changing nested vendor leaves the hash unchanged; changing a tracked file of the nested repo changes it | P0 |
| V1 | Validation | Tree with no ignored files outside the skipped folders, hashed as a git repo and as a copy without .git | both hashes are equal | P0 |
| V2 | Validation | Git tracks a file under .compass and one under dist | changing either leaves the hash unchanged | P1 |
| E1 | Error | Folder that is not a git work tree, with a .gitignore listing tmp/ | changing tmp/x changes the hash (walk as today) | P0 |
| E2 | Error | A .git file pointing at a missing git folder, so git listing fails | the hash falls back to the walk and does not throw | P1 |
| E3 | Error | A tracked file deleted from disk | the hash changes and does not throw | P1 |
| EC1 | Edge | An ignored .env file | a size change changes the hash; a same-size content change does not | P0 |
| EC2 | Edge | A linked worktree inside the repo, untracked and not ignored | changing a file in it leaves the hash unchanged | P1 |
| EC3 | Edge | File names with spaces and Vietnamese letters | changing such a file changes the hash | P2 |
| EC4 | Edge | The Compass root is a subfolder of a git repo | a change outside the root leaves the hash unchanged | P1 |
| S1 | Security | A tracked symlink pointing to a file outside the root | changing the target leaves the hash unchanged; the target is never read | P1 |
| P1 | Performance | A git repo with an ignored folder of 5,000 files and 50 source files | hashing it takes at most a fifth of the time of the walk on the same tree without .git, best of 3 | P1 |
