import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareMultipart } from '../dist/multipart/compare.js';
import { escapeTerminalText } from '../dist/cli.js';
import { deriveExpectedParts } from '../dist/multipart/expectations.js';
import { loadFixture } from '../dist/fixtures.js';
import { loadOpenApi, resolveLocalReference } from '../dist/openapi.js';
import { parseMultipart } from '../dist/multipart/parser.js';
import { readReport, writeReport } from '../dist/report.js';

const openApiText = (version, fieldSchema, required = ['payload']) => `
openapi: ${version}
info:
  title: test
  version: 1.0.0
paths:
  /upload:
    post:
      operationId: upload
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: ${JSON.stringify(required)}
              properties:
${fieldSchema}
            encoding:
              payload:
                contentType: application/json
      responses:
        '204':
          description: done
`;

const withTempDir = async (run) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wireconform-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('derives OpenAPI 3.0 and 3.1 multipart defaults separately', async () => {
  await withTempDir(async (directory) => {
    const schema = `                payload:\n                  type: object\n                binaryLegacy:\n                  type: string\n                  format: binary\n                binaryEncoded:\n                  type: string\n                  format: binary\n                  contentEncoding: base64\n                note:\n                  type: string\n                items:\n                  type: array\n                  items:\n                    type: object\n`;
    const fields = ['payload', 'binaryLegacy', 'binaryEncoded', 'note', 'items'];
    const required = fields;
    const v30Path = path.join(directory, 'v30.yaml');
    const v31Path = path.join(directory, 'v31.yaml');
    const filePath = path.join(directory, 'tiny.bin');
    const fileData = Buffer.from([0, 1, 2]);
    const fileContent = fileData.toString('base64');
    await writeFile(filePath, fileData);
    const schema30 = schema.replace('                  contentEncoding: base64\n', '');
    await writeFile(v30Path, openApiText('3.0.4', schema30, required));
    await writeFile(v31Path, openApiText('3.1.1', schema, required));
    const v30 = await loadOpenApi(v30Path);
    const v31 = await loadOpenApi(v31Path);
    const fixtureCase = { name: 'defaults', body: { payload: {}, binaryLegacy: { $wireconform: 'file', data: fileContent, filename: 'x.bin', contentType: 'application/octet-stream' }, binaryEncoded: { $wireconform: 'file', data: fileContent, filename: 'x.bin', contentType: 'application/octet-stream' }, note: 'plain', items: [{ id: 1 }] } };
    const v30Parts = await deriveExpectedParts(v30.operations[0], fixtureCase, v30.openapi);
    const fixtureCase31 = { ...fixtureCase, body: { ...fixtureCase.body, binaryLegacy: 'plain-string' } };
    const v31Parts = await deriveExpectedParts(v31.operations[0], fixtureCase31, v31.openapi);
    assert.equal(v30Parts.find((part) => part.name === 'binaryLegacy')?.contentType, 'application/octet-stream');
    assert.equal(v31Parts.find((part) => part.name === 'binaryLegacy')?.contentType, 'text/plain');
    assert.equal(v31Parts.find((part) => part.name === 'binaryEncoded')?.contentType, 'application/octet-stream');
    assert.equal(v31Parts.find((part) => part.name === 'binaryEncoded')?.expectedHeaders['content-transfer-encoding'], 'base64');
    assert.equal(v31Parts.find((part) => part.name === 'binaryEncoded')?.bodies[0]?.toString(), 'AAEC');
    assert.equal(v31Parts.find((part) => part.name === 'payload')?.contentType, 'application/json');
    assert.equal(v31Parts.find((part) => part.name === 'items')?.count, 1);
    const noTypePath = path.join(directory, 'v31-no-type.yaml');
    const noTypeSchema = `${schema}                arbitrary: {}\n`;
    await writeFile(noTypePath, openApiText('3.1.1', noTypeSchema, [...fields, 'arbitrary']));
    const noTypeDocument = await loadOpenApi(noTypePath);
    const noTypeFixture = { name: 'absent-type', body: { arbitrary: { $wireconform: 'file', data: fileContent, filename: 'x.bin', contentType: 'application/octet-stream' } } };
    assert.equal((await deriveExpectedParts(noTypeDocument.operations[0], noTypeFixture, noTypeDocument.openapi)).find((part) => part.name === 'arbitrary')?.contentType, 'application/octet-stream');
    const encodedUnknownTypeSpec = openApiText('3.1.1', '                arbitrary:\n                  contentEncoding: base64\n', ['arbitrary']).replace(/            encoding:\n              payload:\n                contentType: application\/json\n/, '');
    await writeFile(noTypePath, encodedUnknownTypeSpec);
    const encodedUnknownType = await loadOpenApi(noTypePath);
    const encodedUnknownFixture = { name: 'encoded-without-type', body: { arbitrary: { $wireconform: 'file', data: fileContent, filename: 'x.bin', contentType: 'application/octet-stream' } } };
    const encodedUnknownPart = (await deriveExpectedParts(encodedUnknownType.operations[0], encodedUnknownFixture, encodedUnknownType.openapi)).find((part) => part.name === 'arbitrary');
    assert.equal(encodedUnknownPart?.contentType, 'application/octet-stream');
    assert.equal(encodedUnknownPart?.expectedHeaders['content-transfer-encoding'], undefined);
    assert.deepEqual(encodedUnknownPart?.bodies[0], Buffer.from([0, 1, 2]));
    const bytePath = path.join(directory, 'v30-byte.yaml');
    const byteSpec = openApiText('3.0.4', '                payload:\n                  type: string\n                  format: byte\n').replace(/            encoding:\n              payload:\n                contentType: application\/json\n/, '');
    await writeFile(bytePath, byteSpec);
    const byteDocument = await loadOpenApi(bytePath);
    const byteFixture = { name: 'byte-format', body: { payload: { $wireconform: 'file', data: fileContent, filename: 'x.bin', contentType: 'application/octet-stream' } } };
    const bytePart = (await deriveExpectedParts(byteDocument.operations[0], byteFixture, byteDocument.openapi))[0];
    assert.equal(bytePart?.contentType, 'application/octet-stream');
    assert.equal(bytePart?.expectedHeaders['content-transfer-encoding'], 'base64');
    assert.equal(bytePart?.bodies[0]?.toString(), 'AAEC');
  });
});

