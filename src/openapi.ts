import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { createYamlDiagnosticContext, WireConformError } from './errors.js';
import { isConcreteMediaType } from './multipart/media-type.js';
import type { JsonObject, LoadedOpenApi, MultipartOperation } from './types.js';

const maxSpecificationBytes = 5 * 1024 * 1024;
const supportedVersions = /^(3\.0\.[0-4]|3\.1\.[0-2])$/;

export const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const readSpecificationBytes = async (filePath: string): Promise<Buffer> => {
  const handle = await open(filePath, constants.O_RDONLY);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new WireConformError('INVALID_DOCUMENT', 'OpenAPI document must be a regular file.');
    if (stats.size > maxSpecificationBytes) throw new WireConformError('SPEC_TOO_LARGE', `OpenAPI document exceeds ${maxSpecificationBytes} bytes.`);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= maxSpecificationBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxSpecificationBytes + 1 - totalBytes));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, totalBytes);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxSpecificationBytes) throw new WireConformError('SPEC_TOO_LARGE', `OpenAPI document exceeds ${maxSpecificationBytes} bytes.`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
};

const readDocument = async (filePath: string): Promise<JsonObject> => {
  const absolutePath = path.resolve(filePath);
  let bytes: Buffer;
  try {
    bytes = await readSpecificationBytes(absolutePath);
  } catch (error) {
    if (error instanceof WireConformError) throw error;
    const code = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 'OPENAPI_NOT_FOUND' : 'OPENAPI_UNREADABLE';
    throw new WireConformError(code, 'OpenAPI document could not be read.');
  }
  let value: unknown;
  if (path.extname(absolutePath).toLowerCase() === '.json') {
    try {
      const text = bytes.toString('utf8');
      value = JSON.parse(text) as unknown;
      const parsed = parseDocument(text, { uniqueKeys: true });
      if (parsed.errors.length > 0) throw new Error('Duplicate JSON object keys.');
    } catch {
      throw new WireConformError('INVALID_DOCUMENT', 'OpenAPI document is not valid JSON.');
    }
  } else {
    let parsed;
    try {
      parsed = parseDocument(bytes.toString('utf8'), { uniqueKeys: true });
    } catch {
      throw new WireConformError('INVALID_DOCUMENT', 'OpenAPI YAML is invalid.');
    }
    if (parsed.errors.length > 0) {
      const firstError = parsed.errors[0];
      const firstPosition = firstError?.linePos?.[0];
      const line = firstPosition?.line;
      const column = firstPosition?.col;
      const context = createYamlDiagnosticContext('openapi', line, column);
      throw new WireConformError('INVALID_DOCUMENT', 'OpenAPI YAML is invalid.', 2, context);
    }
    try {
      value = parsed.toJS({ maxAliasCount: 100 }) as unknown;
    } catch {
      throw new WireConformError('INVALID_DOCUMENT', 'OpenAPI YAML could not be converted safely.');
    }
  }
  if (!isObject(value)) {
    throw new WireConformError('INVALID_DOCUMENT', 'OpenAPI document root must be an object.');
  }
  return value;
};

export const resolveLocalReference = (document: JsonObject, reference: unknown): unknown => {
  if (reference === '#') return document;
  if (typeof reference !== 'string' || !reference.startsWith('#/')) {
    throw new WireConformError('UNSUPPORTED_REFERENCE', 'Only local OpenAPI JSON Pointer references are supported.');
  }
  let current: unknown = document;
  for (const rawToken of reference.slice(2).split('/')) {
    let token: string;
    try {
      token = decodeURIComponent(rawToken);
    } catch {
      throw new WireConformError('INVALID_REFERENCE', `Invalid local reference: ${reference}`);
    }
    if (/~(?![01])/.test(token)) throw new WireConformError('INVALID_REFERENCE', `Invalid local reference: ${reference}`);
    token = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isObject(current) && !Array.isArray(current)) {
      throw new WireConformError('INVALID_REFERENCE', `Local reference does not resolve: ${reference}`);
    }
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token))) {
        throw new WireConformError('INVALID_REFERENCE', `Invalid array index in local reference: ${reference}`);
      }
      current = current[Number(token)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, token)) {
        throw new WireConformError('INVALID_REFERENCE', `Local reference does not resolve: ${reference}`);
      }
      current = current[token];
    }
  }
  if (current === undefined) {
    throw new WireConformError('INVALID_REFERENCE', `Local reference does not resolve: ${reference}`);
  }
  return current;
};

