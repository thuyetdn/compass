#!/usr/bin/env node
import { initCommand } from './commands/init.mjs';

const USAGE = `compass — quy trình có bằng chứng

Dùng:
  compass init <id> --type=<fix|bug|feature-s|feature-m|feature-l>
  compass spec <id>
  compass test <id>
  compass check <id>
  compass done <id>
  compass status <id>
`;

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) flags[match[1]] = match[2] ?? true;
    else rest.push(arg);
  }
  return { flags, rest };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const { flags, rest } = parseFlags(args);
  const cwd = process.cwd();
  const taskId = rest[0];

  let result;
  switch (command) {
    case 'init':
      result = initCommand({ cwd, taskId, type: flags.type });
      break;
    default:
      result = { exitCode: 2, output: USAGE };
  }

  if (result.output) console.log(result.output);
  process.exitCode = result.exitCode;
}

main();