test('expects RFC 4648 padding for OpenAPI 3.1 base64url file parts', async () => {
  await withTempDir(async (directory) => {
    const specificationPath = path.join(directory, 'openapi.yaml');
    const bytes = Buffer.from([251, 255]);
    const schema = '                payload:\n                  type: string\n                  contentEncoding: base64url\n';
    const specification = openApiText('3.1.2', schema).replace(/            encoding:\n              payload:\n                contentType: application\/json\n/, '');
    await writeFile(specificationPath, specification);
    const document = await loadOpenApi(specificationPath);
    const fixtureCase = { name: 'base64url', body: { payload: { $wireconform: 'file', data: bytes.toString('base64'), filename: 'tiny.bin', contentType: 'application/octet-stream' } } };
    const expected = await deriveExpectedParts(document.operations[0], fixtureCase, document.openapi);
    assert.equal(expected[0]?.bodies[0]?.toString(), '-_8=');
    assert.equal(expected[0]?.expectedHeaders['content-transfer-encoding'], 'base64url');
  });
});

test('rejects fixture arrays that violate minItems instead of inventing expected parts', async () => {
  await withTempDir(async (directory) => {
    const specificationPath = path.join(directory, 'openapi.yaml');
    const schema = '                payload:\n                  type: array\n                  minItems: 2\n                  items:\n                    type: object\n';
    await writeFile(specificationPath, openApiText('3.0.4', schema));
    const document = await loadOpenApi(specificationPath);
    await assert.rejects(deriveExpectedParts(document.operations[0], { name: 'too-few', body: { payload: [{ id: 1 }] } }, document.openapi), { code: 'INVALID_FIXTURE' });
    await writeFile(specificationPath, openApiText('3.0.4', schema.replace('minItems: 2', 'minItems: -1')));
    await assert.rejects(loadOpenApi(specificationPath), { code: 'INVALID_DOCUMENT' });
  });
});

