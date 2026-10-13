import { WireConformError } from '../errors.js';
import type { CapturedPart } from '../types.js';

const maxHeaderBytes = 64 * 1024;
const isMimeTokenCharacter = (character: string | undefined): boolean => character !== undefined && /[!#$%&'*+.^_`|~0-9A-Za-z-]/.test(character);

const parseMediaTypeParameters = (contentType: string): Map<string, string> => {
  const parameters = new Map<string, string>();
  let cursor = contentType.indexOf(';');
  if (cursor < 0) return parameters;
  cursor += 1;
  while (cursor < contentType.length) {
    while (contentType[cursor] === ' ' || contentType[cursor] === '\t') cursor += 1;
    const nameStart = cursor;
    while (isMimeTokenCharacter(contentType[cursor])) cursor += 1;
    if (cursor === nameStart) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type contains an invalid parameter.', 1);
    const name = contentType.slice(nameStart, cursor).toLowerCase();
    while (contentType[cursor] === ' ' || contentType[cursor] === '\t') cursor += 1;
    if (contentType[cursor] !== '=') throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type contains an invalid parameter.', 1);
    cursor += 1;
    while (contentType[cursor] === ' ' || contentType[cursor] === '\t') cursor += 1;
    let value = '';
    if (contentType[cursor] === '"') {
      cursor += 1;
      let closed = false;
      while (cursor < contentType.length) {
        const character = contentType[cursor] ?? '';
        if (character === '"') {
          cursor += 1;
          closed = true;
          break;
        }
        if (character === '\\') {
          cursor += 1;
          const escaped = contentType[cursor] ?? '';
          if (!escaped || /[\r\n\0\x7f]/.test(escaped) || (escaped.charCodeAt(0) < 0x20 && escaped !== '\t')) {
            throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type contains an invalid quoted parameter.', 1);
          }
          value += escaped;
          cursor += 1;
        } else {
          if (/[\r\n\0\x7f]/.test(character) || (character.charCodeAt(0) < 0x20 && character !== '\t')) {
            throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type contains an invalid quoted parameter.', 1);
          }
          value += character;
          cursor += 1;
        }
      }
      if (!closed) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type contains an unterminated quoted parameter.', 1);
    } else {
      const valueStart = cursor;
      while (isMimeTokenCharacter(contentType[cursor])) cursor += 1;
      if (cursor === valueStart) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type contains an invalid parameter value.', 1);
      value = contentType.slice(valueStart, cursor);
    }
    if (parameters.has(name)) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type contains a duplicate parameter.', 1);
    parameters.set(name, value);
    while (contentType[cursor] === ' ' || contentType[cursor] === '\t') cursor += 1;
    if (cursor === contentType.length) break;
    if (contentType[cursor] !== ';') throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type contains trailing parameter data.', 1);
    cursor += 1;
    if (cursor === contentType.length) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type contains an empty parameter.', 1);
  }
  return parameters;
};

const parseBoundary = (contentType: string): string => {
  const mediaType = contentType.slice(0, contentType.indexOf(';') < 0 ? contentType.length : contentType.indexOf(';'));
  if (mediaType?.trim().toLowerCase() !== 'multipart/form-data') throw new WireConformError('MALFORMED_MULTIPART', 'Captured request Content-Type is not multipart/form-data.', 1);
  const parameters = parseMediaTypeParameters(contentType);
  const boundary = parameters.get('boundary');
  if (boundary === undefined) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Type must contain exactly one boundary.', 1);
  if (boundary.length === 0 || boundary.length > 70 || /[^0-9A-Za-z'()+_,\-./:=? ]/.test(boundary) || boundary.endsWith(' ')) {
    throw new WireConformError('MALFORMED_MULTIPART', 'Multipart boundary is invalid.', 1);
  }
  return boundary;
};

const parseHeaderBlock = (headerBlock: Buffer): Record<string, string[]> => {
  if (headerBlock.some((byte) => byte > 0x7f)) throw new WireConformError('UNSUPPORTED_HEADER_ENCODING', 'Non-ASCII multipart header bytes must use the supported percent-encoded form.', 1);
  const headers: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  const lines = headerBlock.toString('latin1').split('\r\n');
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part contains a malformed header.', 1);
    const name = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\r\n\0]/.test(value)) {
      throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part contains an invalid header.', 1);
    }
    (headers[name] ??= []).push(value);
  }
  return headers;
};

