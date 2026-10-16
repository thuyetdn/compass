# CP-76: Compass installs as a Claude Code plugin but not as a Codex plugin
Loại: feature-s
Phạm vi: .codex-plugin/plugin.json (mới), .agents/plugins/marketplace.json (mới), skills/compass/SKILL.md, README.md, test/codex-plugin.test.mjs (mới)
Gốc soi: e0e0c51

## Mục tiêu

Codex has the same skill format as Claude Code (`SKILL.md` with `name` and `description`
frontmatter) and installs plugins from a Git or local marketplace. CP-75 gave Codex teams only an
`AGENTS.md` section plus a global npm install — a workaround, not the plugin path Claude Code gets.

Measured with the `codex` 0.162 binary bundled in the VS Code extension, in a throwaway
`CODEX_HOME`: a clone of this repo carrying `.codex-plugin/plugin.json` (with `"skills": "./skills/"`)
and `.agents/plugins/marketplace.json` installs with `codex plugin marketplace add <path>` then
`codex plugin add compass@compass`. The installed root holds the whole tracked repo, `cli.mjs`
included, and `node <root>/cli.mjs` runs. A past Codex session lists every skill as
`(file: <absolute path>/SKILL.md)`, so the agent knows where the skill lives.

Done means a Codex user installs Compass the way they install `superpowers`, and the skill tells
them how to reach the CLI that came with it — no global npm install needed, as in Claude Code.

## Ràng buộc

- Manifest shapes copied from a plugin Codex really installs (`superpowers` 7.0.0 on this machine),
  not invented.
- One identity across harnesses: name `compass`, same version, description, licence and author as
  `package.json` and `.claude-plugin/plugin.json`.
- The Codex manifest declares skills only: no hooks, no MCP servers, no apps. Installing Compass
  must not start any process.
- `SKILL.md` keeps the Claude Code instruction first; the Codex line is added beside it. The path
  `../../cli.mjs` from the skill folder must resolve to the real `cli.mjs`.
- `templates/AGENTS.md` and the global npm install stay, as the path for agents without skills.

## Rủi ro hồi quy

- CP-58-V2 asserts `package.json` and the two Claude manifests agree on version and name; a third
  manifest must join that agreement, not drift beside it.
- CP-75-H5 asserts the README Codex section names the npm install and `templates/AGENTS.md`; the
  rewritten section must keep both as the fallback.
- CP-74-H1 scans every tracked file for internal names, new manifests included.
- Codex copies tracked files only; a manifest that exists on disk but is not committed installs
  nothing. Verified by installing from a committed clone, not from the working tree.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | .codex-plugin/plugin.json | exists, parses, name is compass | P0 |
| H2 | Happy | The skills path it declares | is ./skills/ and holds compass/SKILL.md | P0 |
| H3 | Happy | .agents/plugins/marketplace.json | lists plugin compass with source url ./ | P0 |
| H4 | Happy | Versions across package.json and both plugin manifests | all equal | P0 |
| H5 | Happy | SKILL.md tells Codex how to reach the CLI | names ../../cli.mjs, and that path from skills/compass resolves to cli.mjs | P0 |
| V1 | Validation | Description, licence, author | equal across package.json, the Claude manifest and the Codex manifest | P0 |
| V2 | Validation | README Codex section | names `codex plugin marketplace add thuyetdn/compass` and `codex plugin add compass@compass` | P0 |
| V3 | Validation | Marketplace entry name | equals the plugin manifest name | P1 |
| V4 | Validation | Homepage and repository in the Codex manifest | point at github.com/thuyetdn/compass | P1 |
| E1 | Error | SKILL.md when the CLI cannot be found | gives the one-line npm install as the fallback | P1 |
| EC1 | Edge | Plugin id on both harnesses | compass@compass on Codex, same plugin name as on Claude Code | P1 |
| EC2 | Edge | Codex interface block | displayName Compass, category Developer Tools | P1 |
| S1 | Security | What installing runs | the Codex manifest declares no hooks, MCP servers or apps | P0 |