test('loads local references and rejects unsupported OpenAPI versions and remote references', async () => {
  await withTempDir(async (directory) => {
    const localPath = path.join(directory, 'local.yaml');
    const localSpec = `${openApiText('3.0.4', '                payload:\n                  $ref: \'#/components/schemas/Document\'\n')}
components:
  schemas:
    Document:
      type: object
`;
    await writeFile(localPath, localSpec);
    assert.equal((await loadOpenApi(localPath)).operations[0]?.properties.payload?.type, 'object');
    const encodedReferenceSpec = `${openApiText('3.0.4', '                payload:\n                  $ref: \'#/components/schemas/a%7E1b\'\n')}
components:
  schemas:
    a/b:
      type: string
`;
    await writeFile(localPath, encodedReferenceSpec);
    assert.equal((await loadOpenApi(localPath)).operations[0]?.properties.payload?.type, 'string');
    await writeFile(localPath, openApiText('3.2.0', '                payload:\n                  type: string\n'));
    await assert.rejects(loadOpenApi(localPath), { code: 'UNSUPPORTED_OPENAPI_VERSION' });
    await writeFile(localPath, openApiText('3.0.4', '                payload:\n                  $ref: https://example.invalid/schema.yaml\n'));
    await assert.rejects(loadOpenApi(localPath), { code: 'UNSUPPORTED_REFERENCE' });
    await writeFile(localPath, `${openApiText('3.0.4', '                payload:\n                  type: string\n')}
  /upload-json:
    post:
      operationId: otherMediaType
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                payload:
                  type: string
          application/json:
            schema:
              type: object
`);
    await assert.rejects(loadOpenApi(localPath), { code: 'UNSUPPORTED_REQUEST_MEDIA_TYPES' });
    await writeFile(localPath, openApiText('3.0.4', '                payload:\n                  type: string\n').replace('      operationId: upload\n', `      operationId: upload
      parameters:
        - name: search
          in: query
          required: false
          schema:
            type: string
`));
    await assert.rejects(loadOpenApi(localPath), { code: 'UNSUPPORTED_PARAMETERS' });
  });
});

test('rejects invalid required declarations and oversized structured inputs before parsing', async () => {
  await withTempDir(async (directory) => {
    const specificationPath = path.join(directory, 'openapi.yaml');
    await writeFile(specificationPath, openApiText('3.0.4', '                payload:\n                  type: string\n').replace('required: ["payload"]', 'required: [payload, 3]'));
    await assert.rejects(loadOpenApi(specificationPath), { code: 'INVALID_DOCUMENT' });
    await writeFile(specificationPath, openApiText('3.0.4', '                payload:\n                  type: string\n').replace('required: ["payload"]', 'required: [payload, payload]'));
    await assert.rejects(loadOpenApi(specificationPath), { code: 'INVALID_DOCUMENT' });
    await truncate(specificationPath, 5 * 1024 * 1024 + 1);
    await assert.rejects(loadOpenApi(specificationPath), { code: 'SPEC_TOO_LARGE' });
    const fixturePath = path.join(directory, 'fixture.yaml');
    await writeFile(fixturePath, '');
    await truncate(fixturePath, 2 * 1024 * 1024 + 1);
    await assert.rejects(loadFixture(fixturePath), { code: 'FIXTURE_TOO_LARGE' });
  });
});

test('treats OpenAPI readOnly required parts according to the declared version', async () => {
  await withTempDir(async (directory) => {
    const specificationPath = path.join(directory, 'read-only.yaml');
    const schema = '                payload:\n                  type: string\n                  readOnly: true\n';
    await writeFile(specificationPath, openApiText('3.0.4', schema));
    const v30 = await loadOpenApi(specificationPath);
    assert.equal(v30.operations[0]?.required.has('payload'), false);
    assert.equal('payload' in (v30.operations[0]?.properties ?? {}), false);
    await writeFile(specificationPath, openApiText('3.1.2', schema));
    const v31 = await loadOpenApi(specificationPath);
    assert.equal(v31.operations[0]?.required.has('payload'), false);
    assert.equal('payload' in (v31.operations[0]?.properties ?? {}), true);
  });
});

test('accepts case-insensitive Content-Transfer-Encoding tokens in an encoding header schema', async () => {
  await withTempDir(async (directory) => {
    const specificationPath = path.join(directory, 'transfer-encoding.yaml');
    const specification = openApiText('3.1.2', '                payload:\n                  type: string\n                  contentEncoding: base64\n').replace(
      /            encoding:\n              payload:\n                contentType: application\/json/,
      `            encoding:
              payload:
                headers:
                  Content-Transfer-Encoding:
                    required: true
                    schema:
                      type: string
                      enum: [BASE64]`,
    );
    await writeFile(specificationPath, specification);
    const document = await loadOpenApi(specificationPath);
    assert.deepEqual([...document.operations[0].encodings.payload.headers['Content-Transfer-Encoding'].schema.enum], ['BASE64']);
  });
});

test('rejects wildcard part content types instead of guessing the serialization', async () => {
  await withTempDir(async (directory) => {
    const specificationPath = path.join(directory, 'wildcard.yaml');
    await writeFile(specificationPath, openApiText('3.0.4', '                payload:\n                  type: object\n').replace('contentType: application/json', 'contentType: application/*'));
    await assert.rejects(loadOpenApi(specificationPath), { code: 'UNSUPPORTED_ENCODING' });
  });
});