const validateReferences = (document: JsonObject): void => {
  const visited = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (visited.has(value)) return;
      visited.add(value);
      for (const item of value) visit(item);
      return;
    }
    if (!isObject(value) || visited.has(value)) return;
    visited.add(value);
    if ('$ref' in value) resolveLocalReference(document, value.$ref);
    for (const child of Object.values(value)) visit(child);
  };
  visit(document);
};

const resolveObject = (document: JsonObject, value: unknown, label: string): JsonObject => {
  if (isObject(value) && '$ref' in value && Object.keys(value).some((key) => key !== '$ref')) {
    throw new WireConformError('UNSUPPORTED_REFERENCE_SIBLINGS', `${label} reference siblings are not supported.`);
  }
  let current = value;
  const visited = new Set<string>();
  while (isObject(current) && typeof current.$ref === 'string') {
    if (visited.has(current.$ref)) throw new WireConformError('REFERENCE_CYCLE', `Circular reference while resolving ${label}.`);
    visited.add(current.$ref);
    current = resolveLocalReference(document, current.$ref);
  }
  if (!isObject(current)) throw new WireConformError('INVALID_DOCUMENT', `${label} must resolve to an object.`);
  return current;
};

const resolveSchema = (document: JsonObject, schema: unknown): JsonObject => {
  if (isObject(schema) && '$ref' in schema && Object.keys(schema).some((key) => key !== '$ref')) {
    throw new WireConformError('UNSUPPORTED_SCHEMA_REF_SIBLINGS', 'Schema $ref siblings are not supported by the multipart validator.');
  }
  return resolveObject(document, schema, 'Multipart schema');
};

