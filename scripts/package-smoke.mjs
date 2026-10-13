import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run package:smoke so npm_execpath is available.');

const runNpm = (args, cwd, label, timeout = 300_000) => {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', timeout, maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
};

const runCli = (consumerRoot, args, expectedStatus, label) => {
  const result = spawnSync(process.execPath, [npmCli, 'exec', '--prefix', consumerRoot, '--', 'wireconform', ...args], { cwd: consumerRoot, encoding: 'utf8', timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
  assert.equal(result.status, expectedStatus, `${label}: ${result.stderr || result.stdout}`);
  return result.stdout;
};

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wireconform-package-smoke-'));
const consumerRoot = path.join(tempRoot, 'consumer');
try {
  const packed = JSON.parse(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', tempRoot], projectRoot, 'npm pack'));
  assert.equal(packed.length, 1);
  const tarball = path.join(tempRoot, packed[0].filename);
  await mkdir(consumerRoot);
  await writeFile(path.join(consumerRoot, 'package.json'), JSON.stringify({
    name: 'wireconform-package-smoke-consumer',
    version: '1.0.0',
    private: true,
    overrides: { '@hey-api/openapi-ts': { 'js-yaml': '4.3.2' } },
  }, null, 2));
  runNpm(['install', '--no-audit', '--no-fund', '--save-exact', tarball], consumerRoot, 'install packed WireConform');
  runNpm(['install', '--no-audit', '--no-fund', '--save-dev', '--save-exact', '@hey-api/openapi-ts@0.99.0', 'typescript@5.9.3'], consumerRoot, 'install pinned Hey API adapter');
  runNpm(['audit', '--audit-level=low'], consumerRoot, 'audit clean consumer dependency tree');

  const packageRoot = path.join(consumerRoot, 'node_modules', ...packageJson.name.split('/'));
  const binPath = path.join(consumerRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'wireconform.cmd' : 'wireconform');
  assert.equal(existsSync(binPath), true, 'the package manager must install the WireConform executable');
  const validation = JSON.parse(runCli(consumerRoot, ['validate', path.join(packageRoot, 'examples', 'positive-openapi.yaml'), '--format', 'json'], 0, 'validate packaged OpenAPI document'));
  assert.equal(validation.valid, true);

  const adapters = JSON.parse(runCli(consumerRoot, ['adapters', '--format', 'json'], 0, 'list installed adapters'));
  assert.equal(adapters.adapters.find((adapter) => adapter.id === 'hey-api')?.ready, true);

  const positiveReportPath = path.join(tempRoot, 'positive-report.json');
  const positive = JSON.parse(runCli(consumerRoot, ['run', path.join(packageRoot, 'examples', 'hey-api-positive.yaml'), '--adapter', 'hey-api', '--format', 'json', '--report', positiveReportPath], 0, 'run packaged positive case'));
  assert.equal(positive.status, 'pass');
  assert.equal(positive.adapter.version, '0.99.0');

  const regressionReportPath = path.join(tempRoot, 'regression-report.json');
  const regression = JSON.parse(runCli(consumerRoot, ['run', path.join(packageRoot, 'examples', 'regression.yaml'), '--adapter', 'hey-api', '--format', 'json', '--report', regressionReportPath], 1, 'run packaged mismatch regression'));
  assert.equal(regression.status, 'fail');
  const contentTypeDiagnostics = regression.cases.flatMap((item) => item.diagnostics).filter((item) => item.code === 'CONTENT_TYPE_MISMATCH');
  assert.equal(contentTypeDiagnostics.length, 2);
  assert.deepEqual(contentTypeDiagnostics.map((item) => [item.expected, item.actual]), [
    ['application/json', 'text/plain'],
    ['application/json', 'text/plain'],
  ]);

  const readback = JSON.parse(runCli(consumerRoot, ['report', '--format', 'json', '--file', regressionReportPath], 0, 'read packaged regression report'));
  assert.equal(readback.status, 'fail');
  assert.equal(JSON.stringify(readback).includes('product-1'), false);
  assert.equal(JSON.stringify(readback).includes('catalog'), false);
  process.stdout.write(`External tarball install passed: ${packageJson.name}@${packageJson.version}; Hey API 0.99.0 positive case PASS; regression FAIL with 2 CONTENT_TYPE_MISMATCH diagnostics and CLI exit 1.\n`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
