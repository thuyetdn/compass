# CP-77: Print the installed Compass version with --version
Loại: feature-s
Phạm vi: cli.mjs, test/cli-version.test.mjs (new), README.md, docs/index.html
Gốc soi: 9ffa1c27fb974876b130eefee6f59d83f65b2e11

## Mục tiêu
Running `compass --version` prints the version from the package.json belonging to the
executed Compass CLI, followed by a newline, and exits with code 0 and empty stderr.
It works from any existing working directory without requiring a Compass project.
The CLI usage text lists `compass --version`.

## Ràng buộc
- Read the package metadata relative to the CLI module, never relative to the working
  directory or from npm environment variables. Do not hardcode the current version.
- Use Node built-ins only and retain compatibility with the declared Node >=20 support.
- Recognize the exact first argument `--version`. Like existing command dispatch,
  trailing arguments do not select another command: `--version init example --type=fix`
  only prints the version. A `--version` after an existing subcommand keeps that
  subcommand's current behavior; this task adds no alias such as `-v`.
- The version path must not load project configuration, run gates, or create or modify
  files. It does not require Git or a .compass directory.
- Missing or malformed JSON in Compass's own package.json must return code 2 with
  the existing CLI failure diagnostic, never a successful version result. Read this
  metadata only for the version request so other commands do not gain that dependency.
- Test copied CLI distributions in temporary directories when changing or removing
  package metadata; never modify the real package.json for a test.
- Each case below maps to one test function named `CP-77-<ID> ...`. Run the new tests
  and observe failure before implementation, then run the configured full suite via
  `compass check CP-77` and the final `compass done CP-77` gate.

## Rủi ro hồi quy
- Scanning all arguments for --version could suppress an existing subcommand.
- Resolving package.json from cwd could print the consuming project's version or fail
  outside a project. Windows paths with spaces and non-ASCII characters need coverage.
- Loading metadata at module startup could break ordinary commands when that metadata
  is unavailable; keep the existing CLI error handling and command dispatch intact.
- Updating usage must preserve the current exit code 2 for no command or unknown
  commands. Existing CLI and integration tests remain part of the full suite.

## Test cases
Exercise the CLI as a child process and assert observable output, exit status, and
filesystem effects. Success cases assert the exact version line, code 0, and empty stderr.

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Run --version from the Compass repository | stdout equals the repository package.json version plus newline; exit 0; stderr empty | P0 |
| H2 | Happy | Run --version from an empty temporary directory outside any project | Same version line and exit 0; directory remains empty | P0 |
| H3 | Happy | Run a copied CLI whose own package version is 9.8.7-rc.1+build.42 | stdout is exactly 9.8.7-rc.1+build.42 plus newline; exit 0 | P0 |
| V1 | Validation | Run --version=1 instead of the exact flag | Exit 2 and usage output, not a successful version response | P1 |
| V2 | Validation | Run init SAMPLE --type=fix --version in a temporary project | Existing init runs successfully and creates the SAMPLE spec, rather than printing only a version | P0 |
| E1 | Error | Run --version in a copied distribution with malformed package.json | Exit 2; output contains the existing CLI failure diagnostic | P0 |
| E2 | Error | Run --version in a copied distribution with its package.json removed | Exit 2; output contains the existing CLI failure diagnostic | P0 |
| EC1 | Edge | Run a copied CLI from an installation path containing spaces and Vietnamese characters | Exact version line; exit 0; stderr empty | P1 |
| EC2 | Edge | Run --version with malformed .compass/config.json in cwd | Exact version line; exit 0; malformed config bytes remain unchanged | P0 |
| EC3 | Edge | Run the CLI without arguments | Exit 2; usage lists compass --version and existing compass init syntax | P1 |
| S1 | Security | Working directory has an unrelated package.json with version 99.99.99 | Print Compass's own version; unrelated package.json remains unchanged | P0 |
| S2 | Security | Set npm_package_version to 99.99.99 in the child environment | Print Compass's own version, not the environment value | P1 |
| S3 | Security | Run --version init SAMPLE --type=fix in an empty directory | Only print the version; exit 0; no task, config, or other files created | P0 |
