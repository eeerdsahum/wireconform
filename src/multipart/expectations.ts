import { WireConformError } from '../errors.js';
import type { ExpectedPartGroup, FixtureCase, JsonObject, MultipartOperation } from '../types.js';

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const fileMarker = (value: unknown): value is { $wireconform: 'file'; data: string; filename: string; contentType: string } =>
  isObject(value) && value.$wireconform === 'file' && typeof value.data === 'string' && typeof value.filename === 'string' && typeof value.contentType === 'string';

const schemaForValue = (operation: MultipartOperation, propertyName: string): JsonObject => {
  const schema = operation.properties[propertyName];
  if (!schema) {
    const code = operation.allowsAdditionalProperties ? 'UNSUPPORTED_ADDITIONAL_PROPERTY' : 'INVALID_FIXTURE';
    throw new WireConformError(code, `Fixture body includes undeclared multipart property ${propertyName}.`);
  }
  return schema;
};

const expectedContentType = (openapiVersion: string, schema: JsonObject, encoding: JsonObject | undefined): string | undefined => {
  if (typeof encoding?.contentType === 'string') {
    const contentType = encoding.contentType.trim();
    if (contentType.length === 0 || /[\r\n\0]/.test(contentType)) throw new WireConformError('INVALID_ENCODING', 'Multipart encoding contentType is empty or invalid.');
    if (contentType.includes(',')) throw new WireConformError('UNSUPPORTED_ENCODING', 'A comma-separated multipart encoding contentType is not supported.');
    return contentType;
  }
  const type = schema.type;
  if (type === 'object') return 'application/json';
  if (type === 'array') {
    if (!isObject(schema.items)) throw new WireConformError('UNSUPPORTED_SCHEMA_TYPE', 'Multipart array items must have a schema object.');
    return expectedContentType(openapiVersion, schema.items, undefined);
  }
  if (type === undefined && openapiVersion.startsWith('3.1.')) return 'application/octet-stream';
  if (type === 'string') {
    if (openapiVersion.startsWith('3.0.') && (schema.format === 'binary' || schema.format === 'byte')) return 'application/octet-stream';
    if (openapiVersion.startsWith('3.1.') && 'contentEncoding' in schema) return 'application/octet-stream';
    return 'text/plain';
  }
  if (type === 'number' || type === 'integer' || type === 'boolean') return 'text/plain';
  throw new WireConformError('UNSUPPORTED_SCHEMA_TYPE', 'Cannot derive multipart Content-Type from this property schema.');
};

const normalizeScalar = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new WireConformError('INVALID_FIXTURE', 'Multipart scalar value must be a string, number, boolean, or file marker.');
};

const validateFixtureValue = (value: unknown, schema: JsonObject, openapiVersion: string, propertyName: string): void => {
  if (fileMarker(value)) {
    const isOas30Binary = openapiVersion.startsWith('3.0.') && schema.type === 'string' && (schema.format === 'binary' || schema.format === 'byte');
    const isOas31Encoded = openapiVersion.startsWith('3.1.') && schema.type === undefined || (openapiVersion.startsWith('3.1.') && schema.type === 'string' && typeof schema.contentEncoding === 'string');
    if (!isOas30Binary && !isOas31Encoded) throw new WireConformError('INVALID_FIXTURE', `File marker for ${propertyName} requires a binary or encoded string schema.`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || !isObject(schema.items)) throw new WireConformError('INVALID_FIXTURE', `Fixture value for multipart array ${propertyName} must be an array.`);
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) throw new WireConformError('INVALID_FIXTURE', 'Multipart array fixture has fewer items than its minimum.');
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) throw new WireConformError('INVALID_FIXTURE', 'Multipart array fixture has more items than its maximum.');
    for (const item of value) validateFixtureValue(item, schema.items, openapiVersion, propertyName);
    return;
  }
  if (schema.type === 'object') {
    if (!isObject(value)) throw new WireConformError('INVALID_FIXTURE', `Fixture value for multipart object ${propertyName} must be an object.`);
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') throw new WireConformError('INVALID_FIXTURE', `Fixture value for multipart string ${propertyName} must be a string or supported file marker.`);
    return;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) {
      throw new WireConformError('INVALID_FIXTURE', `Fixture value for multipart ${schema.type} ${propertyName} must be a finite ${schema.type}.`);
    }
    return;
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new WireConformError('INVALID_FIXTURE', `Fixture value for multipart boolean ${propertyName} must be true or false.`);
    return;
  }
  throw new WireConformError('INVALID_FIXTURE', `Fixture value for multipart property ${propertyName} must use a supported file marker.`);
};