const getMultipartOperations = (document: JsonObject, openapiVersion: string): MultipartOperation[] => {
  const paths = document.paths;
  if (!isObject(paths)) throw new WireConformError('INVALID_DOCUMENT', 'OpenAPI document must define a paths object.');
  const operations: MultipartOperation[] = [];
  for (const [pathTemplate, pathItemValue] of Object.entries(paths)) {
    const pathItem = resolveObject(document, pathItemValue, `Path item ${pathTemplate}`);
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      const operationValue = pathItem[method];
      if (!isObject(operationValue)) continue;
      const operationId = operationValue.operationId;
      if (operationValue.requestBody === undefined) continue;
      const requestBody = resolveObject(document, operationValue.requestBody, `requestBody for ${method.toUpperCase()} ${pathTemplate}`);
      const content = requestBody.content;
      if (!isObject(content)) throw new WireConformError('INVALID_DOCUMENT', `Request body for ${method.toUpperCase()} ${pathTemplate} must define a content object.`);
      const multipartEntries = Object.entries(content).filter(([mediaType]) => mediaType.toLowerCase().startsWith('multipart/'));
      if (multipartEntries.length === 0) continue;
      if (/\{[^{}]+\}/.test(pathTemplate)) {
        throw new WireConformError('UNSUPPORTED_PARAMETERS', `Multipart operation ${String(operationId ?? `${method.toUpperCase()} ${pathTemplate}`)} uses path parameters; parameter values are not supported by the fixture runner.`);
      }
      const declaredParameters = [pathItem.parameters, operationValue.parameters].filter((parameters) => parameters !== undefined);
      if (declaredParameters.some((parameters) => !Array.isArray(parameters) || parameters.length > 0)) {
        throw new WireConformError('UNSUPPORTED_PARAMETERS', `Multipart operation ${String(operationId ?? `${method.toUpperCase()} ${pathTemplate}`)} declares parameters; parameter values are not supported by the fixture runner.`);
      }
      const security = operationValue.security === undefined ? document.security : operationValue.security;
      if (security !== undefined && (!Array.isArray(security) || security.length > 0)) {
        throw new WireConformError('UNSUPPORTED_SECURITY', `Multipart operation ${String(operationId ?? `${method.toUpperCase()} ${pathTemplate}`)} declares security requirements; authenticated SDK execution is not supported.`);
      }
      if (multipartEntries.length > 0 && Object.keys(content).length !== 1) {
        throw new WireConformError('UNSUPPORTED_REQUEST_MEDIA_TYPES', `Multipart operation ${String(operationId ?? `${method.toUpperCase()} ${pathTemplate}`)} declares multiple request media types.`);
      }
      for (const [mediaType, mediaValue] of multipartEntries) {
        if (mediaType.toLowerCase() !== 'multipart/form-data') {
          throw new WireConformError('UNSUPPORTED_MULTIPART_MEDIA_TYPE', `Unsupported multipart media type ${mediaType} at ${method.toUpperCase()} ${pathTemplate}.`);
        }
        if (typeof operationId !== 'string' || operationId.length === 0) {
          throw new WireConformError('MISSING_OPERATION_ID', `Multipart operation ${method.toUpperCase()} ${pathTemplate} must define operationId.`);
        }
        const mediaTypeObject = resolveObject(document, mediaValue, `multipart/form-data content for ${operationId}`);
        const schema = resolveSchema(document, mediaTypeObject.schema);
        if (schema.type !== 'object' || !isObject(schema.properties)) {
          throw new WireConformError('UNSUPPORTED_MULTIPART_SCHEMA', `Multipart request body for ${operationId} must be an object schema with properties.`);
        }
        if ('allOf' in schema || 'oneOf' in schema || 'anyOf' in schema || 'not' in schema) {
          throw new WireConformError('UNSUPPORTED_SCHEMA_COMPOSITION', `Schema composition is not supported for multipart operation ${operationId}.`);
        }
        if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
          throw new WireConformError('UNSUPPORTED_ADDITIONAL_PROPERTIES', `Multipart operation ${operationId} must declare each supported part as a property.`);
        }
        if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== 'string' || item.length === 0))) {
          throw new WireConformError('INVALID_DOCUMENT', `Multipart schema required for ${operationId} must be an array of non-empty property names.`);
        }
        const declaredRequired = new Set(Array.isArray(schema.required) ? schema.required as string[] : []);
        if (Array.isArray(schema.required) && declaredRequired.size !== schema.required.length) {
          throw new WireConformError('INVALID_DOCUMENT', `Multipart schema required for ${operationId} cannot contain duplicate property names.`);
        }
        const properties: Record<string, JsonObject> = Object.create(null) as Record<string, JsonObject>;
        const validateContentEncoding = (schemaValue: JsonObject, propertyName: string): void => {
          if (openapiVersion.startsWith('3.0.') && schemaValue.contentEncoding !== undefined) {
            throw new WireConformError('UNSUPPORTED_SCHEMA_KEYWORD', `contentEncoding is not part of the supported OpenAPI 3.0 schema subset for ${propertyName}.`);
          }
          if (schemaValue.contentEncoding !== undefined && (typeof schemaValue.contentEncoding !== 'string' || !['base64', 'base64url', 'binary', '7bit', '8bit'].includes(schemaValue.contentEncoding.toLowerCase()))) {
            throw new WireConformError('UNSUPPORTED_CONTENT_ENCODING', `Multipart contentEncoding on ${propertyName} must use base64, base64url, binary, 7bit, or 8bit.`);
          }
          if (schemaValue.contentEncoding !== undefined && schemaValue.type !== 'string' && schemaValue.type !== undefined) {
            throw new WireConformError('INVALID_DOCUMENT', `Multipart contentEncoding on ${propertyName} requires a string schema.`);
          }
        };
        for (const [propertyName, propertyValue] of Object.entries(schema.properties)) {
          const propertySchema = resolveSchema(document, propertyValue);
          if (propertySchema.readOnly === true && propertySchema.writeOnly === true) {
            throw new WireConformError('INVALID_DOCUMENT', `Multipart property ${propertyName} in ${operationId} cannot be both readOnly and writeOnly.`);
          }
          if (openapiVersion.startsWith('3.0.') && propertySchema.readOnly === true) continue;
          if ('allOf' in propertySchema || 'oneOf' in propertySchema || 'anyOf' in propertySchema || 'not' in propertySchema) {
            throw new WireConformError('UNSUPPORTED_SCHEMA_COMPOSITION', `Schema composition is not supported for multipart property ${propertyName} in ${operationId}.`);
          }
          const type = propertySchema.type;
          if (type === 'array') {
            if (propertySchema.minItems !== undefined && (typeof propertySchema.minItems !== 'number' || !Number.isInteger(propertySchema.minItems) || propertySchema.minItems < 0)) {
              throw new WireConformError('INVALID_DOCUMENT', `minItems for multipart property ${propertyName} must be a non-negative integer.`);
            }
            if (propertySchema.maxItems !== undefined && (typeof propertySchema.maxItems !== 'number' || !Number.isInteger(propertySchema.maxItems) || propertySchema.maxItems < 0)) {
              throw new WireConformError('INVALID_DOCUMENT', `maxItems for multipart property ${propertyName} must be a non-negative integer.`);
            }
            if (typeof propertySchema.minItems === 'number' && typeof propertySchema.maxItems === 'number' && propertySchema.minItems > propertySchema.maxItems) {
              throw new WireConformError('INVALID_DOCUMENT', `minItems for multipart property ${propertyName} cannot exceed maxItems.`);
            }
            const itemSchema = resolveSchema(document, propertySchema.items);
            propertySchema.items = itemSchema;
            if ('allOf' in itemSchema || 'oneOf' in itemSchema || 'anyOf' in itemSchema || 'not' in itemSchema) {
              throw new WireConformError('UNSUPPORTED_SCHEMA_COMPOSITION', `Schema composition is not supported for items in multipart property ${propertyName}.`);
            }
            if (itemSchema.type === 'array' || (itemSchema.type !== 'string' && itemSchema.type !== 'number' && itemSchema.type !== 'integer' && itemSchema.type !== 'boolean' && itemSchema.type !== 'object' && !(itemSchema.type === undefined && openapiVersion.startsWith('3.1.')))) {
              throw new WireConformError('UNSUPPORTED_SCHEMA_TYPE', `Multipart array items for ${propertyName} must use a supported scalar or object schema.`);
            }
            validateContentEncoding(itemSchema, propertyName);
          } else if (type !== 'string' && type !== 'number' && type !== 'integer' && type !== 'boolean' && type !== 'object' && !(type === undefined && openapiVersion.startsWith('3.1.'))) {
            throw new WireConformError('UNSUPPORTED_SCHEMA_TYPE', `Multipart property ${propertyName} in ${operationId} has an unsupported or unspecified schema type.`);
          }
          validateContentEncoding(propertySchema, propertyName);
          properties[propertyName] = propertySchema;
        }
        for (const propertyName of declaredRequired) {
          if (!Object.prototype.hasOwnProperty.call(schema.properties, propertyName)) throw new WireConformError('INVALID_DOCUMENT', `Multipart operation ${operationId} requires undeclared property ${propertyName}.`);
        }
        const required = new Set([...declaredRequired].filter((propertyName) => propertyName in properties && properties[propertyName]?.readOnly !== true));
        const encodings: Record<string, JsonObject> = Object.create(null) as Record<string, JsonObject>;
        if (mediaTypeObject.encoding !== undefined && !isObject(mediaTypeObject.encoding)) {
          throw new WireConformError('INVALID_ENCODING', `Multipart encoding for ${operationId} must be an object.`);
        }
        const rawEncodings = isObject(mediaTypeObject.encoding) ? mediaTypeObject.encoding : {};
        for (const [propertyName, encodingValue] of Object.entries(rawEncodings)) {
          if (!Object.prototype.hasOwnProperty.call(schema.properties, propertyName)) throw new WireConformError('INVALID_ENCODING', `Encoding entry ${propertyName} in ${operationId} has no matching schema property.`);
          if (!(propertyName in properties)) continue;
          const encoding = resolveObject(document, encodingValue, `encoding for ${propertyName}`);
          if (encoding.contentType !== undefined && typeof encoding.contentType !== 'string') {
            throw new WireConformError('INVALID_ENCODING', `Multipart encoding contentType for ${propertyName} must be a string.`);
          }
          if (typeof encoding.contentType === 'string' && /[\r\n\0]/.test(encoding.contentType)) {
            throw new WireConformError('INVALID_ENCODING', `Multipart encoding contentType for ${propertyName} contains invalid characters.`);
          }
          if (typeof encoding.contentType === 'string' && encoding.contentType.includes(',')) {
            throw new WireConformError('UNSUPPORTED_ENCODING', `Multiple content types for multipart property ${propertyName} are not supported.`);
          }
          if (typeof encoding.contentType === 'string' && encoding.contentType.split(';', 1)[0]?.includes('*')) {
            throw new WireConformError('UNSUPPORTED_ENCODING', `Wildcard multipart contentType for ${propertyName} is not supported.`);
          }
          if (typeof encoding.contentType === 'string' && !isConcreteMediaType(encoding.contentType)) {
            throw new WireConformError('INVALID_ENCODING', `Multipart encoding contentType for ${propertyName} must be one valid media type.`);
          }
          if (encoding.headers !== undefined && !isObject(encoding.headers)) {
            throw new WireConformError('INVALID_ENCODING', `Multipart encoding headers for ${propertyName} must be an object.`);
          }
          for (const unsupportedKey of ['style', 'explode', 'allowReserved']) {
            if (openapiVersion.startsWith('3.1.') && unsupportedKey in encoding) {
              throw new WireConformError('UNSUPPORTED_ENCODING', `OpenAPI 3.1 multipart encoding option ${unsupportedKey} is not supported for ${propertyName}.`);
            }
          }
          if (isObject(encoding.headers)) {
            const headers: JsonObject = {};
            for (const [headerName, headerValue] of Object.entries(encoding.headers)) {
              const normalizedHeader = headerName.toLowerCase();
              if (!['content-type', 'content-disposition', 'content-transfer-encoding'].includes(normalizedHeader)) {
                throw new WireConformError('UNSUPPORTED_ENCODING_HEADER', `Part header ${headerName} is not supported for multipart/form-data under RFC 7578.`);
              }
              if (normalizedHeader === 'content-transfer-encoding') {
                const propertySchema = properties[propertyName];
                const itemSchema = propertySchema?.type === 'array' && isObject(propertySchema.items) ? propertySchema.items : propertySchema;
                const expectedTransferEncoding = isObject(itemSchema)
                  ? openapiVersion.startsWith('3.0.') && itemSchema.type === 'string' && itemSchema.format === 'byte'
                    ? 'base64'
                    : openapiVersion.startsWith('3.1.') && itemSchema.type === 'string' && typeof itemSchema.contentEncoding === 'string'
                      ? itemSchema.contentEncoding.toLowerCase()
                      : undefined
                  : undefined;
                if (!expectedTransferEncoding) {
                  throw new WireConformError('UNSUPPORTED_ENCODING_HEADER', 'Content-Transfer-Encoding requires OpenAPI 3.0 format: byte or OpenAPI 3.1 string contentEncoding in this implementation.');
                }
                const header = resolveObject(document, headerValue, `encoding header ${headerName}`);
                const headerSchema = isObject(header.schema) ? header.schema : undefined;
                const allowedValues = Array.isArray(headerSchema?.enum) ? headerSchema.enum : undefined;
                if (allowedValues && !allowedValues.some((value) => typeof value === 'string' && value.toLowerCase() === expectedTransferEncoding)) {
                  throw new WireConformError('INVALID_ENCODING', `Content-Transfer-Encoding schema for ${propertyName} excludes the value required by its content schema.`);
                }
              }
              headers[headerName] = resolveObject(document, headerValue, `encoding header ${headerName}`);
            }
            encoding.headers = headers;
          }
          encodings[propertyName] = encoding;
        }
        operations.push({
          operationId,
          method: method.toUpperCase(),
          path: pathTemplate,
          requestBody,
          mediaType: mediaTypeObject,
          schema,
          properties,
          required,
          encodings,
          allowsAdditionalProperties: schema.additionalProperties !== false,
        });
      }
    }
  }
  const seen = new Set<string>();
  for (const operation of operations) {
    if (seen.has(operation.operationId)) throw new WireConformError('DUPLICATE_OPERATION_ID', `Duplicate multipart operationId: ${operation.operationId}.`);
    seen.add(operation.operationId);
  }
  return operations;
};

export const loadOpenApi = async (filePath: string): Promise<LoadedOpenApi> => {
  const absolutePath = path.resolve(filePath);
  const document = await readDocument(absolutePath);
  if (typeof document.openapi !== 'string') throw new WireConformError('INVALID_DOCUMENT', 'OpenAPI document must declare an openapi version.');
  if (!supportedVersions.test(document.openapi)) {
    throw new WireConformError('UNSUPPORTED_OPENAPI_VERSION', `OpenAPI ${document.openapi} is unsupported. Supported versions are 3.0.0–3.0.4 and 3.1.0–3.1.2.`);
  }
  if (!isObject(document.info) || typeof document.info.title !== 'string' || typeof document.info.version !== 'string') {
    throw new WireConformError('INVALID_DOCUMENT', 'OpenAPI document must define info.title and info.version.');
  }
  validateReferences(document);
  return { path: absolutePath, openapi: document.openapi, document, operations: getMultipartOperations(document, document.openapi) };
};

export const validateOpenApi = async (filePath: string): Promise<LoadedOpenApi> => loadOpenApi(filePath);