test('parses JSON media type parameters semantically and rejects duplicate JSON keys and inherited references', async () => {
  await withTempDir(async (directory) => {
    const jsonPath = path.join(directory, 'openapi.json');
    const json = JSON.stringify({
      openapi: '3.0.4',
      info: { title: 'test', version: '1.0.0' },
      paths: {},
    });
    await writeFile(jsonPath, json.replace('"openapi":"3.0.4"', '"openapi":"3.0.4","openapi":"3.0.4"'));
    await assert.rejects(loadOpenApi(jsonPath), { code: 'INVALID_DOCUMENT' });
    assert.throws(() => resolveLocalReference(JSON.parse('{"value":1}'), '#/toString'), { code: 'INVALID_REFERENCE' });
  });
  const actual = [{ name: 'payload', headers: {}, contentType: 'Application/JSON; charset=UTF-8; profile="https://example.test/schema"', body: Buffer.from('{"a":1}') }];
  const expected = [{ name: 'payload', count: 1, contentType: 'application/json; profile="https://example.test/schema"; charset=utf-8', bodies: [Buffer.from('{"a":1}')], json: true, requiredHeaders: [], expectedHeaders: {} }];
  assert.deepEqual(compareMultipart(actual, expected, { name: 'parameters', body: {} }), []);
  const wrongCharset = [{ ...actual[0], contentType: 'application/json; charset=iso-8859-1' }];
  assert.equal(compareMultipart(wrongCharset, expected, { name: 'parameters', body: {} })[0]?.code, 'CONTENT_TYPE_MISMATCH');
});

test('reports unknown parts under permissive additionalProperties as inconclusive', async () => {
  await withTempDir(async (directory) => {
    const specificationPath = path.join(directory, 'openapi.yaml');
    await writeFile(specificationPath, openApiText('3.0.4', '                payload:\n                  type: string\n').replace('              required:', '              additionalProperties: true\n              required:'));
    const document = await loadOpenApi(specificationPath);
    const diagnostics = compareMultipart([{ name: 'extra', headers: {}, contentType: 'text/plain', body: Buffer.from('value') }], [], { name: 'permissive', body: {} }, document.operations[0].allowsAdditionalProperties);
    assert.equal(diagnostics[0]?.code, 'UNSUPPORTED_ADDITIONAL_PART');
  });
});

test('parses repeated parts, binary bytes, explicit headers, and RFC 7578 default text/plain', () => {
  const body = Buffer.concat([
    Buffer.from('--probe-boundary\r\nContent-Disposition: form-data; name="record"\r\nContent-Type: application/json\r\nX-Trace: abc\r\n\r\n{"a":1}\r\n--probe-boundary\r\nContent-Disposition: form-data; name="record"\r\n\r\nplain\r\n--probe-boundary\r\nContent-Disposition: form-data; name="file"; filename="tiny.bin"\r\nContent-Type: application/octet-stream\r\n\r\n', 'latin1'),
    Buffer.from([0, 1, 13, 10, 255, 2]),
    Buffer.from('\r\n--probe-boundary--\r\n', 'latin1'),
  ]);
  const parts = parseMultipart('multipart/form-data; boundary="probe-boundary"', body);
  assert.deepEqual(parts.map((part) => part.name), ['record', 'record', 'file']);
  assert.equal(parts[0]?.contentType, 'application/json');
  assert.equal(parts[1]?.contentType, 'text/plain');
  assert.deepEqual(parts[0]?.headers['x-trace'], ['abc']);
  assert.deepEqual(parts[2]?.body, Buffer.from([0, 1, 13, 10, 255, 2]));
  assert.equal(parts[2]?.filename, 'tiny.bin');
  const encodedName = Buffer.from('--b\r\nContent-Disposition: form-data; name="caf%C3%A9"\r\n\r\nx\r\n--b--\r\n');
  assert.equal(parseMultipart('multipart/form-data; boundary=b', encodedName)[0]?.name, 'café');
  const paddedBoundaries = Buffer.from('preamble\r\n--b \t\r\nContent-Disposition: form-data; name="text"\r\n\r\nx\r\n--b-- \t\r\nepilogue');
  assert.equal(parseMultipart('multipart/form-data; boundary=b', paddedBoundaries)[0]?.body.toString(), 'x');
});

