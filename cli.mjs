#!/usr/bin/env node
import { initCommand } from './commands/init.mjs';
import { specCommand } from './commands/spec.mjs';
import { testCommand } from './commands/test.mjs';
import { conventionCommand } from './commands/convention.mjs';
import { knowledgeCommand } from './commands/knowledge.mjs';
import { uiCommand } from './commands/ui.mjs';
import { visualCommand } from './commands/visual.mjs';
import { reviewCommand } from './commands/review.mjs';
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
  compass spec <id>
  compass knowledge [id] [--sync]
  compass secrets <id>
  compass convention <id>
  compass test <id>
  compass ui <id>
  compass visual <id>
  compass review <id>
  compass check <id>
  compass done <id>
  compass status [id]           không có id: in cấu hình repo

  compass investigate <id> [--close]
  compass scripts --list
  compass data <id> <file.sql>  đối chiếu tên file khai trong .sql với data/
`;

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
      case 'init':
        result = initCommand({ cwd, taskId, type: flags.type });
        break;
      case 'spec':
        result = specCommand({ cwd, taskId });
        break;
      case 'knowledge':
        result = knowledgeCommand({ cwd, taskId, sync: flags.sync === true });
        break;
      case 'convention':
        result = conventionCommand({ cwd, taskId });
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
