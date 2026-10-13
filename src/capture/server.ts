import { createServer, type IncomingMessage } from 'node:http';
import { WireConformError } from '../errors.js';
import { parseMultipart } from '../multipart/parser.js';
import type { CapturedPart } from '../types.js';

const maxRequestBytes = 12 * 1024 * 1024;

export type CaptureServer = {
  url: string;
  result: Promise<CapturedPart[]>;
  close(): Promise<void>;
};

const captureRequest = async (request: IncomingMessage, expectedMethod: string, expectedPath: string): Promise<CapturedPart[]> => {
  const declaredLength = Number(request.headers['content-length'] ?? 0);
  if (declaredLength > maxRequestBytes) throw new WireConformError('REQUEST_TOO_LARGE', `Captured request exceeds ${maxRequestBytes} bytes.`, 1);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > maxRequestBytes) throw new WireConformError('REQUEST_TOO_LARGE', `Captured request exceeds ${maxRequestBytes} bytes.`, 1);
    chunks.push(data);
  }
  const actualTarget = new URL(request.url ?? '/', 'http://127.0.0.1');
  const expectedPathname = new URL(expectedPath, 'http://127.0.0.1').pathname;
  if (request.method !== expectedMethod) throw new WireConformError('REQUEST_METHOD_MISMATCH', 'Generated SDK used an unexpected HTTP method.', 1);
  if (actualTarget.pathname !== expectedPathname || actualTarget.search.length > 0) throw new WireConformError('REQUEST_PATH_MISMATCH', 'Generated SDK sent the multipart request to an unexpected path.', 1);
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string') throw new WireConformError('MALFORMED_MULTIPART', 'Captured request has no Content-Type header.', 1);
  const parts = parseMultipart(contentType, Buffer.concat(chunks, size));
  return parts;
};

export const startCaptureServer = async (expectedMethod: string, expectedPath: string, timeoutMs = 20_000): Promise<CaptureServer> => {
  let resolveResult: (parts: CapturedPart[]) => void = () => undefined;
  let rejectResult: (error: Error) => void = () => undefined;
  let settled = false;
  let requestReceived = false;
  const result = new Promise<CapturedPart[]>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const server = createServer((request, response) => {
    if (requestReceived) {
      response.writeHead(409).end();
      return;
    }
    requestReceived = true;
    void captureRequest(request, expectedMethod, expectedPath).then((parts) => {
      response.writeHead(204).end();
      if (!settled) {
        settled = true;
        resolveResult(parts);
      }
    }).catch((error: unknown) => {
      response.writeHead(error instanceof WireConformError ? 400 : 500).end();
      if (!settled) {
        settled = true;
        rejectResult(error instanceof Error ? error : new Error('Capture failed.'));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new WireConformError('CAPTURE_SERVER', 'Could not obtain loopback capture server address.');
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectResult(new WireConformError('CAPTURE_TIMEOUT', `No multipart request reached the loopback server within ${timeoutMs} ms.`, 1));
    }
  }, timeoutMs);
  timer.unref();
  return {
    url: `http://127.0.0.1:${address.port}`,
    result,
    close: async () => {
      clearTimeout(timer);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
};