test('rejects malformed multipart boundaries and headers', () => {
  assert.throws(() => parseMultipart('multipart/form-data', Buffer.from('empty')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart(`multipart/form-data; boundary=${'a'.repeat(71)}`, Buffer.from('empty')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=one; boundary=two', Buffer.from('empty')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=two words', Buffer.from('--two words\r\nContent-Disposition: form-data; name="x"\r\n\r\nvalue\r\n--two words--\r\n')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=b', Buffer.from('--b\r\nContent-Disposition : form-data; name="x"\r\n\r\nvalue\r\n--b--\r\n')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=bad', Buffer.from('--bad\r\nBroken\r\n\r\nbody\r\n--bad--\r\n')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=bad', Buffer.from('--bad\r\nContent-Disposition: form-data; name="x"\r\n\r\nbody')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=b', Buffer.from('--b\r\nContent-Disposition: form-data; name="x"\r\nContent-Transfer-Encoding: base64\r\nContent-Transfer-Encoding: binary\r\n\r\neA==\r\n--b--\r\n')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=b', Buffer.from('--b\r\nContent-Disposition: form-data; name="x"; name="y"\r\n\r\nvalue\r\n--b--\r\n')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=b', Buffer.from('--b\r\nContent-Disposition: form-data; name="x\r\n\r\nvalue\r\n--b--\r\n')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=b', Buffer.from('--b\r\nContent-Disposition: form-data; name="x"; filename*=UTF-8\'\'x.txt\r\n\r\nvalue\r\n--b--\r\n')), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart('multipart/form-data; boundary=b', Buffer.from('--b\r\nContent-Disposition: form-data; name="x";\r\n\r\nvalue\r\n--b--\r\n')), { code: 'MALFORMED_MULTIPART' });
  const quotedBoundary = parseMultipart('multipart/form-data; boundary="two words"', Buffer.from('--two words\r\nContent-Disposition: form-data; name="x"\r\n\r\nvalue\r\n--two words--\r\n'));
  assert.equal(quotedBoundary[0]?.body.toString(), 'value');
});

test('escapes terminal control characters in human-readable values', () => {
  assert.equal(escapeTerminalText('case\n\u001b[31m'), 'case\\u000a\\u001b[31m');
});

test('compares JSON semantically and reports content type, count, and header mismatches without values', () => {
  const part = {
    name: 'products',
    headers: { 'content-disposition': ['form-data; name="products"'], 'content-type': ['text/plain'], 'x-auth': ['do-not-report'] },
    contentType: 'text/plain',
    body: Buffer.from('{"id":1,"name":"private-value"}'),
  };
  const fixtureCase = { name: 'case', body: { products: [{ name: 'private-value', id: 1 }] } };
  const diagnostics = compareMultipart([part], [{ name: 'products', count: 2, contentType: 'application/json', bodies: [Buffer.from('{"name":"private-value","id":1}')], json: true, requiredHeaders: ['x-required'], expectedHeaders: {} }], fixtureCase);
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.code), ['UNSUPPORTED_PART_HEADER', 'PART_COUNT_MISMATCH', 'MISSING_PART_HEADER', 'CONTENT_TYPE_MISMATCH']);
  assert.equal(JSON.stringify(diagnostics).includes('private-value'), false);
  assert.equal(JSON.stringify(diagnostics).includes('do-not-report'), false);
  const absentAssertion = compareMultipart([], [], { name: 'empty', body: {}, assert: { parts: { file: { contentType: 'application/octet-stream', headers: { 'content-type': 'application/octet-stream' } } } } });
  assert.deepEqual(absentAssertion.map((diagnostic) => diagnostic.code), ['ASSERTION_UNKNOWN_PART', 'FIXTURE_CONTENT_TYPE_ASSERTION', 'FIXTURE_HEADER_ASSERTION']);
  const ambiguousJson = compareMultipart([{ name: 'record', headers: {}, contentType: 'application/json', body: Buffer.from('{"id":1,"id":1}') }], [{ name: 'record', count: 1, contentType: 'application/json', bodies: [Buffer.from('{"id":1}')], json: true, requiredHeaders: [], expectedHeaders: {} }], { name: 'duplicate-json', body: {} });
  assert.equal(ambiguousJson[0]?.code, 'UNSUPPORTED_JSON_BODY');
  const unsafeJson = compareMultipart([{ name: 'record', headers: {}, contentType: 'application/json', body: Buffer.from('{"id":9007199254740993}') }], [{ name: 'record', count: 1, contentType: 'application/json', bodies: [Buffer.from('{"id":9007199254740992}')], json: true, requiredHeaders: [], expectedHeaders: {} }], { name: 'unsafe-json', body: {} });
  assert.equal(unsafeJson[0]?.code, 'UNSUPPORTED_JSON_BODY');
});

