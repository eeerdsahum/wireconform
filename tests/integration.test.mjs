import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runFixtureWithAdapter } from '../dist/runner.js';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliPath = path.join(projectRoot, 'dist', 'cli.js');
const regressionFixture = path.join(projectRoot, 'examples', 'regression.yaml');
const positiveFixture = path.join(projectRoot, 'examples', 'positive.yaml');
const heyPositiveFixture = path.join(projectRoot, 'examples', 'hey-api-positive.yaml');
const defaultJarPath = path.join(projectRoot, 'work', 'openapi-generator-cli-7.26.0.jar');
const jarPath = process.env.WIRECONFORM_OPENAPI_GENERATOR_JAR ?? defaultJarPath;
const defaultJavaHome = path.join(projectRoot, 'work', 'java11', 'jdk-11.0.32.1+1-jre');
const javaCandidates = [...new Set([process.env.JAVA_HOME, existsSync(defaultJavaHome) ? defaultJavaHome : undefined, undefined])];
const javaRuntime = javaCandidates.map((home) => {
  const executable = home ? path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : process.platform === 'win32' ? 'java.exe' : 'java';
  const result = spawnSync(executable, ['-version'], { encoding: 'utf8' });
  const match = /version "(\d+)/.exec(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return { home, executable, supported: result.status === 0 && Number(match?.[1] ?? 0) >= 11 };
}).find((candidate) => candidate.supported);
const javaHome = javaRuntime?.home;
const openApiGeneratorConfigured = existsSync(jarPath) && javaRuntime !== undefined;
const openApiGeneratorEnvironment = () => {
  const env = { ...process.env, WIRECONFORM_OPENAPI_GENERATOR_JAR: jarPath };
  if (javaHome) env.JAVA_HOME = javaHome;
  else delete env.JAVA_HOME;
  return env;
};

test('Hey API 0.99.0 request mismatch is a CLI conformance failure with a private-data-free report', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'wireconform-cli-test-'));
  try {
    const reportPath = path.join(temp, 'report.json');
    const result = spawnSync(process.execPath, [cliPath, 'run', regressionFixture, '--adapter', 'hey-api', '--format', 'json', '--report', reportPath], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.adapter.version, '0.99.0');
    assert.equal(report.status, 'fail');
    assert.equal(report.cases[0].status, 'fail');
    assert.equal(report.cases[0].partCount, 4);
    assert.equal(report.cases[0].diagnostics.filter((item) => item.code === 'CONTENT_TYPE_MISMATCH').length, 2);
    const savedReport = await readFile(reportPath, 'utf8');
    assert.equal(savedReport.includes('catalog'), false);
    assert.equal(savedReport.includes('product-1'), false);
    const readback = spawnSync(process.execPath, [cliPath, 'report', '--format', 'json', '--file', reportPath], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(readback.status, 0, readback.stderr);
    assert.equal(JSON.parse(readback.stdout).status, 'fail');
    process.stdout.write('Observed Hey API 0.99.0 mismatch: two repeated products parts had text/plain; CLI exited 1.\n');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Hey API 0.99.0 passes the binary and text multipart example', () => {
  const result = spawnSync(process.execPath, [cliPath, 'run', heyPositiveFixture, '--adapter', 'hey-api', '--format', 'json'], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.adapter.version, '0.99.0');
  assert.equal(report.status, 'pass');
  assert.equal(report.cases[0].partCount, 3);
  process.stdout.write('Observed Hey API 0.99.0: binary and plain-text parts passed.\n');
});

test('OpenAPI Generator 7.26.0 passes the JSON, binary, and text example', { skip: !openApiGeneratorConfigured }, () => {
  const env = openApiGeneratorEnvironment();
  const result = spawnSync(process.execPath, [cliPath, 'run', positiveFixture, '--adapter', 'openapi-generator', '--format', 'json'], { cwd: projectRoot, env, encoding: 'utf8', timeout: 180_000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.adapter.version, '7.26.0');
  assert.equal(report.status, 'pass');
  assert.equal(report.cases[0].partCount, 3);
  process.stdout.write('Observed OpenAPI Generator 7.26.0: JSON, binary, and plain-text parts passed.\n');
});

test('OpenAPI Generator 7.26.0 array serialization is independently reported as non-conformant', { skip: !openApiGeneratorConfigured }, () => {
  const env = openApiGeneratorEnvironment();
  const result = spawnSync(process.execPath, [cliPath, 'run', regressionFixture, '--adapter', 'openapi-generator', '--format', 'json'], { cwd: projectRoot, env, encoding: 'utf8', timeout: 180_000 });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.adapter.version, '7.26.0');
  assert.equal(report.status, 'fail');
  assert.ok(report.cases[0].diagnostics.some((item) => item.code === 'PART_COUNT_MISMATCH'));
  process.stdout.write('Observed OpenAPI Generator 7.26.0: array was one part; expected two repeated item parts.\n');
});

test('CLI rejects command-irrelevant options in JSON mode', () => {
  const result = spawnSync(process.execPath, [cliPath, 'adapters', '--adapter', 'hey-api', '--format', 'json'], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'CLI_ARGUMENT');
});

