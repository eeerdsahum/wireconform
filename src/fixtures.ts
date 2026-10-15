import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { createYamlDiagnosticContext, WireConformError } from './errors.js';
import { inspectJsonText, isSafeJsonValue } from './json.js';
import { isObject } from './openapi.js';
import type { FixtureCase, FixtureFile, JsonObject } from './types.js';

const maxFixtureBytes = 2 * 1024 * 1024;
const maxFileBytes = 10 * 1024 * 1024;
const maxFixtureFilesBytes = 64 * 1024 * 1024;

const readStructuredBytes = async (filePath: string): Promise<Buffer> => {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new WireConformError('INVALID_FIXTURE', 'Fixture must be a regular file.');
    if (stats.size > maxFixtureBytes) throw new WireConformError('FIXTURE_TOO_LARGE', `Fixture exceeds ${maxFixtureBytes} bytes.`);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= maxFixtureBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxFixtureBytes + 1 - totalBytes));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, totalBytes);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxFixtureBytes) throw new WireConformError('FIXTURE_TOO_LARGE', `Fixture exceeds ${maxFixtureBytes} bytes.`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
};

const parseStructuredFile = async (filePath: string): Promise<unknown> => {
  let bytes: Buffer;
  try {
    bytes = await readStructuredBytes(filePath);
  } catch (error) {
    if (error instanceof WireConformError) throw error;
    const code = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 'FIXTURE_NOT_FOUND' : 'FIXTURE_UNREADABLE';
    throw new WireConformError(code, 'Fixture could not be read.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new WireConformError('INVALID_FIXTURE', 'Fixture must contain valid UTF-8 text.');
  }
  if (path.extname(filePath).toLowerCase() === '.json') {
    const inspected = inspectJsonText(text);
    if (inspected.kind === 'malformed') throw new WireConformError('INVALID_FIXTURE', 'Fixture is not valid JSON.');
    if (inspected.kind === 'ambiguous') throw new WireConformError('INVALID_FIXTURE', 'Fixture JSON cannot contain duplicate object keys.');
    if (inspected.kind === 'unsupported') throw new WireConformError('INVALID_FIXTURE', 'Fixture numbers must be finite and within JavaScript safe integer precision.');
    return inspected.value;
  }
  let parsed;
  try {
    parsed = parseDocument(text, { uniqueKeys: true });
  } catch {
    throw new WireConformError('INVALID_FIXTURE', 'Fixture YAML is invalid.');
  }
  if (parsed.errors.length > 0) {
    const firstPosition = parsed.errors[0]?.linePos?.[0];
    const line = firstPosition?.line;
    const column = firstPosition?.col;
    const context = createYamlDiagnosticContext('fixture', line, column);
    throw new WireConformError('INVALID_FIXTURE', 'Fixture YAML is invalid.', 2, context);
  }
  try {
    const value = parsed.toJS({ maxAliasCount: 100 }) as unknown;
    if (!isSafeJsonValue(value)) throw new Error('Fixture values are not safe JSON values.');
    return value;
  } catch {
    throw new WireConformError('INVALID_FIXTURE', 'Fixture YAML could not be converted safely.');
  }
};

const readFixtureFile = async (filePath: string): Promise<Buffer> => {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new WireConformError('INVALID_FIXTURE', 'File markers must resolve to regular files.');
    if (stats.size > maxFileBytes) throw new WireConformError('FIXTURE_FILE_TOO_LARGE', `Fixture file exceeds ${maxFileBytes} bytes.`);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= maxFileBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxFileBytes + 1 - totalBytes));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, totalBytes);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxFileBytes) throw new WireConformError('FIXTURE_FILE_TOO_LARGE', `Fixture file exceeds ${maxFileBytes} bytes.`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
};

const normalizeFileMarkers = async (value: unknown, fixtureRoot: string, fileBudget: { totalBytes: number }): Promise<unknown> => {
  if (Array.isArray(value)) {
    const normalized: unknown[] = [];
    for (const item of value) normalized.push(await normalizeFileMarkers(item, fixtureRoot, fileBudget));
    return normalized;
  }
  if (!isObject(value)) return value;
  if (value.$wireconform === 'file') {
    if (typeof value.path !== 'string' || value.path.length === 0) throw new WireConformError('INVALID_FIXTURE', 'A file marker must include a path.');
    let filePath: string;
    try {
      filePath = await realpath(path.resolve(fixtureRoot, value.path));
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 'FIXTURE_FILE_NOT_FOUND' : 'FIXTURE_FILE_UNREADABLE';
      throw new WireConformError(code, 'A file referenced by the fixture could not be opened.');
    }
    const relative = path.relative(fixtureRoot, filePath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new WireConformError('FIXTURE_PATH_ESCAPE', 'Fixture file paths must stay within the fixture directory.');
    }
    let file: Buffer;
    try {
      file = await readFixtureFile(filePath);
    } catch (error) {
      if (error instanceof WireConformError) throw error;
      const code = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 'FIXTURE_FILE_NOT_FOUND' : 'FIXTURE_FILE_UNREADABLE';
      throw new WireConformError(code, 'A file referenced by the fixture could not be read.');
    }
    if (file.byteLength > maxFileBytes) throw new WireConformError('FIXTURE_FILE_TOO_LARGE', `Fixture file exceeds ${maxFileBytes} bytes.`);
    fileBudget.totalBytes += file.byteLength;
    if (fileBudget.totalBytes > maxFixtureFilesBytes) throw new WireConformError('FIXTURE_FILES_TOO_LARGE', `Fixture files exceed the combined ${maxFixtureFilesBytes} byte limit.`);
    const filename = typeof value.filename === 'string' ? value.filename : path.basename(filePath);
    if (filename.length === 0 || /[\r\n\0]/.test(filename)) throw new WireConformError('INVALID_FIXTURE', 'File marker filename is invalid.');
    const contentType = typeof value.contentType === 'string' ? value.contentType : 'application/octet-stream';
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(contentType)) throw new WireConformError('INVALID_FIXTURE', 'File marker contentType must be a media type without parameters.');
    return { $wireconform: 'file', data: file.toString('base64'), filename, contentType };
  }
  const result: JsonObject = Object.create(null) as JsonObject;
  for (const [key, child] of Object.entries(value)) result[key] = await normalizeFileMarkers(child, fixtureRoot, fileBudget);
  return result;
};

