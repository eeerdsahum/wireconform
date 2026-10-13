import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { adapters, findAdapter } from './adapters/index.js';
import { startCaptureServer } from './capture/server.js';
import { toSafeDiagnostic, WireConformError } from './errors.js';
import { deriveExpectedParts } from './multipart/expectations.js';
import { compareMultipart } from './multipart/compare.js';
import { loadFixture } from './fixtures.js';
import { loadOpenApi } from './openapi.js';
import type { CaseResult, CapturedPart, FixtureCase, GeneratorAdapter, JsonObject, RunReport } from './types.js';
import { wireconformVersion } from './version.js';

const require = createRequire(import.meta.url);
const nodeModulesPath = path.dirname(path.dirname(require.resolve('axios/package.json')));
const tsxImport = pathToFileURL(require.resolve('tsx/esm')).href;
const workerCode = `
import { File } from 'node:buffer';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
const inputChunks = [];
for await (const chunk of process.stdin) inputChunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(inputChunks).toString('utf8'));
const captureUrl = new URL(input.baseUrl);
const blockedNetworkRequest = () => { throw new Error('WireConform blocked a request outside the loopback capture server.'); };
const requestUrl = (target, options) => {
  if (target instanceof URL || typeof target === 'string') {
    const url = new URL(target, captureUrl);
    if (options && typeof options === 'object') {
      if (options.socketPath) return undefined;
      if (options.protocol) url.protocol = options.protocol;
      if (options.host) url.host = options.host;
      else if (options.hostname) url.hostname = options.hostname;
      if (options.port !== undefined) url.port = String(options.port);
      if (typeof options.path === 'string') {
        const path = new URL(options.path, url.origin);
        url.pathname = path.pathname;
        url.search = path.search;
      }
    }
    return url;
  }
  if (!target || typeof target !== 'object' || Array.isArray(target) || target.socketPath) return undefined;
  const values = { ...target, ...(options && typeof options === 'object' ? options : {}) };
  const host = values.hostname ?? values.host;
  if (typeof host !== 'string') return undefined;
  const port = values.port === undefined || values.port === '' ? '' : ':' + values.port;
  const protocol = typeof values.protocol === 'string' ? values.protocol : 'http:';
  const pathname = typeof values.path === 'string' ? values.path : '/';
  const formattedHost = host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host;
  try {
    return new URL(protocol + '//' + formattedHost + port + (pathname.startsWith('/') ? pathname : '/' + pathname));
  } catch {
    return undefined;
  }
};
const assertCaptureRequest = (target, options) => {
  const url = requestUrl(target, options);
  if (!url || url.origin !== captureUrl.origin || url.username !== '' || url.password !== '') blockedNetworkRequest();
};
const guardRequest = (request) => function (...args) {
  assertCaptureRequest(args[0], args[1]);
  return request.apply(this, args);
};
http.request = guardRequest(http.request);
http.get = guardRequest(http.get);
https.request = guardRequest(https.request);
https.get = guardRequest(https.get);
const socketFactory = (factory) => function (...args) {
  const first = args[0];
  const options = first && typeof first === 'object'
    ? first
    : typeof first === 'number'
      ? { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' }
      : undefined;
  if (!options || (options.path && options.port === undefined) || Number(options.port) !== Number(captureUrl.port) || (options.host ?? options.hostname ?? 'localhost') !== captureUrl.hostname) blockedNetworkRequest();
  return factory.apply(this, args);
};
net.connect = socketFactory(net.connect);
net.createConnection = socketFactory(net.createConnection);
if (typeof globalThis.fetch === 'function') {
  const fetch = globalThis.fetch;
  globalThis.fetch = (resource, options) => {
    const address = typeof resource === 'string' || resource instanceof URL ? resource : resource.url;
    assertCaptureRequest(address, options);
    return fetch(resource, options);
  };
}
syncBuiltinESMExports();
const hydrate = async (value) => {
  if (Array.isArray(value)) return Promise.all(value.map(hydrate));
  if (value && typeof value === 'object' && value.$wireconform === 'file') {
    return new File([Buffer.from(value.data, 'base64')], value.filename, { type: value.contentType });
  }
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const [key, child] of Object.entries(value)) result[key] = await hydrate(child);
    return result;
  }
  return value;
};
const body = await hydrate(input.body);
if (input.executionKind === 'hey-api-function') {
  const sdk = await import(new URL('./generated/sdk.gen.ts', import.meta.url).href);
  const operation = sdk[input.operationId];
  if (typeof operation !== 'function') throw new Error('operation is not exported by generated SDK');
  await operation({ body, baseURL: input.baseUrl, throwOnError: true });
} else {
  const [apiModule, configModule] = await Promise.all([
    import(new URL('./generated/index.ts', import.meta.url).href),
    import(new URL('./generated/configuration.ts', import.meta.url).href),
  ]);
  const Api = Object.values(apiModule).find((candidate) => typeof candidate === 'function' && candidate.prototype && typeof candidate.prototype[input.operationId] === 'function');
  if (typeof Api !== 'function') throw new Error('operation is not available in generated SDK');
  const configuration = new configModule.Configuration({ basePath: input.baseUrl });
  const client = new Api(configuration);
  await client[input.operationId](body);
}
`;

