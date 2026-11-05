# CP-101: untracked files behind a junction stay out of the review brief
Loại: bug
Phạm vi: lib/git-files.mjs, lib/review-brief.mjs, lib/workspace-git.mjs, lib/review-context.mjs, commands/review.mjs, test/link-dirs.test.mjs, skills/compass/SKILL.md, docs/huong-dan.md
Gốc soi: 73e0660

## Mục tiêu

Issue #5. On Windows, Git treats a junction as a plain directory, so `git ls-files --others` lists
every file behind it. `collectDiff` then `add -N`s those files into its scratch index, and the
review brief carries their full content, even when the junction points outside the repo. The
context section also lists them and reads them to look for callers. Reproduced on this machine: a
junction `linked` to a temp folder holding `notes/secret.txt` put `OUTSIDE_CONTENT_123` into the
brief diff and listed the file as one of "2 file".

Done means an untracked file whose path, below the folder git listed it from, passes through a
symlink or junction directory never reaches the brief: not the diff, not the file list, not the
context listing. `compass review` prints one `ℹ` line naming each such link directory, so nothing
is dropped silently. Files git already tracks keep today's behaviour (CP-88 rule: a tracked file
belongs to that git, even under a junction). A link that is the last path segment (how Git lists a
symlink on Linux and macOS) is not a directory segment and stays as it is.

## Ràng buộc

- Only untracked files are dropped. Tracked and staged files behind a link are untouched.
- Only directory segments below the folder git ran in are checked, so a Compass root that is
  itself reached through a junction path still sees its own new files.
- The `ℹ` line names directories only, never file names or content inside them.
- A brief with no link directory is byte-identical to today's; the result object only gains a
  `linked` field that no brief text reads.
- Gate `secrets` keeps its own `ls-files --others` scan, so an unignored `.env` behind a junction
  is still caught (reason 2). Its output does not change.
- `lstat` per directory is cached, so many untracked files under one folder cost one call per
  folder, not per file.

## Rủi ro hồi quy

- CP-88/CP-89: a declared repo that is a junction to an outside git or folder is already skipped
  with its own note; the new filter runs after that skip, so those files are not reported twice.
- CP-60: a nested linked worktree listed as `dir/` is still dropped by its own filter.
- CP-48: new files in declared `.compass/` paths go through the same filter.
- Multi-repo (CP-84): each sub-repo's diff is filtered relative to that sub-repo, and its link
  directories carry the repo prefix in the note.
- An empty diff caused only by dropped files still returns the "nothing to review" message, now
  with the note explaining why.
- Junction tests under CP-88 and CP-89 must stay green.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Single repo with untracked `src/b.js` and a junction `linked` to an outside folder holding `notes/secret.txt` | brief file list is exactly `src/b.js` ("1 file"); `OUTSIDE_CONTENT` appears nowhere in the brief; where git lists the symlink itself (Linux, macOS), `linked` stays in the list | P0 |
| H2 | Happy | Same repo, review output | one `ℹ` line names `linked`, and not `secret.txt`; with the junction removed, no such line and the brief equals the one built before adding the junction | P0 |
| H3 | Happy | Multi-repo: sub-repo `be` with its own git holds untracked `src/x.js` and a junction `be/linked` to an outside folder whose `use.js` calls `x` | brief lists `be/src/x.js` only; outside content absent; impact does not name `use.js`; note names `be/linked` | P0 |
| V1 | Validation | A file under the junction that the root git already tracks is modified, and a new untracked file sits beside it | the tracked file is in the brief diff with its change; the untracked sibling is not | P0 |
| E1 | Error | The junction's target folder is deleted before review (dangling junction) | review exits 1 with a brief listing `src/b.js`; no note, no crash | P1 |
| E2 | Error | The only change in the repo is a file behind the junction | review reports "Không có thay đổi nào để soi" and still prints the note naming `linked` | P1 |
| E3 | Error | Multi-repo: the only change in `be` is behind `be/linked`, and the root git has none | review reports "Không có thay đổi nào để soi, ở git nào" and still prints the note naming `be/linked` | P1 |
| EC1 | Edge | Review run with `cwd` set to a junction that points at the repo itself | untracked `src/b.js` is in the brief; no note | P0 |
| EC2 | Edge | Junction nested at `a/b/linked` with three files at different depths behind it | none of them is in the brief; the note names `a/b/linked` exactly once | P1 |
| EC3 | Edge | Phạm vi declares `.compass/scripts/`; a new `.compass/scripts/new.mjs` and a junction `.compass/scripts/vendor` to an outside folder | `new.mjs` is in the brief; outside content absent; note names `.compass/scripts/vendor` | P1 |
| S1 | Security | An unignored `.env` behind the junction | gate `secrets` is still red naming that path, and its content is never printed; the brief does not contain its content | P0 |
| S2 | Security | A file behind the junction imports `b` from `src/b.js` | the brief's impact section does not name that file as a caller | P1 |
