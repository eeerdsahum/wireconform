import { execFile as execFileCallback } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { WireConformError } from '../errors.js';
import type { GeneratorAdapter } from '../types.js';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const version = '0.99.0';

const resolveInstallation = (): { packageRoot: string; version: string } | undefined => {
  try {
    const packagePath = require.resolve('@hey-api/openapi-ts/package.json');
    const packageRoot = path.dirname(packagePath);
    const packageJson = require(packagePath) as { version: string };
    return { packageRoot, version: packageJson.version };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'MODULE_NOT_FOUND') return undefined;
    throw error;
  }
};

const safeEnv = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? '',
  TEMP: process.env.TEMP ?? '',
  TMP: process.env.TMP ?? '',
});

export const heyApiAdapter: GeneratorAdapter = {
  id: 'hey-api',
  version,
  executionKind: 'hey-api-function',
  available: async () => {
    const installation = resolveInstallation();
    if (!installation) return { ready: false, detail: 'Install @hey-api/openapi-ts@0.99.0 in the project to enable the Hey API baseline adapter.' };
    if (installation.version !== version) return { ready: false, detail: `Hey API baseline requires @hey-api/openapi-ts ${version}; found ${installation.version}.` };
    return { ready: true, detail: `Found pinned package @hey-api/openapi-ts ${version}` };
  },
  generate: async (openApiPath, outputDirectory) => {
    const installation = resolveInstallation();
    if (!installation || installation.version !== version) throw new WireConformError('ADAPTER_NOT_READY', `Install @hey-api/openapi-ts@${version} in the project to enable the Hey API baseline adapter.`);
    const executable = path.join(installation.packageRoot, 'bin', 'run.js');
    try {
      await execFile(process.execPath, [executable, '-i', openApiPath, '-o', outputDirectory, '-c', '@hey-api/client-axios'], {
        cwd: path.dirname(outputDirectory),
        env: safeEnv(),
        timeout: 90_000,
        maxBuffer: 5 * 1024 * 1024,
      });
    } catch {
      throw new WireConformError('GENERATOR_FAILED', `Could not generate an SDK with @hey-api/openapi-ts ${version}.`);
    }
  },
};
