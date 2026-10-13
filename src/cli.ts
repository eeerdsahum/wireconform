#!/usr/bin/env node
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listAdapters, runFixture } from './runner.js';
import { WireConformError } from './errors.js';
import { validateOpenApi } from './openapi.js';
import { defaultReportPath, readReport, writeReport } from './report.js';
import { wireconformVersion } from './version.js';

type Options = { format: 'text' | 'json'; adapter?: string; reportFile?: string; file?: string };

const usage = `WireConform ${wireconformVersion}

Usage:
  wireconform adapters
  wireconform validate <openapi.yaml|openapi.json> [--format text|json]
  wireconform run <fixture.yaml|fixture.json> --adapter <id> [--format text|json] [--report <file>]
  wireconform report [--format json] [--file <report.json>]

Exit codes:
  0  validation passed or all conformance cases passed
  1  one or more generated requests are non-conformant
  2  invalid input, unsupported feature, or tool execution error`;

const parseOptions = (args: string[]): { positional: string[]; options: Options } => {
  const positional: string[] = [];
  const options: Options = { format: 'text' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--format') {
      const format = args[index + 1];
      if (format !== 'text' && format !== 'json') throw new WireConformError('CLI_ARGUMENT', '--format must be text or json.');
      options.format = format;
      index += 1;
    } else if (argument === '--adapter') {
      const adapter = args[index + 1];
      if (!adapter) throw new WireConformError('CLI_ARGUMENT', '--adapter requires a value.');
      options.adapter = adapter;
      index += 1;
    } else if (argument === '--report') {
      const reportFile = args[index + 1];
      if (!reportFile) throw new WireConformError('CLI_ARGUMENT', '--report requires a file path.');
      options.reportFile = reportFile;
      index += 1;
    } else if (argument === '--file') {
      const file = args[index + 1];
      if (!file) throw new WireConformError('CLI_ARGUMENT', '--file requires a file path.');
      options.file = file;
      index += 1;
    } else if (argument?.startsWith('-')) {
      throw new WireConformError('CLI_ARGUMENT', `Unknown option ${argument}.`);
    } else if (argument) {
      positional.push(argument);
    }
  }
  return { positional, options };
};

const validateCommandOptions = (command: string, options: Options): void => {
  const allowed = command === 'run'
    ? ['format', 'adapter', 'reportFile']
    : command === 'report'
      ? ['format', 'file']
      : command === 'validate' || command === 'adapters'
        ? ['format']
        : [];
  const supplied: Array<[keyof Options, boolean]> = [
    ['adapter', options.adapter !== undefined],
    ['reportFile', options.reportFile !== undefined],
    ['file', options.file !== undefined],
  ];
  for (const [name, present] of supplied) {
    if (present && !allowed.includes(name)) throw new WireConformError('CLI_ARGUMENT', `--${name === 'reportFile' ? 'report' : name} is not valid for ${command}.`);
  }
};

const printJson = (value: unknown): void => { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); };

export const escapeTerminalText = (value: string): string => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

const printRun = (report: Awaited<ReturnType<typeof runFixture>>): void => {
  process.stdout.write(`WireConform ${escapeTerminalText(report.wireconformVersion)} — ${escapeTerminalText(report.specification.operationId)} (${escapeTerminalText(report.specification.method)} ${escapeTerminalText(report.specification.pathTemplate)})\n`);
  process.stdout.write(`Adapter: ${escapeTerminalText(report.adapter.id)} ${escapeTerminalText(report.adapter.version)}\n`);
  for (const result of report.cases) {
    process.stdout.write(`${result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : 'ERROR'} ${escapeTerminalText(result.name)} (${result.partCount} parts)\n`);
    for (const diagnostic of result.diagnostics) process.stdout.write(`  ${escapeTerminalText(diagnostic.code)}: ${escapeTerminalText(diagnostic.message)}\n`);
  }
  process.stdout.write(`Result: ${report.status.toUpperCase()}\n`);
};

const printError = (error: unknown, format: Options['format']): number => {
  const code = error instanceof WireConformError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof Error ? error.message : 'WireConform failed.';
  if (format === 'json') printJson({ status: 'error', diagnostics: [{ code, message }] });
  else process.stderr.write(`ERROR ${escapeTerminalText(code)}: ${escapeTerminalText(message)}\n`);
  return error instanceof WireConformError ? error.exitCode : 2;
};

export const main = async (argv = process.argv.slice(2)): Promise<number> => {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${wireconformVersion}\n`);
    return 0;
  }
  const command = argv[0];
  try {
    if (command === 'help') {
      if (argv.length !== 1) throw new WireConformError('CLI_ARGUMENT', 'help takes no options or positional arguments.');
      process.stdout.write(`${usage}\n`);
      return 0;
    }
    const { positional, options } = parseOptions(argv.slice(1));
    validateCommandOptions(command ?? '', options);
    if (command === 'adapters') {
      if (positional.length !== 0) throw new WireConformError('CLI_ARGUMENT', 'adapters takes no positional arguments.');
      const available = await listAdapters();
      if (options.format === 'json') printJson({ adapters: available });
      else for (const adapter of available) process.stdout.write(`${adapter.ready ? 'READY' : 'SETUP'} ${escapeTerminalText(adapter.id)} ${escapeTerminalText(adapter.version)} — ${escapeTerminalText(adapter.detail)}\n`);
      return 0;
    }
    if (command === 'validate') {
      const specification = positional[0];
      if (!specification || positional.length !== 1) throw new WireConformError('CLI_ARGUMENT', 'validate requires exactly one OpenAPI document path.');
      const document = await validateOpenApi(specification);
      const result = { valid: true, openapi: document.openapi, multipartOperations: document.operations.map(({ operationId, method, path: pathTemplate }) => ({ operationId, method, path: pathTemplate })) };
      if (options.format === 'json') printJson(result);
      else process.stdout.write(`Valid OpenAPI ${document.openapi}; ${document.operations.length} supported multipart operation(s).\n`);
      return 0;
    }
    if (command === 'run') {
      const fixture = positional[0];
      if (!fixture || positional.length !== 1 || !options.adapter) throw new WireConformError('CLI_ARGUMENT', 'run requires a fixture path and --adapter <id>.');
      const report = await runFixture(fixture, options.adapter);
      const reportPath = await writeReport(report, options.reportFile ?? defaultReportPath());
      if (options.format === 'json') printJson(report);
      else {
        printRun(report);
        process.stdout.write(`Report: ${escapeTerminalText(path.relative(process.cwd(), reportPath))}\n`);
      }
      return report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
    }
    if (command === 'report') {
      if (positional.length > 0) throw new WireConformError('CLI_ARGUMENT', 'report takes no positional arguments.');
      const report = await readReport(options.file);
      if (options.format !== 'json') throw new WireConformError('CLI_ARGUMENT', 'report supports --format json only.');
      printJson(report);
      return 0;
    }
    throw new WireConformError('CLI_COMMAND', `Unknown command ${command}.`);
  } catch (error) {
    return printError(error, argv.includes('--format') && argv[argv.indexOf('--format') + 1] === 'json' ? 'json' : 'text');
  }
};

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  void main().then((code) => { process.exitCode = code; });
}