test('SDK requests to the wrong method or path fail conformance', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'wireconform-target-test-'));
  try {
    const specificationPath = path.join(temp, 'openapi.yaml');
    const fixturePath = path.join(temp, 'fixture.yaml');
    await writeFile(specificationPath, `openapi: 3.0.4
info:
  title: target check
  version: 1.0.0
paths:
  /expected:
    post:
      operationId: upload
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [payload]
              properties:
                payload:
                  type: string
      responses:
        '204':
          description: done
`);
    await writeFile(fixturePath, `fixtureVersion: 1
openapi: ./openapi.yaml
operationId: upload
cases:
  - name: target
    body:
      payload: value
`);
    const adapterFor = (method, route) => ({
      id: 'test-adapter',
      version: '1.0.0',
      executionKind: 'hey-api-function',
      available: async () => ({ ready: true, detail: 'test' }),
      generate: async (_openApiPath, outputDirectory) => {
        const sdk = `export const upload = async ({ body, baseURL }) => {
  const form = new FormData();
  form.append('payload', body.payload);
  const response = await fetch(baseURL + ${JSON.stringify(route)}, { method: ${JSON.stringify(method)}, body: form });
  if (!response.ok) throw new Error('request rejected');
};
`;
        await writeFile(path.join(outputDirectory, 'sdk.gen.ts'), sdk);
      },
    });
    const wrongPath = await runFixtureWithAdapter(fixturePath, adapterFor('POST', '/wrong'));
    assert.equal(wrongPath.status, 'fail');
    assert.equal(wrongPath.cases[0].diagnostics[0].code, 'REQUEST_PATH_MISMATCH');
    const wrongMethod = await runFixtureWithAdapter(fixturePath, adapterFor('PUT', '/expected'));
    assert.equal(wrongMethod.status, 'fail');
    assert.equal(wrongMethod.cases[0].diagnostics[0].code, 'REQUEST_METHOD_MISMATCH');
    const failedSdk = await runFixtureWithAdapter(fixturePath, {
      ...adapterFor('POST', '/expected'),
      generate: async (_openApiPath, outputDirectory) => writeFile(path.join(outputDirectory, 'sdk.gen.ts'), "export const upload = async () => { throw new Error('private'); };\n"),
    });
    assert.equal(failedSdk.status, 'error');
    assert.equal(failedSdk.cases[0].diagnostics[0].code, 'SDK_EXECUTION');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('generated SDK worker blocks HTTP and fetch requests outside the capture origin', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'wireconform-network-test-'));
  const outsideServer = createServer((_request, response) => response.end('unexpected'));
  let outsideRequests = 0;
  outsideServer.on('request', () => { outsideRequests += 1; });
  await new Promise((resolve, reject) => {
    outsideServer.once('error', reject);
    outsideServer.listen(0, '127.0.0.1', resolve);
  });
  const address = outsideServer.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const specificationPath = path.join(temp, 'openapi.yaml');
    const fixturePath = path.join(temp, 'fixture.yaml');
    const specification = JSON.parse('{"openapi":"3.0.4","info":{"title":"network guard","version":"1.0.0"},"paths":{"/expected":{"post":{"operationId":"upload","requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"__proto__":{"type":"string"}}}}}},"responses":{"204":{"description":"done"}}}}}}');
    const fixture = JSON.parse('{"fixtureVersion":1,"openapi":"./openapi.yaml","operationId":"upload","cases":[{"name":"network guard","body":{"__proto__":"value"}}]}');
    await writeFile(specificationPath, JSON.stringify(specification));
    await writeFile(fixturePath, JSON.stringify(fixture));
    const adapter = {
      id: 'network-test',
      version: '1.0.0',
      executionKind: 'hey-api-function',
      available: async () => ({ ready: true, detail: 'test' }),
      generate: async (_openApiPath, outputDirectory) => {
        const sdk = `import http from 'node:http';
export const upload = async ({ body, baseURL }) => {
  if (!Object.hasOwn(body, '__proto__')) throw new Error('fixture property was lost');
  try { http.get('http://127.0.0.1:${address.port}/outside'); } catch {}
  try { await fetch('http://127.0.0.1:${address.port}/outside'); } catch {}
  const form = new FormData();
  form.append('__proto__', body['__proto__']);
  const response = await fetch(baseURL + '/expected', { method: 'POST', body: form });
  if (!response.ok) throw new Error('request rejected');
};
`;
        await writeFile(path.join(outputDirectory, 'sdk.gen.ts'), sdk);
      },
    };
    const report = await runFixtureWithAdapter(fixturePath, adapter);
    assert.equal(report.status, 'pass', JSON.stringify(report));
    assert.equal(report.cases[0]?.partCount, 1);
    assert.equal(outsideRequests, 0);
  } finally {
    await rm(temp, { recursive: true, force: true });
    await new Promise((resolve, reject) => outsideServer.close((error) => error ? reject(error) : resolve()));
  }
});
