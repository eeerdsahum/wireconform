import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { WireConformError } from '../errors.js';
import type { GeneratorAdapter } from '../types.js';

const execFile = promisify(execFileCallback);
const expectedSha256 = '1760050094997b9cc790cc1350be095f15da8c08a996b184d3eadc4ccda5e35e';
const version = '7.26.0';
const maxJarBytes = 128 * 1024 * 1024;

const stageVerifiedJar = async (directory: string): Promise<string> => {
  const configured = process.env.WIRECONFORM_OPENAPI_GENERATOR_JAR;
  if (!configured) throw new WireConformError('ADAPTER_NOT_CONFIGURED', 'Set WIRECONFORM_OPENAPI_GENERATOR_JAR to the official OpenAPI Generator 7.26.0 CLI JAR.');
  let source: string;
  try {
    source = await realpath(path.resolve(configured));
  } catch {
    throw new WireConformError('ADAPTER_NOT_CONFIGURED', 'Configured OpenAPI Generator JAR could not be read.');
  }
  const staged = path.join(directory, `openapi-generator-cli-${version}.jar`);
  const hash = createHash('sha256');
  let totalBytes = 0;
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.length;
      if (totalBytes > maxJarBytes) {
        callback(new WireConformError('ADAPTER_INTEGRITY', 'Configured OpenAPI Generator JAR exceeds the 128 MiB safety limit.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(source), verifier, createWriteStream(staged, { flags: 'wx', mode: 0o600 }));
  } catch (error) {
    await rm(staged, { force: true });
    if (error instanceof WireConformError) throw error;
    throw new WireConformError('ADAPTER_NOT_CONFIGURED', 'Could not stage the configured OpenAPI Generator JAR.');
  }
  if (hash.digest('hex') !== expectedSha256) {
    await rm(staged, { force: true });
    throw new WireConformError('ADAPTER_INTEGRITY', 'Configured OpenAPI Generator JAR does not match the pinned 7.26.0 artifact.');
  }
  return staged;
};

const getJava = (): string => {
  const home = process.env.JAVA_HOME;
  if (home) return path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  return process.platform === 'win32' ? 'java.exe' : 'java';
};

const safeEnv = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? '',
  TEMP: process.env.TEMP ?? '',
  TMP: process.env.TMP ?? '',
  ...(process.env.JAVA_HOME === undefined ? {} : { JAVA_HOME: process.env.JAVA_HOME }),
});

const assertJavaAndJar = async (jar: string): Promise<{ java: string; jar: string }> => {
  const java = getJava();
  try {
    const output = await execFile(java, ['-version'], { env: safeEnv(), timeout: 10_000, maxBuffer: 1024 * 1024 });
    const versionText = `${output.stdout}\n${output.stderr}`;
    const match = /version "(\d+)/.exec(versionText);
    if (!match || Number(match[1]) < 11) throw new WireConformError('JAVA_VERSION', 'OpenAPI Generator 7.26.0 requires Java 11 or newer.');
    const generator = await execFile(java, ['-jar', jar, 'version'], { env: safeEnv(), timeout: 30_000, maxBuffer: 1024 * 1024 });
    if (!generator.stdout.includes(version) && !generator.stderr.includes(version)) {
      throw new WireConformError('ADAPTER_VERSION', `Configured OpenAPI Generator must report version ${version}.`);
    }
  } catch (error) {
    if (error instanceof WireConformError) throw error;
    throw new WireConformError('JAVA_UNAVAILABLE', 'Could not run Java 11+ with the pinned OpenAPI Generator JAR.');
  }
  return { java, jar };
};

export const openApiGeneratorAdapter: GeneratorAdapter = {
  id: 'openapi-generator',
  version,
  executionKind: 'openapi-generator-axios',
  available: async () => {
    let directory: string | undefined;
    try {
      directory = await mkdtemp(path.join(os.tmpdir(), 'wireconform-oag-check-'));
      const jar = await stageVerifiedJar(directory);
      await assertJavaAndJar(jar);
      return { ready: true, detail: `Official typescript-axios generator ${version}; JAR checksum verified` };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : 'Adapter is not configured.' };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  },
  generate: async (openApiPath, outputDirectory) => {
    const jar = await stageVerifiedJar(path.dirname(outputDirectory));
    try {
      const { java } = await assertJavaAndJar(jar);
      await execFile(java, [
        '-jar', jar, 'generate', '-i', openApiPath, '-g', 'typescript-axios', '-o', outputDirectory,
        '-p', 'apiPackage=api,modelPackage=models,withSeparateModelsAndApi=true,useSingleRequestParameter=true',
        '--global-property=apiTests=false,modelTests=false',
      ], { cwd: path.dirname(outputDirectory), env: safeEnv(), timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
      if (error instanceof WireConformError) throw error;
      throw new WireConformError('GENERATOR_FAILED', `OpenAPI Generator ${version} could not generate the TypeScript Axios SDK.`);
    } finally {
      await rm(jar, { force: true });
    }
  },
};