const safeEnv = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? '',
  TEMP: process.env.TEMP ?? '',
  TMP: process.env.TMP ?? '',
});

const writeWorker = async (runtimeDirectory: string): Promise<string> => {
  const generatedDirectory = path.join(runtimeDirectory, 'generated');
  await writeFile(path.join(generatedDirectory, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
  await symlink(nodeModulesPath, path.join(generatedDirectory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const workerPath = path.join(runtimeDirectory, 'worker.mjs');
  await writeFile(workerPath, workerCode, 'utf8');
  return workerPath;
};

const terminateWorkerTree = (child: ReturnType<typeof spawn>, force: boolean): void => {
  if (process.platform === 'win32' && child.pid !== undefined) {
    const taskkillPath = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    const terminator = spawn(taskkillPath, ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore', windowsHide: true });
    terminator.once('error', () => child.kill(force ? 'SIGKILL' : 'SIGTERM'));
    terminator.once('close', (code) => { if (code !== 0) child.kill(force ? 'SIGKILL' : 'SIGTERM'); });
    terminator.unref();
    return;
  }
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
      return;
    } catch {
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
      return;
    }
  }
  child.kill(force ? 'SIGKILL' : 'SIGTERM');
};

const executeSdk = (workerPath: string, cwd: string, input: JsonObject): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', tsxImport, workerPath], { cwd, env: safeEnv(), stdio: ['pipe', 'ignore', 'ignore'], detached: process.platform !== 'win32', windowsHide: true });
  let settled = false;
  let timedOut = false;
  let hardKillTimer: NodeJS.Timeout | undefined;
  const finish = (error?: WireConformError): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutTimer);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    if (error) reject(error);
    else resolve();
  };
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    terminateWorkerTree(child, false);
    hardKillTimer = setTimeout(() => {
      terminateWorkerTree(child, true);
      finish(new WireConformError('SDK_TIMEOUT', 'Generated SDK exceeded the 25 second execution limit.'));
    }, 1_000);
  }, 25_000);
  child.once('error', () => {
    finish(new WireConformError('SDK_EXECUTION', 'Could not start the generated SDK runner.'));
  });
  child.once('close', (code) => {
    if (timedOut) finish(new WireConformError('SDK_TIMEOUT', 'Generated SDK exceeded the 25 second execution limit.'));
    else if (code === 0) finish();
    else finish(new WireConformError('SDK_EXECUTION', 'Generated SDK did not complete the request.'));
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(JSON.stringify(input));
});

const caseResult = async (executionKind: GeneratorAdapter['executionKind'], workerPath: string, generatedDirectory: string, method: string, operationPath: string, operationId: string, allowsAdditionalProperties: boolean, fixtureCase: FixtureCase, expected: Awaited<ReturnType<typeof deriveExpectedParts>>): Promise<{ result: CaseResult; parts: CapturedPart[] }> => {
  const capture = await startCaptureServer(method, operationPath);
  let parts: CapturedPart[] = [];
  let sdkError: unknown;
  let captureError: unknown;
  try {
    const sdkPromise = executeSdk(workerPath, generatedDirectory, { executionKind, operationId, baseUrl: capture.url, body: fixtureCase.body }).catch((error: unknown) => { sdkError = error; });
    const firstOutcome = await Promise.race([
      capture.result.then((capturedParts) => ({ kind: 'capture' as const, capturedParts }), (error: unknown) => ({ kind: 'capture-error' as const, error })),
      sdkPromise.then(() => ({ kind: 'sdk-complete' as const })),
    ]);
    if (firstOutcome.kind === 'capture') {
      parts = firstOutcome.capturedParts;
      await sdkPromise;
    } else if (firstOutcome.kind === 'capture-error') {
      captureError = firstOutcome.error;
      await sdkPromise;
    } else if (sdkError) {
      sdkError = sdkError instanceof WireConformError ? sdkError : new WireConformError('SDK_EXECUTION', 'Generated SDK did not complete the request.');
    } else {
      captureError = new WireConformError('NO_CAPTURED_REQUEST', 'Generated SDK completed without sending a request to the loopback server.');
    }
  } finally {
    try {
      await capture.close();
    } catch {
      throw new WireConformError('CAPTURE_CLEANUP_FAILED', 'The loopback capture server could not close cleanly.');
    }
  }
  if (captureError instanceof WireConformError) {
    const conformanceFailure = ['MALFORMED_MULTIPART', 'REQUEST_METHOD_MISMATCH', 'REQUEST_PATH_MISMATCH'].includes(captureError.code);
    const diagnostic = toSafeDiagnostic(captureError);
    return { result: { name: fixtureCase.name, status: conformanceFailure ? 'fail' : 'error', partCount: 0, diagnostics: [{ code: diagnostic.code, message: diagnostic.message }] }, parts };
  }
  if (captureError instanceof Error) {
    return { result: { name: fixtureCase.name, status: 'error', partCount: 0, diagnostics: [{ code: 'CAPTURE_ERROR', message: 'The local capture server could not parse the generated request.' }] }, parts };
  }
  if (sdkError) {
    const diagnostic = sdkError instanceof WireConformError && sdkError.code === 'SDK_TIMEOUT'
      ? toSafeDiagnostic(sdkError)
      : toSafeDiagnostic(new WireConformError('SDK_EXECUTION', 'Generated SDK execution failed after sending its request.'));
    return { result: { name: fixtureCase.name, status: 'error', partCount: parts.length, diagnostics: [{ code: diagnostic.code, message: diagnostic.message }] }, parts };
  }
  const diagnostics = compareMultipart(parts, expected, fixtureCase, allowsAdditionalProperties);
  const hasUnsupported = diagnostics.some((diagnostic) => ['UNSUPPORTED_JSON_BODY', 'UNSUPPORTED_ADDITIONAL_PART'].includes(diagnostic.code));
  return { result: { name: fixtureCase.name, status: hasUnsupported ? 'error' : diagnostics.length > 0 ? 'fail' : 'pass', partCount: parts.length, diagnostics }, parts };
};

