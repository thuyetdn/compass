# CP-75: A team using Codex has no way in — the procedure only loads as a Claude Code skill
Loại: feature-s
Phạm vi: templates/AGENTS.md (mới), README.md, skills/compass/SKILL.md, test/codex-template.test.mjs (mới)
Gốc soi: 205d56d

## Mục tiêu

Compass has two halves. The CLI is agent-agnostic: `lib/` and `commands/` mention Claude only in a
list of folders to skip and in one comment. The procedure an agent must follow lives in
`skills/compass/SKILL.md`, which Claude Code loads as a skill and Codex never reads — Codex reads
`AGENTS.md`. `SKILL.md` also tells the agent to run `node "${CLAUDE_PLUGIN_ROOT}/cli.mjs"`, a
variable only Claude Code sets.

Measured on 205d56d: `npm install -g --prefix <tmp> github:thuyetdn/compass` installs a working
`compass` command and ships `skills/compass/SKILL.md` inside the package.

Done means a Codex team can install the CLI with one command, drop a ready-made `AGENTS.md` section
into their project, and get the same procedure — spec first, stop for approval, gates decide —
without anything in it that only works under Claude Code.

## Ràng buộc

- The template is a section the team appends to an existing `AGENTS.md`, not a file that assumes
  it owns the whole thing.
- It does not copy all of `SKILL.md`: a copy drifts. It carries the rules an agent must not break,
  the lifecycle, the task types and the test-naming rule, and points at the installed `SKILL.md` for
  everything else. Tests keep the copied parts equal to their sources.
- Task-type numbers come from `lib/task-types.mjs`, checked by test, never hand-maintained.
- No Claude-only instruction in the template: no `${CLAUDE_PLUGIN_ROOT}`, no `/plugin`, no skill or
  subagent tool names.
- `templates/` already ships in the npm package; the template must reach an installed copy.
- Not verified against a real Codex session. The spec says so rather than implying it.

## Rủi ro hồi quy

- `compass init` reads `templates/spec.md`; a new file in `templates/` must not be picked up as a
  spec template.
- CP-58-H2 requires every `compass <cmd>` the guide mentions to be one `cli.mjs` dispatches; the
  README's new section falls under the same rule through CP-58-H1/H3 link and command checks.
- CP-74-H1 scans every tracked file for internal names; new text must stay clean.
- `SKILL.md` gains a line about installing outside Claude Code; the plugin path must stay the first
  instruction, since the plugin is still the main way in.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | templates/AGENTS.md exists | file present, has a Compass heading | P0 |
| H2 | Happy | Every `compass <cmd>` in the template | is a command cli.mjs dispatches | P0 |
| H3 | Happy | The rules an agent must not break | each bolded rule in SKILL.md "Luật tối cao" appears in the template | P0 |
| H4 | Happy | Task-type table in the template | type, minimum tests and layers equal lib/task-types.mjs | P0 |
| H5 | Happy | README section for Codex | names the install command and the template path | P0 |
| V1 | Validation | Claude-only instructions in the template | none: no CLAUDE_PLUGIN_ROOT, no /plugin, no Skill or Agent tool | P0 |
| V2 | Validation | npm pack | ships templates/AGENTS.md | P0 |
| V3 | Validation | The install command in README | matches package.json bin `compass` and the GitHub repo | P1 |
| E1 | Error | Template on the approval stop | tells the agent to stop after `compass spec` and wait for a person | P0 |
| E2 | Error | Template on a red gate | tells the agent to fix and rerun, never to report done itself | P0 |
| EC1 | Edge | Template on shared test suites | explains naming tests with the task id prefix | P1 |
| EC2 | Edge | Template on the review gate | says the brief goes to a separate session with no chat history | P1 |
| S1 | Security | Template on evidence | forbids editing evidence/ and gate.json | P0 |
