import type { CapturedPart, Diagnostic, ExpectedPartGroup, FixtureCase } from '../types.js';
import { inspectJsonText } from '../json.js';
import { matchesMediaType, mediaTypeEssence } from './media-type.js';

const sameJsonValue = (left: unknown, right: unknown): boolean => {
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return Object.is(left, right);
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => sameJsonValue(item, right[index]));
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(leftObject[key], rightObject[key]));
};

const bodyMatches = (actual: Buffer, expected: Buffer | string, json: boolean): 'match' | 'mismatch' | 'unsupported' => {
  if (json) {
    let actualText: string;
    try {
      actualText = new TextDecoder('utf-8', { fatal: true }).decode(actual);
    } catch {
      return 'mismatch';
    }
    const actualJson = inspectJsonText(actualText);
    const expectedJson = inspectJsonText(Buffer.isBuffer(expected) ? expected.toString('utf8') : expected);
    if (actualJson.kind === 'ambiguous' || actualJson.kind === 'unsupported' || expectedJson.kind === 'ambiguous' || expectedJson.kind === 'unsupported') return 'unsupported';
    if (actualJson.kind !== 'valid' || expectedJson.kind !== 'valid') return 'mismatch';
    return sameJsonValue(actualJson.value, expectedJson.value) ? 'match' : 'mismatch';
  }
  const expectedBytes = Buffer.isBuffer(expected) ? expected : Buffer.from(expected);
  return actual.equals(expectedBytes) ? 'match' : 'mismatch';
};

export const compareMultipart = (actualParts: CapturedPart[], expectedGroups: ExpectedPartGroup[], fixtureCase: FixtureCase, allowsAdditionalProperties = false): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const actualByName = new Map<string, CapturedPart[]>();
  for (const part of actualParts) {
    const group = actualByName.get(part.name) ?? [];
    group.push(part);
    actualByName.set(part.name, group);
  }
  const expectedNames = new Set(expectedGroups.map((group) => group.name));
  for (const [name, parts] of actualByName) {
    if (!expectedNames.has(name)) diagnostics.push({
      code: allowsAdditionalProperties ? 'UNSUPPORTED_ADDITIONAL_PART' : 'UNEXPECTED_PART',
      message: allowsAdditionalProperties
        ? `Cannot verify undeclared multipart part ${name} because the OpenAPI schema allows additional properties.`
        : `Unexpected multipart part ${name}.`,
      part: name,
      expected: 0,
      actual: parts.length,
    });
    if (parts.some((part) => Object.keys(part.headers).some((header) => !['content-type', 'content-disposition', 'content-transfer-encoding'].includes(header)))) {
      diagnostics.push({ code: 'UNSUPPORTED_PART_HEADER', message: `Part contains a header not defined for multipart/form-data by RFC 7578.`, part: name });
    }
  }
  for (const group of expectedGroups) {
    const parts = actualByName.get(group.name) ?? [];
    if (parts.length !== group.count) diagnostics.push({ code: 'PART_COUNT_MISMATCH', message: `Multipart part count does not match for ${group.name}.`, part: group.name, expected: group.count, actual: parts.length });
    for (const header of group.requiredHeaders) {
      if (parts.some((part) => !(header in part.headers))) diagnostics.push({ code: 'MISSING_PART_HEADER', message: `Required part header ${header} is missing for ${group.name}.`, part: group.name, expected: header, actual: 'missing' });
    }
    if (parts.some((part) => 'content-transfer-encoding' in part.headers) && !group.requiredHeaders.includes('content-transfer-encoding') && !('content-transfer-encoding' in group.expectedHeaders)) {
      diagnostics.push({ code: 'UNSUPPORTED_PART_ENCODING', message: `Content-Transfer-Encoding is not declared for multipart property ${group.name}.`, part: group.name });
    }
    for (const [headerName, headerValue] of Object.entries(group.expectedHeaders)) {
      const key = headerName.toLowerCase();
      const expectedValue = key === 'content-transfer-encoding' ? headerValue.toLowerCase() : headerValue;
      if (parts.some((part) => !part.headers[key]?.some((value) => (key === 'content-transfer-encoding' ? value.toLowerCase() : value) === expectedValue))) {
        diagnostics.push({ code: 'PART_HEADER_MISMATCH', message: `Part header ${key} does not match for ${group.name}.`, part: group.name, expected: key, actual: 'mismatch' });
      }
    }
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part) continue;
      if (group.contentType && !matchesMediaType(part.contentType, group.contentType)) {
        diagnostics.push({ code: 'CONTENT_TYPE_MISMATCH', message: `Content-Type does not match for ${group.name} part ${index + 1}.`, part: group.name, expected: mediaTypeEssence(group.contentType), actual: mediaTypeEssence(part.contentType) });
      }
      const expectedBody = group.bodies[index];
      if (expectedBody !== undefined) {
        const bodyResult = bodyMatches(part.body, expectedBody, group.json);
        if (bodyResult === 'unsupported') diagnostics.push({ code: 'UNSUPPORTED_JSON_BODY', message: `JSON body for ${group.name} uses duplicate keys or numbers outside the supported precision.`, part: group.name });
        else if (bodyResult === 'mismatch') diagnostics.push({ code: 'BODY_MISMATCH', message: `Part body does not match for ${group.name} part ${index + 1}.`, part: group.name });
      }
    }
  }
  for (const [name, assertions] of Object.entries(fixtureCase.assert?.parts ?? {})) {
    const parts = actualByName.get(name) ?? [];
    if (!expectedNames.has(name)) diagnostics.push({ code: 'ASSERTION_UNKNOWN_PART', message: `Fixture assertion references undeclared multipart part ${name}.`, part: name });
    if (assertions.count !== undefined && parts.length !== assertions.count) {
      diagnostics.push({ code: 'FIXTURE_COUNT_ASSERTION', message: `Fixture count assertion failed for ${name}.`, part: name, expected: assertions.count, actual: parts.length });
    }
    if (assertions.contentType !== undefined && (parts.length === 0 || parts.some((part) => !matchesMediaType(part.contentType, assertions.contentType as string)))) {
      diagnostics.push({ code: 'FIXTURE_CONTENT_TYPE_ASSERTION', message: `Fixture Content-Type assertion failed for ${name}.`, part: name, expected: mediaTypeEssence(assertions.contentType), actual: 'mismatch' });
    }
    for (const [headerName, headerValue] of Object.entries(assertions.headers ?? {})) {
      const key = headerName.toLowerCase();
      if (parts.length === 0 || parts.some((part) => part.headers[key]?.length !== 1 || part.headers[key]?.[0] !== headerValue)) {
        diagnostics.push({ code: 'FIXTURE_HEADER_ASSERTION', message: `Fixture header assertion failed for ${key} on ${name}.`, part: name, expected: key, actual: 'mismatch' });
      }
    }
  }
  return diagnostics;
};