const parseDispositionParameters = (value: string): Map<string, string> => {
  if (!/^form-data(?:\s*;|\s*$)/i.test(value)) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part must use Content-Disposition: form-data.', 1);
  const parameters = new Map<string, string>();
  let cursor = value.search(/;/);
  if (cursor < 0) return parameters;
  cursor += 1;
  while (cursor < value.length) {
    while (value[cursor] === ' ' || value[cursor] === '\t') cursor += 1;
    const nameStart = cursor;
    while (cursor < value.length && /[!#$%&'*+.^_`|~0-9A-Za-z-]/.test(value[cursor] ?? '')) cursor += 1;
    if (cursor === nameStart) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Disposition contains an invalid parameter.', 1);
    const name = value.slice(nameStart, cursor).toLowerCase();
    if (name === 'filename*') throw new WireConformError('MALFORMED_MULTIPART', 'RFC 7578 does not permit the filename* parameter.', 1);
    while (value[cursor] === ' ' || value[cursor] === '\t') cursor += 1;
    if (value[cursor] !== '=') throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Disposition contains an invalid parameter.', 1);
    cursor += 1;
    while (value[cursor] === ' ' || value[cursor] === '\t') cursor += 1;
    let parameterValue = '';
    if (value[cursor] === '"') {
      cursor += 1;
      let closed = false;
      while (cursor < value.length) {
        const character = value[cursor] ?? '';
        if (character === '"') {
          cursor += 1;
          closed = true;
          break;
        }
        if (character === '\\') {
          cursor += 1;
          const escaped = value[cursor] ?? '';
          if (!escaped || /[\r\n\0]/.test(escaped)) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Disposition contains an invalid quoted parameter.', 1);
          parameterValue += escaped;
          cursor += 1;
        } else {
          if (/[\r\n\0]/.test(character)) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Disposition contains an invalid quoted parameter.', 1);
          parameterValue += character;
          cursor += 1;
        }
      }
      if (!closed) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Disposition contains an unterminated quoted parameter.', 1);
    } else {
      const valueStart = cursor;
      while (cursor < value.length && /[!#$%&'*+.^_`|~0-9A-Za-z-]/.test(value[cursor] ?? '')) cursor += 1;
      if (cursor === valueStart) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Disposition contains an empty parameter value.', 1);
      parameterValue = value.slice(valueStart, cursor);
    }
    if (parameters.has(name)) throw new WireConformError('MALFORMED_MULTIPART', `Multipart Content-Disposition repeats the ${name} parameter.`, 1);
    parameters.set(name, parameterValue);
    while (value[cursor] === ' ' || value[cursor] === '\t') cursor += 1;
    if (cursor === value.length) break;
    if (value[cursor] !== ';') throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Disposition contains trailing parameter data.', 1);
    cursor += 1;
    if (cursor === value.length) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart Content-Disposition contains an empty parameter.', 1);
  }
  return parameters;
};

const parseDispositionName = (parameters: Map<string, string>): string => {
  const rawName = parameters.get('name');
  let name = rawName;
  if (rawName?.includes('%')) {
    try {
      name = decodeURIComponent(rawName);
    } catch {
      throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part name contains invalid percent encoding.', 1);
    }
  }
  if (!name || /[\r\n\0]/.test(name)) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part is missing a valid name parameter.', 1);
  return name;
};

const contentTypeOf = (headers: Record<string, string[]>): string => {
  const values = headers['content-type'];
  if (values === undefined) return 'text/plain';
  if (values.length !== 1) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part contains multiple Content-Type headers.', 1);
  return values[0]?.trim() ?? 'text/plain';
};

const parseDelimiter = (payload: Buffer, markerStart: number, markerLength: number): { closing: boolean; after: number } | undefined => {
  let cursor = markerStart + markerLength;
  const closing = payload.subarray(cursor, cursor + 2).equals(Buffer.from('--'));
  if (closing) cursor += 2;
  while (payload[cursor] === 0x20 || payload[cursor] === 0x09) cursor += 1;
  if (closing) {
    if (cursor === payload.length) return { closing, after: cursor };
    if (payload.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) return { closing, after: cursor + 2 };
    return undefined;
  }
  if (payload.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) return { closing, after: cursor + 2 };
  return undefined;
};

export const parseMultipart = (contentType: string, payload: Buffer): CapturedPart[] => {
  const parsedBoundary = parseBoundary(contentType);
  const boundary = Buffer.from(`--${parsedBoundary}`, 'latin1');
  const separator = Buffer.from('\r\n\r\n', 'latin1');
  const boundaryLine = Buffer.from(`\r\n--${parsedBoundary}`, 'latin1');
  const parts: CapturedPart[] = [];
  let openingStart = -1;
  let openingDelimiter: { closing: boolean; after: number } | undefined;
  let openingSearch = 0;
  while (openingStart < 0) {
    const markerStart = payload.indexOf(boundary, openingSearch);
    if (markerStart < 0) break;
    const atLineStart = markerStart === 0 || payload.subarray(markerStart - 2, markerStart).equals(Buffer.from('\r\n'));
    const delimiter = atLineStart ? parseDelimiter(payload, markerStart, boundary.length) : undefined;
    if (delimiter) {
      openingStart = markerStart;
      openingDelimiter = delimiter;
      break;
    }
    openingSearch = markerStart + 1;
  }
  if (openingStart < 0 || !openingDelimiter) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart body has no valid opening boundary.', 1);
  if (openingDelimiter.closing) return parts;
  let cursor = openingDelimiter.after;
  while (true) {
    const headerEnd = payload.indexOf(separator, cursor);
    if (headerEnd < 0 || headerEnd - cursor > maxHeaderBytes) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part headers are missing or too large.', 1);
    const headers = parseHeaderBlock(payload.subarray(cursor, headerEnd));
    const dispositionValues = headers['content-disposition'];
    if (dispositionValues?.length !== 1) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part must contain one Content-Disposition header.', 1);
    const disposition = dispositionValues[0] ?? '';
    const dispositionParameters = parseDispositionParameters(disposition);
    const name = parseDispositionName(dispositionParameters);
    const filename = dispositionParameters.get('filename');
    if ((headers['content-transfer-encoding']?.length ?? 0) > 1) {
      throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part contains multiple Content-Transfer-Encoding headers.', 1);
    }
    const bodyStart = headerEnd + separator.length;
    let boundaryStart = payload.indexOf(boundaryLine, bodyStart);
    let delimiter: { closing: boolean; after: number } | undefined;
    while (boundaryStart >= 0) {
      delimiter = parseDelimiter(payload, boundaryStart + 2, boundary.length);
      if (delimiter) break;
      boundaryStart = payload.indexOf(boundaryLine, boundaryStart + 1);
    }
    if (boundaryStart < 0 || !delimiter) throw new WireConformError('MALFORMED_MULTIPART', 'Multipart part does not end at a declared boundary.', 1);
    parts.push({
      name,
      ...(filename === undefined ? {} : { filename }),
      headers,
      contentType: contentTypeOf(headers),
      body: payload.subarray(bodyStart, boundaryStart),
    });
    if (parts.length > 500) throw new WireConformError('MULTIPART_PART_LIMIT', 'Multipart request exceeds 500 parts.', 1);
    if (delimiter.closing) return parts;
    cursor = delimiter.after;
  }
};