test('reports absent required parts even when the fixture sends no value for them', async () => {
  const specification = await loadOpenApi(fileURLToPath(new URL('../examples/hey-api-positive-openapi.yaml', import.meta.url)));
  const fixtureCase = { name: 'missing-required', body: {} };
  const expected = await deriveExpectedParts(specification.operations[0], fixtureCase, specification.openapi);
  const diagnostics = compareMultipart([], expected, fixtureCase);
  assert.deepEqual(diagnostics.map((diagnostic) => [diagnostic.part, diagnostic.expected, diagnostic.actual]), [['file', 1, 0], ['note', 1, 0]]);
});

test('fixture file markers cannot escape their fixture directory', async () => {
  await withTempDir(async (directory) => {
    const fixtureRoot = path.join(directory, 'fixtures');
    await mkdir(fixtureRoot);
    await writeFile(path.join(directory, 'outside.bin'), Buffer.from([1]));
    const fixturePath = path.join(fixtureRoot, 'fixture.yaml');
    await writeFile(fixturePath, `fixtureVersion: 1\nopenapi: spec.yaml\noperationId: upload\ncases:\n  - name: escape\n    body:\n      file:\n        $wireconform: file\n        path: ../outside.bin\n`);
    await assert.rejects(loadFixture(fixturePath), { code: 'FIXTURE_PATH_ESCAPE' });
  });
});

test('report output refuses symlinked directories and files', async () => {
  await withTempDir(async (directory) => {
    const target = path.join(directory, 'outside');
    await mkdir(target);
    const link = path.join(directory, 'link');
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    const report = { wireconformVersion: '0.1.0-beta.1', createdAt: new Date().toISOString(), specification: { path: 'api.yaml', openapi: '3.0.4', operationId: 'upload', method: 'POST', pathTemplate: '/upload' }, adapter: { id: 'test', version: '1.0.0' }, status: 'pass', cases: [{ name: 'upload', status: 'pass', partCount: 1, diagnostics: [] }] };
    await assert.rejects(writeReport(report, path.join(link, 'report.json')), { code: 'UNSAFE_REPORT_PATH' });
    await assert.rejects(readReport(path.join(link, 'report.json')), { code: 'UNSAFE_REPORT_PATH' });
    if (process.platform !== 'win32') {
      const targetFile = path.join(directory, 'private-report.json');
      await writeFile(targetFile, JSON.stringify(report));
      const fileLink = path.join(directory, 'report-link.json');
      await symlink(targetFile, fileLink, 'file');
      await assert.rejects(readReport(fileLink), { code: 'UNSAFE_REPORT_PATH' });
    }
    const reportPath = await writeReport(report, path.join(directory, 'valid-report.json'));
    assert.deepEqual(await readReport(reportPath), report);
    await writeFile(reportPath, JSON.stringify({ wireconformVersion: '0.1.0-beta.1', cases: [], body: 'must-not-print' }));
    await assert.rejects(readReport(reportPath), { code: 'INVALID_REPORT' });
    await writeFile(reportPath, JSON.stringify({ ...report, cases: [] }));
    await assert.rejects(readReport(reportPath), { code: 'INVALID_REPORT' });
    await writeFile(reportPath, JSON.stringify({ ...report, cases: [{ ...report.cases[0], diagnostics: [{ code: 'BODY_MISMATCH', message: 'Part body does not match.' }] }] }));
    await assert.rejects(readReport(reportPath), { code: 'INVALID_REPORT' });
    await writeFile(reportPath, JSON.stringify({ ...report, status: 'fail', cases: [{ ...report.cases[0], status: 'fail', diagnostics: [{ code: 'BODY_MISMATCH', message: 'Part body does not match.' }] }] }));
    assert.equal((await readReport(reportPath)).status, 'fail');
    await writeFile(reportPath, JSON.stringify({ ...report, cases: [{ ...report.cases[0], status: 'fail' }] }));
    await assert.rejects(readReport(reportPath), { code: 'INVALID_REPORT' });
    await writeFile(reportPath, 'x'.repeat(1024 * 1024 + 1));
    await assert.rejects(readReport(reportPath), { code: 'REPORT_TOO_LARGE' });
  });
});