const isJsonMediaType = (contentType: string | undefined): boolean => {
  if (!contentType) return false;
  const essence = contentType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return essence === 'application/json' || essence.endsWith('+json');
};

const expectedBody = async (value: unknown, contentType: string | undefined, contentEncoding: string | undefined, json: boolean): Promise<Buffer | string> => {
  if (fileMarker(value)) {
    const bytes = Buffer.from(value.data, 'base64');
    if (contentEncoding === 'base64') return Buffer.from(bytes.toString('base64'));
    if (contentEncoding === 'base64url') {
      const encoded = bytes.toString('base64url');
      return Buffer.from(`${encoded}${'='.repeat((4 - encoded.length % 4) % 4)}`);
    }
    return bytes;
  }
  if (json) return Buffer.from(JSON.stringify(value));
  if (typeof value === 'object' && value !== null) throw new WireConformError('UNSUPPORTED_SERIALIZATION', 'Object multipart values require a JSON-compatible part Content-Type.');
  return normalizeScalar(value);
};

const headerExpectations = (encoding: JsonObject | undefined): string[] => {
  if (!isObject(encoding?.headers)) return [];
  return Object.entries(encoding.headers)
    .filter(([name, headerValue]) => name.toLowerCase() !== 'content-type' && isObject(headerValue) && headerValue.required === true)
    .map(([name]) => name.toLowerCase());
};

export const deriveExpectedParts = async (operation: MultipartOperation, fixtureCase: FixtureCase, openapiVersion: string): Promise<ExpectedPartGroup[]> => {
  const groups: ExpectedPartGroup[] = [];
  for (const [propertyName, value] of Object.entries(fixtureCase.body)) {
    const schema = schemaForValue(operation, propertyName);
    validateFixtureValue(value, schema, openapiVersion, propertyName);
  }
  for (const [name, schema] of Object.entries(operation.properties)) {
    const supplied = Object.prototype.hasOwnProperty.call(fixtureCase.body, name);
    const value = fixtureCase.body[name];
    const encoding = operation.encodings[name];
    const itemSchema = schema.type === 'array' && isObject(schema.items) ? schema.items : schema;
    const contentType = expectedContentType(openapiVersion, itemSchema, encoding);
    const values = schema.type === 'array'
      ? supplied
        ? Array.isArray(value) ? value : (() => { throw new WireConformError('INVALID_FIXTURE', `Fixture value for multipart array ${name} must be an array.`); })()
        : []
      : supplied ? [value] : [];
    const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0;
    const expectedCount = supplied ? values.length : operation.required.has(name) ? Math.max(1, minItems) : 0;
    const contentEncoding = openapiVersion.startsWith('3.0.') && itemSchema.type === 'string' && itemSchema.format === 'byte'
      ? 'base64'
      : openapiVersion.startsWith('3.1.') && itemSchema.type === 'string' && typeof itemSchema.contentEncoding === 'string'
        ? itemSchema.contentEncoding.toLowerCase()
        : undefined;
    const json = itemSchema.type === 'object' || (isJsonMediaType(contentType) && !values.some(fileMarker));
    if (itemSchema.type === 'object' && !json) throw new WireConformError('UNSUPPORTED_SERIALIZATION', `Object multipart values for ${name} require a JSON-compatible part Content-Type.`);
    const bodies = await Promise.all(values.map((item) => expectedBody(item, contentType, contentEncoding, json)));
    const expectedHeaders: Record<string, string> = {};
    if (contentEncoding) expectedHeaders['content-transfer-encoding'] = contentEncoding;
    groups.push({
      name,
      count: expectedCount,
      ...(contentType === undefined ? {} : { contentType }),
      bodies,
      json,
      requiredHeaders: headerExpectations(encoding),
      expectedHeaders,
    });
  }
  return groups;
};
