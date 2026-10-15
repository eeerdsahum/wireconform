import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { WireConformError } from './errors.js';
import type { RunReport } from './types.js';

export const defaultReportPath = (): string => path.resolve(process.cwd(), '.wireconform', 'latest-report.json');
const maxReportBytes = 1024 * 1024;

const ensureDirectoryPath = async (directory: string): Promise<void> => {
  const root = path.parse(directory).root;
  let current = root;
  for (const segment of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if (!(mkdirError instanceof Error) || !('code' in mkdirError) || mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      stats = await lstat(current);
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new WireConformError('UNSAFE_REPORT_PATH', 'Report output cannot traverse symbolic links or non-directory paths.');
    }
  }
};

const assertDirectoryPath = async (directory: string): Promise<void> => {
  const root = path.parse(directory).root;
  let current = root;
  for (const segment of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new WireConformError('UNSAFE_REPORT_PATH', 'Report input cannot traverse symbolic links or non-directory paths.');
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isStatus = (value: unknown): value is 'pass' | 'fail' | 'error' => value === 'pass' || value === 'fail' || value === 'error';

const isCaseResult = (item: unknown): item is RunReport['cases'][number] => {
  if (!isRecord(item) || !hasExactKeys(item, ['name', 'status', 'partCount', 'diagnostics'])) return false;
  if (!isNonEmptyString(item.name) || !isStatus(item.status) || typeof item.partCount !== 'number' || !Number.isInteger(item.partCount) || item.partCount < 0 || !Array.isArray(item.diagnostics)) return false;
  const diagnosticsValid = item.diagnostics.every((diagnostic) => {
    if (!isRecord(diagnostic) || !isNonEmptyString(diagnostic.code) || !isNonEmptyString(diagnostic.message)) return false;
    if (Object.keys(diagnostic).some((key) => !['code', 'message', 'part', 'expected', 'actual'].includes(key))) return false;
    if (diagnostic.part !== undefined && typeof diagnostic.part !== 'string') return false;
    for (const key of ['expected', 'actual']) {
      const field = diagnostic[key];
      if (field !== undefined && typeof field !== 'string' && typeof field !== 'number') return false;
    }
    return true;
  });
  if (!diagnosticsValid) return false;
  return item.status === 'pass' ? item.diagnostics.length === 0 : item.diagnostics.length > 0;
};

const isReport = (value: unknown): value is RunReport => {
  if (!isRecord(value) || !hasExactKeys(value, ['wireconformVersion', 'createdAt', 'specification', 'adapter', 'status', 'cases'])) return false;
  if (!isNonEmptyString(value.wireconformVersion) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !isStatus(value.status) || !Array.isArray(value.cases) || value.cases.length === 0 || !value.cases.every(isCaseResult)) return false;
  const specification = value.specification;
  const adapter = value.adapter;
  if (!isRecord(specification) || !hasExactKeys(specification, ['path', 'openapi', 'operationId', 'method', 'pathTemplate'])) return false;
  if (!['path', 'openapi', 'operationId', 'method', 'pathTemplate'].every((key) => isNonEmptyString(specification[key]))) return false;
  if (!isRecord(adapter) || !hasExactKeys(adapter, ['id', 'version']) || !isNonEmptyString(adapter.id) || !isNonEmptyString(adapter.version)) return false;
  const cases = value.cases as RunReport['cases'];
  const expectedStatus = cases.some((item) => item.status === 'error') ? 'error' : cases.some((item) => item.status === 'fail') ? 'fail' : 'pass';
  return value.status === expectedStatus;
};

export const writeReport = async (report: RunReport, filePath = defaultReportPath()): Promise<string> => {
  try {
    const absolutePath = path.resolve(filePath);
    await ensureDirectoryPath(path.dirname(absolutePath));
    try {
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink() || !stats.isFile()) throw new WireConformError('UNSAFE_REPORT_PATH', 'Report output must be a regular file, not a symbolic link or directory.');
    } catch (error) {
      if (error instanceof WireConformError) throw error;
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    const handle = await open(absolutePath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    return absolutePath;
  } catch (error) {
    if (error instanceof WireConformError) throw error;
    throw new WireConformError('REPORT_WRITE_FAILED', 'The WireConform report could not be written.');
  }
};

export const readReport = async (filePath = defaultReportPath()): Promise<RunReport> => {
  const absolutePath = path.resolve(filePath);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let contents: string;
  try {
    await assertDirectoryPath(path.dirname(absolutePath));
    const pathStats = await lstat(absolutePath);
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) throw new WireConformError('UNSAFE_REPORT_PATH', 'Report input must be a regular file, not a symbolic link or directory.');
    if (pathStats.size > maxReportBytes) throw new WireConformError('REPORT_TOO_LARGE', 'Report input exceeds the 1 MiB size limit.');
    handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const openedStats = await handle.stat();
    if (!openedStats.isFile() || openedStats.dev !== pathStats.dev || openedStats.ino !== pathStats.ino) throw new WireConformError('UNSAFE_REPORT_PATH', 'Report input changed while it was being opened.');
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const chunk = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxReportBytes) throw new WireConformError('REPORT_TOO_LARGE', 'Report input exceeds the 1 MiB size limit.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    contents = Buffer.concat(chunks, totalBytes).toString('utf8');
  } catch (error) {
    if (error instanceof WireConformError) throw error;
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ELOOP') {
      throw new WireConformError('UNSAFE_REPORT_PATH', 'Report input cannot be a symbolic link.');
    }
    throw new WireConformError('REPORT_NOT_FOUND', `Could not read a WireConform report at ${absolutePath}.`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    throw new WireConformError('INVALID_REPORT', 'Report file is not a valid WireConform JSON report.');
  }
  if (!isReport(value)) throw new WireConformError('INVALID_REPORT', 'Report file is not a valid WireConform JSON report.');
  return value as RunReport;
};
