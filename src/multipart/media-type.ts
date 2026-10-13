import { MIMEType } from 'node:util';

type ParsedMediaType = {
  essence: string;
  parameters: Map<string, string>;
};

const parseMediaType = (value: string): ParsedMediaType | undefined => {
  try {
    const mime = new MIMEType(value);
    const parameters = new Map<string, string>();
    for (const [name, parameterValue] of mime.params) {
      const normalizedName = name.toLowerCase();
      if (parameters.has(normalizedName)) return undefined;
      parameters.set(normalizedName, parameterValue);
    }
    return { essence: mime.essence.toLowerCase(), parameters };
  } catch {
    return undefined;
  }
};

export const isConcreteMediaType = (value: string): boolean => {
  const parsed = parseMediaType(value);
  return parsed !== undefined && !parsed.essence.includes('*');
};

const parametersMatch = (actual: ParsedMediaType, expected: ParsedMediaType): boolean => {
  if (expected.parameters.size === 0) return true;
  for (const [name, expectedValue] of expected.parameters) {
    const actualValue = actual.parameters.get(name);
    if (actualValue === undefined) return false;
    const valuesMatch = name === 'charset'
      ? actualValue.toLowerCase() === expectedValue.toLowerCase()
      : actualValue === expectedValue;
    if (!valuesMatch) return false;
  }
  return true;
};

export const matchesMediaType = (actualValue: string, expectedValue: string): boolean => {
  const actual = parseMediaType(actualValue);
  const expected = parseMediaType(expectedValue);
  if (!actual || !expected) return false;
  if (expected.essence === '*/*') return true;
  if (expected.essence.endsWith('/*')) {
    return actual.essence.startsWith(expected.essence.slice(0, -1)) && parametersMatch(actual, expected);
  }
  return actual.essence === expected.essence && parametersMatch(actual, expected);
};

export const mediaTypeEssence = (value: string): string => parseMediaType(value)?.essence ?? value.trim().toLowerCase().split(';', 1)[0]?.trim() ?? 'invalid';
