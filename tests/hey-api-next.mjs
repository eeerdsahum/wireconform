import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runFixtureWithAdapter } from '../dist/runner.js';

const require = createRequire(import.meta.url);
const execFile = promisify(execFileCallback);
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = require.resolve('@hey-api/openapi-ts-next/package.json');
const packageRoot = path.dirname(packageJsonPath);
const packageJson = require(packageJsonPath);
const executable = path.join(packageRoot, 'bin', 'run.js');
const fixturePath = path.join(projectRoot, 'examples', 'regression.yaml');

assert.equal(packageJson.version, '0.0.0-next-20260930190945');
const adapter = {
  id: 'hey-api-next',
  version: packageJson.version,
  executionKind: 'hey-api-function',
  available: async () => ({ ready: true, detail: 'Pinned prerelease comparison run' }),
  generate: async (openApiPath, outputDirectory) => {
    await execFile(process.execPath, [executable, '-i', openApiPath, '-o', outputDirectory, '-c', '@hey-api/client-axios'], { cwd: path.dirname(outputDirectory), timeout: 90_000, maxBuffer: 5 * 1024 * 1024 });
  },
};
const report = await runFixtureWithAdapter(fixturePath, adapter);
assert.ok(report.status === 'pass' || report.status === 'fail');
process.stdout.write(`${JSON.stringify({ adapter: report.adapter, status: report.status, diagnosticCodes: report.cases.flatMap((item) => item.diagnostics.map((diagnostic) => diagnostic.code)) })}\n`);
