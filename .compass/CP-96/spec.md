# CP-96: secrets passes without scanning sub-repos when config.json is not valid JSON
Loại: bug
Gốc soi: 26f175c
Phạm vi: commands/secrets.mjs, test/secrets-broken-config.test.mjs (mới), test/secrets-public.test.mjs, skills/compass/SKILL.md, docs/huong-dan.md

## Mục tiêu

Found while writing CP-91-E3. When `.compass/config.json` is not valid JSON and the text does not
contain `"repos"`, `gitUnits` cannot tell which sub-repos have their own git and returns none. `secrets`
then scans only the root git, prints the note "config.json không phải JSON hợp lệ — … gate quét mọi
file .env", and passes. A sub-repo that tracks a `.env` with a real key is never looked at, and the
note claims the opposite. A green gate before the scan really happened is the failure Compass exists to
prevent (SKILL.md, gate `secrets`).

Done means:
- `secrets` exits 2 when `config.json` exists but is not valid JSON, says that it does not know which
  sub-repos to scan nor what `secretsPublic` declares, and writes no gate record;
- the message carries no text from `config.json` (the JSON parser's error text quotes part of the
  file, and a broken config may hold a pasted value);
- a valid config that only lacks `test` keeps working as CP-91-E3 requires;
- the duplicated JSON read in `commands/secrets.mjs` (`docSecretsPublic`) goes through
  `secretsPublicFromText` from `lib/secrets-scan.mjs`;
- SKILL.md and docs/huong-dan.md say the gate is red when config.json cannot be read.

## Ràng buộc

- Only `secrets` changes. `review`, `test` and `gitUnits` keep their current handling of a broken
  config (`gitUnits` already refuses when the text mentions `"repos"`).
- Exit code 2, like the other "cannot run" answers of this gate (invalid `secretsPublic`, missing
  spec), not 1: nothing was scanned, so nothing was found.
- The gate never opens or prints `.env` contents (unchanged).

## Rủi ro hồi quy

- CP-91-E3's second half asserts the old note on a broken config; it changes to assert the exit 2 and
  the new message. Its first half (valid JSON, no `test`) must keep passing unchanged.
- `check` runs `secrets` before `test`: a project with a broken config now stops at `secrets` instead
  of at `test`. Both were red before only if `test` failed on the config, which it does (`loadConfig`).
- Every other `secrets` test (`secrets*.test.mjs`, `workspace-git*.test.mjs`) uses a valid config and
  must stay green.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Root git plus sub-repo `be` with its own git tracking `.env`; config.json is `{ "secretsPublic": [` (no `"repos"` in the text) | exit 2; output says config.json is not valid JSON and that sub-repos are not known; no `PASSED` | P0 |
| H2 | Happy | Same workspace, config is valid JSON with `repos` and `secretsPublic: ["be/.env"]` but no `test` | exit 0; one `ℹ` line names `be/.env` as not scanned | P0 |
| V1 | Validation | Config text is empty (0 bytes) | exit 2 with the same message | P1 |
| E1 | Error | Broken config whose text contains `SECRET_IN_CONFIG_96` | exit 2; output does not contain `SECRET_IN_CONFIG_96` | P0 |
| EC1 | Edge | Single-git project (no sub-repos), broken config | exit 2 too: the gate cannot tell a single-git project from one whose `repos` it could not read | P0 |
| EC2 | Edge | A green `secrets` record exists, then config.json is broken and `secrets` runs | exit 2; the stored `secrets` record is byte-for-byte unchanged | P1 |
