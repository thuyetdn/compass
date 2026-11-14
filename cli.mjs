#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initCommand, initMultiCommand } from './commands/init.mjs';
import { specCommand } from './commands/spec.mjs';
import { testCommand } from './commands/test.mjs';
import { conventionCommand, conventionDraftCommand, conventionApproveCommand } from './commands/convention.mjs';
import { knowledgeCommand } from './commands/knowledge.mjs';
import { uiCommand } from './commands/ui.mjs';
import { visualCommand } from './commands/visual.mjs';
import { reviewCommand } from './commands/review.mjs';
import { preflightCommand } from './commands/preflight.mjs';
import { mutationCommand } from './commands/mutation.mjs';
import { prCommand, RUN_TESTS_WARNING, PREFLIGHT_WARNING } from './commands/pr.mjs';
import { secretsCommand } from './commands/secrets.mjs';
import { checkCommand } from './commands/check.mjs';
import { doneCommand } from './commands/done.mjs';
import { statusCommand } from './commands/status.mjs';
import { investigateCommand } from './commands/investigate.mjs';
import { scriptsCommand } from './commands/scripts.mjs';
import { dataCommand } from './commands/data.mjs';

const USAGE = `compass — quy trình có bằng chứng

Dùng:
  compass init <id> --type=<fix|bug|feature-s|feature-m|feature-l>
  compass init --multi                 dò các repo con, dựng config nhiều repo
  compass spec <id>
  compass knowledge [id] [--sync] [--page]
  compass secrets <id>
  compass convention <id>
  compass convention --draft [--force]  soạn nháp conventions.md từ config và code
  compass convention --draft --repo=<repo> [--force]
                                         soạn nháp convention riêng của một repo trong "repos"
  compass convention --approve --repo=<repo>
                                         chép bản nháp đã điền và người dùng đã xác nhận
                                         thành convention đã duyệt của repo đó
  compass preflight <id>        lệnh khai trong "preflight" và kiểm tra migration đã áp
  compass test <id>
  compass mutation <id>        đổi từng dòng code của task, chạy lệnh test nhanh, ghi mutant sống
  compass ui <id>
  compass visual <id>
  compass review <id>
  compass pr <số PR|nhánh|sha> [--base=<nhánh>] [--spec=<file>] [--run-tests] [--preflight] [--since=<sha>]
                                soi PR của người khác theo mười tiêu chí
  compass check <id>
  compass done <id>
  compass status [id]           không có id: in cấu hình repo

  compass investigate <id> [--close]
  compass scripts --list
  compass data <id> <file.sql>  đối chiếu tên file khai trong .sql với data/

  compass --version             in phiên bản của bản Compass đang chạy
`;

// Phiên bản đọc từ package.json nằm cạnh chính file này, không từ thư mục đang
// đứng hay biến môi trường của npm: đứng trong dự án khác thì `npm_package_version`
// và package.json ở cwd là của dự án đó. Chỉ đọc khi được hỏi, để file này thiếu
// hay hỏng không làm hỏng các lệnh khác (CP-77).
function version() {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  if (typeof pkg.version !== 'string' || pkg.version === '') {
    throw new Error('package.json của Compass không khai "version"');
  }
  return pkg.version;
}

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) {
      const value = match[2];
      if (value !== undefined) flags[match[1]] = value;
      else if (match[1] !== 'type') flags[match[1]] = true;
    }
    else rest.push(arg);
  }
  return { flags, rest };
}

