import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.env.WIRECONFORM_PACKAGE_ROOT ?? process.cwd());

const validatePackSummary = (summary, manifest) => {
  assert.equal(summary.length, 1);
  const [packageInfo] = summary;
  assert.equal(packageInfo.name, manifest.name);
  assert.equal(packageInfo.version, manifest.version);
  assert.equal(packageInfo.filename, `${manifest.name}-${manifest.version}.tgz`);
  assert.ok(Array.isArray(packageInfo.files));
  const paths = packageInfo.files.map((file) => file.path);
  const requiredPaths = ['CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'README.md', 'SECURITY.md', 'dist/cli.js', 'dist/index.js', 'docs/conformance.md', 'docs/demo.md', 'examples/hey-api-positive.yaml', 'examples/files/tiny.bin', 'spec/openapi.yaml'];
  for (const required of requiredPaths) assert.ok(paths.includes(required), `The package is missing required file ${required}.`);
  for (const filePath of paths) {
    assert.equal(typeof filePath, 'string');
    assert.equal(filePath.startsWith('/'), false);
    assert.equal(filePath.split(/[\\/]/).includes('..'), false);
    assert.match(filePath, /^(?:CHANGELOG\.md|CONTRIBUTING\.md|LICENSE|README\.md|SECURITY\.md|package\.json|dist\/|docs\/|examples\/|spec\/)/);
    assert.doesNotMatch(filePath, /(?:^|\/)(?:\.git|node_modules|tests|scripts|\.github)(?:\/|$)|(?:^|\/)(?:\.npmrc|\.env(?:\.|$)|[^/]+\.(?:pem|key|p12|pfx|log|tgz))$/i);
  }
  assert.ok(packageInfo.unpackedSize <= 5 * 1024 * 1024, 'The package is unexpectedly large.');
  return packageInfo;
};

const readSummary = async () => {
  const [summaryPath, destination] = process.argv.slice(2);
  if (summaryPath) {
    return {
      summary: JSON.parse(await readFile(summaryPath, 'utf8')),
      destination: path.resolve(destination ?? path.dirname(summaryPath)),
      tarball: true,
    };
  }

  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Run this check with npm run package:check so the configured npm CLI is used.');
  const result = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  assert.equal(result.error, undefined, 'npm pack --dry-run could not run.');
  assert.equal(result.status, 0, 'npm pack --dry-run failed.');
  return { summary: JSON.parse(result.stdout), destination: root, tarball: false };
};

const main = async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const { summary, destination, tarball } = await readSummary();
  const packageInfo = validatePackSummary(summary, manifest);
  if (tarball) {
    const tarballPath = path.resolve(destination, packageInfo.filename);
    assert.equal(existsSync(tarballPath), true, 'The npm pack output tarball is missing.');
    process.stdout.write(`${tarballPath}\n`);
    return;
  }
  process.stdout.write(`Package contents verified: ${packageInfo.files.length} files, ${packageInfo.unpackedSize} unpacked bytes.\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Package contents verification failed.'}\n`);
    process.exitCode = 1;
  }
}

export { validatePackSummary };
