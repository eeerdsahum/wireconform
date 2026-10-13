import { parseDocument } from 'yaml';

export type JsonInspection =
  | { kind: 'valid'; value: unknown }
  | { kind: 'malformed' }
  | { kind: 'ambiguous' }
  | { kind: 'unsupported' };

export const isSafeJsonValue = (value: unknown, active = new WeakSet<object>()): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (typeof value !== 'object') return false;
  if (active.has(value)) return false;
  active.add(value);
  const safe = Array.isArray(value)
    ? value.every((item) => isSafeJsonValue(item, active))
    : Object.values(value).every((item) => isSafeJsonValue(item, active));
  active.delete(value);
  return safe;
};

export const inspectJsonText = (source: string): JsonInspection => {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return { kind: 'malformed' };
  }
  try {
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length > 0) return { kind: 'ambiguous' };
  } catch {
    return { kind: 'ambiguous' };
  }
  if (!isSafeJsonValue(value)) return { kind: 'unsupported' };
  return { kind: 'valid', value };
};