export const runFixtureWithAdapter = async (fixturePath: string, adapter: GeneratorAdapter): Promise<RunReport> => {
  const { openApiPath, fixture } = await loadFixture(fixturePath);
  const loaded = await loadOpenApi(openApiPath);
  const operation = loaded.operations.find((candidate) => candidate.operationId === fixture.operationId);
  if (!operation) throw new WireConformError('OPERATION_NOT_FOUND', `Multipart operationId ${fixture.operationId} was not found in the OpenAPI document.`);
  const preparedCases = await Promise.all(fixture.cases.map(async (fixtureCase) => {
    for (const partName of Object.keys(fixtureCase.assert?.parts ?? {})) {
      if (!(partName in operation.properties)) throw new WireConformError('INVALID_FIXTURE', `Fixture assertions reference undeclared multipart property ${partName}.`);
    }
    for (const assertions of Object.values(fixtureCase.assert?.parts ?? {})) {
      for (const headerName of Object.keys(assertions.headers ?? {})) {
        if (!['content-type', 'content-disposition', 'content-transfer-encoding'].includes(headerName.toLowerCase())) {
          throw new WireConformError('UNSUPPORTED_FIXTURE_HEADER', 'Fixture header assertions must use a header defined for multipart/form-data by RFC 7578.');
        }
      }
    }
    return { fixtureCase, expected: await deriveExpectedParts(operation, fixtureCase, loaded.openapi) };
  }));
  let adapterStatus: Awaited<ReturnType<GeneratorAdapter['available']>>;
  try {
    adapterStatus = await adapter.available();
  } catch (error) {
    adapterStatus = { ready: false, detail: toSafeDiagnostic(error).message };
  }
  if (!adapterStatus.ready) throw new WireConformError('ADAPTER_NOT_READY', adapterStatus.detail);
  const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), 'wireconform-'));
  const generatedDirectory = path.join(runtimeDirectory, 'generated');
  try {
    await mkdir(generatedDirectory, { recursive: true });
    try {
      await adapter.generate(loaded.path, generatedDirectory);
    } catch (error) {
      if (error instanceof WireConformError) throw error;
      throw new WireConformError('GENERATOR_FAILED', 'The selected generator could not generate an SDK.');
    }
    const workerPath = await writeWorker(runtimeDirectory);
    const results: CaseResult[] = [];
    for (const { fixtureCase, expected } of preparedCases) {
      const outcome = await caseResult(adapter.executionKind, workerPath, generatedDirectory, operation.method, operation.path, operation.operationId, operation.allowsAdditionalProperties, fixtureCase, expected);
      results.push(outcome.result);
    }
    const status = results.some((result) => result.status === 'error') ? 'error' : results.some((result) => result.status === 'fail') ? 'fail' : 'pass';
    return {
      wireconformVersion,
      createdAt: new Date().toISOString(),
      specification: { path: path.basename(loaded.path), openapi: loaded.openapi, operationId: operation.operationId, method: operation.method, pathTemplate: operation.path },
      adapter: { id: adapter.id, version: adapter.version },
      status,
      cases: results,
    };
  } finally {
    try {
      await rm(runtimeDirectory, { recursive: true, force: true });
    } catch {
      throw new WireConformError('TEMP_FILES_CLEANUP_FAILED', 'WireConform temporary files could not be removed.');
    }
  }
};

export const runFixture = async (fixturePath: string, adapterId: string): Promise<RunReport> => {
  const adapter = findAdapter(adapterId);
  if (!adapter) throw new WireConformError('UNKNOWN_ADAPTER', `Unknown adapter ${adapterId}. Run "wireconform adapters" to see supported adapters.`);
  return runFixtureWithAdapter(fixturePath, adapter);
};

export const listAdapters = async () => Promise.all(adapters.map(async (adapter) => {
  try {
    return { id: adapter.id, version: adapter.version, ...(await adapter.available()) };
  } catch (error) {
    return { id: adapter.id, version: adapter.version, ready: false, detail: toSafeDiagnostic(error).message };
  }
}));