async function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    const { flags, rest } = parseFlags(args);
    const cwd = process.cwd();
    const taskId = rest[0];

    let result;
    switch (command) {
      // Chỉ khi `--version` đứng đầu, như mọi lệnh khác ở đây: đứng sau một lệnh
      // thì lệnh đó chạy như cũ, và không đọc cấu hình, không ghi file nào.
      case '--version':
        result = { exitCode: 0, output: version() };
        break;
      case 'init':
        result = flags.multi === true
          ? initMultiCommand({ cwd, taskId })
          : initCommand({ cwd, taskId, type: flags.type });
        break;
      case 'spec':
        result = specCommand({ cwd, taskId });
        break;
      case 'knowledge':
        result = knowledgeCommand({ cwd, taskId, sync: flags.sync === true, page: flags.page === true });
        break;
      case 'convention':
        if ((flags.draft === true || flags.approve === true) && flags.repo !== undefined && typeof flags.repo !== 'string') {
          result = { exitCode: 2, output: 'Viết --repo=<tên repo>, có dấu "=" và một tên khai trong "repos".' };
          break;
        }
        if (flags.approve === true) {
          result = conventionApproveCommand({ cwd, repo: typeof flags.repo === 'string' ? flags.repo : null });
          break;
        }
        result = flags.draft === true
          ? conventionDraftCommand({ cwd, force: flags.force === true, repo: typeof flags.repo === 'string' ? flags.repo : null })
          : conventionCommand({ cwd, taskId });
        break;
      case 'preflight':
        result = preflightCommand({ cwd, taskId });
        break;
      case 'mutation':
        result = mutationCommand({ cwd, taskId });
        break;
      case 'test':
        result = testCommand({ cwd, taskId });
        break;
      case 'ui':
        result = await uiCommand({ cwd, taskId });
        break;
      case 'visual':
        result = await visualCommand({ cwd, taskId });
        break;
      case 'secrets':
        result = secretsCommand({ cwd, taskId });
        break;

      case 'pr':
        // `--base main` không có `=` thì `main` thành đối số thứ hai và cờ bị bỏ qua
        // lặng lẽ: soi nhầm nhánh gốc mà không ai biết.
        if (flags.base === true || flags.spec === true || flags.since === true || flags.base === '' || flags.spec === '' || flags.since === '') {
          result = { exitCode: 2, output: 'Viết --base=<nhánh>, --spec=<file> và --since=<sha>, có dấu "=" và một giá trị.' };
          break;
        }
        if (typeof flags['run-tests'] === 'string' || typeof flags.preflight === 'string') {
          result = { exitCode: 2, output: '--run-tests và --preflight không nhận giá trị: viết đúng tên cờ.' };
          break;
        }
        // Nói trước khi chạy, không đợi tới cuối: lệnh test là code của người viết PR.
        if (flags['run-tests'] === true) process.stderr.write(`${RUN_TESTS_WARNING}\n`);
        if (flags.preflight === true) process.stderr.write(`${PREFLIGHT_WARNING}\n`);
        result = prCommand({
          cwd,
          ref: rest[0],
          base: typeof flags.base === 'string' ? flags.base : null,
          specFile: typeof flags.spec === 'string' ? flags.spec : null,
          runTests: flags['run-tests'] === true,
          preflight: flags.preflight === true,
          since: typeof flags.since === 'string' ? flags.since : null,
          warned: flags['run-tests'] === true || flags.preflight === true,
        });
        break;
      case 'review':
        result = reviewCommand({ cwd, taskId });
        break;
      case 'check':
        result = await checkCommand({ cwd, taskId, only: flags.only });
        break;
      case 'done':
        result = doneCommand({ cwd, taskId });
        break;
      case 'investigate':
        result = investigateCommand({ cwd, taskId, close: flags.close === true });
        break;
      case 'scripts':
        result = scriptsCommand({ cwd });
        break;
      case 'data':
        result = dataCommand({ cwd, taskId, sqlPath: rest[1] });
        break;
      case 'status':
        result = statusCommand({ cwd, taskId });
        break;
      default:
        result = { exitCode: 2, output: USAGE };
    }

    if (result.output) console.log(result.output);
    process.exitCode = result.exitCode;
  } catch (err) {
    console.log(`Lệnh thất bại: ${err.message}`);
    if (err.stack) console.log(err.stack);
    process.exitCode = 2;
  }
}

main();
