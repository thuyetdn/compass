# CP-66: `compass init --multi` writes a multi-repo config by reading the subfolders
Loại: feature-s
Phạm vi: commands/init.mjs, lib/repo-detect.mjs (mới), cli.mjs, test/repo-detect.test.mjs (mới), skills/compass/SKILL.md, README.md
Gốc soi: 356a052

## Mục tiêu

`SKILL.md` (line 675, "Dựng config cho dự án nhiều repo") tells the AI to read every subfolder by
hand and write `config.json` itself, and line 726 lists that missing command as a known gap. Doing
it by hand is where a lockfile gets misread and a repo gets skipped — the two failures that section
spends a page warning about.

Done means `compass init --multi` walks the subfolders, writes a `repos` block from what it finds,
and prints what it could not decide instead of guessing. The five rules already written in SKILL.md
become code: a repo with no `scripts.test` still gets an entry with a failing command, a non-Node
repo is still listed, a backend gets no `devUrl`, an existing config is never overwritten, and a
repo nested one level deep keys on its path.

## Ràng buộc

- Zero dependency — Node built-ins only, like the rest of the codebase.
- `compass init <id> --type=` keeps its exact current behaviour. `--multi` is a separate mode that
  takes no task id.
- Never overwrite an existing `config.json`: print the detected block and let the user merge.
- Detection reads files only. No install, no network, no running the repo's own scripts.
- Output is Vietnamese, matching every other command.

## Rủi ro hồi quy

- `compass init TD-1 --type=fix` must still create the task and the single-repo config exactly as
  before — CP-59 made `init` write `data/` into `.compass/.gitignore` and that must survive.
- `loadConfig`/`resolveRepos` must accept what we write; a config that `compass status` rejects is
  worse than no command, because the user believes it worked.
- Writing `repos` into a project that genuinely has one repo would turn every gate multi-repo and
  change which slots `done` requires. `--multi` on a folder with no qualifying subfolder must refuse,
  not write an empty `repos`.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Two subfolders, each with package.json + scripts.test, npm lockfile | config.json has repos.frontend.test = "npm test" and repos.backend.test = "npm test" | P0 |
| H2 | Happy | Subfolder with yarn.lock, scripts.test = "jest" | that repo's test is "yarn test", not "npm test" | P0 |
| H3 | Happy | Subfolder with pnpm-lock.yaml | that repo's test is "pnpm test" | P0 |
| H4 | Happy | Frontend has scripts.dev and vite.config.js with server.port 4000 | repo gets dev + devUrl "http://localhost:4000/" | P0 |
| H5 | Happy | Frontend has scripts.dev, vite.config.js with no port declared | devUrl falls back to "http://localhost:5173/" | P0 |
| H6 | Happy | Repo nested two levels: store/backend/package.json | the key is "store/backend", not "backend" | P0 |
| V1 | Validation | Subfolder package.json has no scripts.test | entry written with test = "echo 'chưa có test' && exit 1", exit 0 | P0 |
| V2 | Validation | Subfolder has no package.json at all | that folder produces no entry and is not mentioned as a repo | P0 |
| V3 | Validation | Backend has scripts.test but no scripts.dev | entry has test, has neither dev nor devUrl | P0 |
| V4 | Validation | Two Vite repos, neither declares a port | exit 2, output names both repos and says to pick ports, config.json not written | P0 |
| E1 | Error | config.json already exists | exit 2, prints the detected repos block, leaves the file byte-identical | P0 |
| E2 | Error | No subfolder has a package.json | exit 2, says no repo found, writes nothing | P0 |
| E3 | Error | A subfolder's package.json is malformed JSON | that repo is named in the output as unreadable, other repos still detected, exit 2 | P1 |
| EC1 | Edge | node_modules, .git, dist, .compass contain package.json | none of them becomes a repo entry | P0 |
| EC2 | Edge | package.json at the project root as well as in subfolders | root is not written as a repo entry | P1 |
| EC3 | Edge | A subfolder is a non-Node project (pom.xml, no package.json) | it is reported as needing a manual entry, not silently dropped | P1 |
| EC4 | Edge | Written config is fed to loadConfig + resolveRepos | both accept it with no error | P0 |
| S1 | Security | A subfolder is a symlink pointing outside the project | it is not followed and not written as a repo | P0 |
| S2 | Security | package.json scripts.test contains a shell metacharacter chain | the value is copied verbatim into config, never executed during detection | P0 |