const validateFixtureCase = async (value: unknown, index: number, fixtureRoot: string, fileBudget: { totalBytes: number }): Promise<FixtureCase> => {
  if (!isObject(value) || typeof value.name !== 'string' || value.name.trim().length === 0 || !isObject(value.body)) {
    throw new WireConformError('INVALID_FIXTURE', `Fixture case ${index + 1} must have a name and a body object.`);
  }
  if (value.assert !== undefined && !isObject(value.assert)) throw new WireConformError('INVALID_FIXTURE', `Fixture case ${value.name} has invalid assertions.`);
  const body = await normalizeFileMarkers(value.body, fixtureRoot, fileBudget);
  if (!isObject(body)) throw new WireConformError('INVALID_FIXTURE', `Fixture case ${value.name} body must be an object.`);
  let assertion: FixtureCase['assert'];
  if (isObject(value.assert)) {
    if (value.assert.parts !== undefined && !isObject(value.assert.parts)) throw new WireConformError('INVALID_FIXTURE', `Fixture case ${value.name} assertions.parts must be an object.`);
    if (isObject(value.assert.parts)) {
      const parts = Object.create(null) as NonNullable<NonNullable<FixtureCase['assert']>['parts']>;
      for (const [partName, partAssertion] of Object.entries(value.assert.parts)) {
        if (!isObject(partAssertion)) throw new WireConformError('INVALID_FIXTURE', `Fixture case ${value.name} has invalid assertions for ${partName}.`);
        if (partAssertion.count !== undefined && (!Number.isInteger(partAssertion.count) || (partAssertion.count as number) < 0)) {
          throw new WireConformError('INVALID_FIXTURE', `Fixture case ${value.name} count assertion for ${partName} must be a non-negative integer.`);
        }
        if (partAssertion.contentType !== undefined && typeof partAssertion.contentType !== 'string') {
          throw new WireConformError('INVALID_FIXTURE', `Fixture case ${value.name} contentType assertion for ${partName} must be a string.`);
        }
        if (partAssertion.headers !== undefined && !isObject(partAssertion.headers)) {
          throw new WireConformError('INVALID_FIXTURE', `Fixture case ${value.name} header assertions for ${partName} must be an object.`);
        }
        const headers: Record<string, string> = Object.create(null) as Record<string, string>;
        if (isObject(partAssertion.headers)) {
          for (const [headerName, headerValue] of Object.entries(partAssertion.headers)) {
            if (typeof headerValue !== 'string' || /[\r\n\0]/.test(headerName)) {
              throw new WireConformError('INVALID_FIXTURE', `Fixture case ${value.name} has an invalid header assertion.`);
            }
            headers[headerName] = headerValue;
          }
        }
        parts[partName] = {
          ...(typeof partAssertion.count === 'number' ? { count: partAssertion.count } : {}),
          ...(typeof partAssertion.contentType === 'string' ? { contentType: partAssertion.contentType } : {}),
          ...(partAssertion.headers === undefined ? {} : { headers }),
        };
      }
      assertion = { parts };
    }
  }
  return { name: value.name, body, ...(assertion === undefined ? {} : { assert: assertion }) };
};

export const loadFixture = async (filePath: string): Promise<{ path: string; openApiPath: string; fixture: FixtureFile }> => {
  let absolutePath: string;
  try {
    absolutePath = await realpath(path.resolve(filePath));
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 'FIXTURE_NOT_FOUND' : 'FIXTURE_UNREADABLE';
    throw new WireConformError(code, 'Fixture could not be opened.');
  }
  const value = await parseStructuredFile(absolutePath);
  if (!isObject(value) || value.fixtureVersion !== 1 || typeof value.openapi !== 'string' || typeof value.operationId !== 'string' || !Array.isArray(value.cases)) {
    throw new WireConformError('INVALID_FIXTURE', 'Fixture requires fixtureVersion: 1, openapi, operationId, and cases.');
  }
  if (value.cases.length === 0 || value.cases.length > 100) throw new WireConformError('INVALID_FIXTURE', 'Fixture must contain between 1 and 100 cases.');
  const fixtureRoot = path.dirname(absolutePath);
  const fileBudget = { totalBytes: 0 };
  const cases: FixtureCase[] = [];
  for (const [index, item] of value.cases.entries()) cases.push(await validateFixtureCase(item, index, fixtureRoot, fileBudget));
  const names = new Set<string>();
  for (const fixtureCase of cases) {
    if (names.has(fixtureCase.name)) throw new WireConformError('INVALID_FIXTURE', `Duplicate fixture case name: ${fixtureCase.name}.`);
    names.add(fixtureCase.name);
  }
  return {
    path: absolutePath,
    openApiPath: path.resolve(fixtureRoot, value.openapi),
    fixture: { fixtureVersion: 1, openapi: value.openapi, operationId: value.operationId, cases },
  };
};
