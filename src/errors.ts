export type SafeDiagnosticContext = {
  yamlSource?: 'openapi' | 'fixture';
  line?: number;
  column?: number;
};

export type SafeDiagnostic = {
  code: string;
  message: string;
  exitCode: number;
};

const safeMessages: Record<string, string> = {
  ADAPTER_CLEANUP_FAILED: 'Generator adapter temporary files could not be removed.',
  ADAPTER_INTEGRITY: 'The configured OpenAPI Generator artifact failed its integrity check.',
  ADAPTER_NOT_CONFIGURED: 'The selected generator adapter is not configured. Run `wireconform adapters` for setup details.',
  ADAPTER_NOT_READY: 'The selected generator adapter is not ready. Run `wireconform adapters` for setup details.',
  ADAPTER_VERSION: 'The configured generator version does not match the supported version.',
  CAPTURE_CLEANUP_FAILED: 'The loopback capture server could not close cleanly.',
  CAPTURE_SERVER: 'The loopback capture server could not start.',
  CAPTURE_TIMEOUT: 'No multipart request reached the loopback capture server before the timeout.',
  CLI_ARGUMENT: 'Command arguments are invalid. Run `wireconform --help` for usage.',
  CLI_COMMAND: 'Unknown command. Run `wireconform --help` for usage.',
  DUPLICATE_OPERATION_ID: 'The OpenAPI document contains a duplicate multipart operationId.',
  FIXTURE_FILE_NOT_FOUND: 'A file referenced by the fixture could not be opened.',
  FIXTURE_FILE_TOO_LARGE: 'A fixture file exceeds the supported size limit.',
  FIXTURE_FILE_UNREADABLE: 'A file referenced by the fixture could not be read.',
  FIXTURE_FILES_TOO_LARGE: 'The fixture files exceed the combined supported size limit.',
  FIXTURE_NOT_FOUND: 'The fixture could not be opened.',
  FIXTURE_PATH_ESCAPE: 'Fixture file paths must stay within the fixture directory.',
  FIXTURE_TOO_LARGE: 'The fixture exceeds the supported size limit.',
  FIXTURE_UNREADABLE: 'The fixture could not be read.',
  GENERATOR_FAILED: 'The selected generator could not generate an SDK.',
  INTERNAL_ERROR: 'WireConform encountered an unexpected internal error.',
  INVALID_DOCUMENT: 'OpenAPI document is invalid.',
  INVALID_ENCODING: 'Multipart encoding configuration is invalid.',
  INVALID_FIXTURE: 'Fixture is invalid.',
  INVALID_REFERENCE: 'OpenAPI document contains an invalid local reference.',
  INVALID_REPORT: 'The report file is not a valid WireConform JSON report.',
  JAVA_UNAVAILABLE: 'Java 11 or newer and the pinned OpenAPI Generator artifact are required.',
  JAVA_VERSION: 'OpenAPI Generator requires Java 11 or newer.',
  MALFORMED_MULTIPART: 'The generated request contains malformed multipart data.',
  MISSING_OPERATION_ID: 'Every supported multipart operation must define an operationId.',
  MULTIPART_PART_LIMIT: 'The generated request exceeds the supported multipart part limit.',
  NO_CAPTURED_REQUEST: 'The generated SDK completed without sending a request to the loopback capture server.',
  OPENAPI_NOT_FOUND: 'The OpenAPI document could not be opened.',
  OPENAPI_UNREADABLE: 'The OpenAPI document could not be read.',
  OPERATION_NOT_FOUND: 'The fixture operationId was not found in the OpenAPI document.',
  REFERENCE_CYCLE: 'The OpenAPI document contains a circular local reference.',
  REPORT_NOT_FOUND: 'The WireConform report could not be read.',
  REPORT_TOO_LARGE: 'The report exceeds the supported size limit.',
  REPORT_WRITE_FAILED: 'The WireConform report could not be written.',
  REQUEST_METHOD_MISMATCH: 'The generated SDK used an unexpected HTTP method.',
  REQUEST_PATH_MISMATCH: 'The generated SDK sent the request to an unexpected path.',
  REQUEST_TOO_LARGE: 'The generated request exceeds the supported size limit.',
  SDK_EXECUTION: 'Generated SDK execution failed.',
  SDK_TIMEOUT: 'Generated SDK execution exceeded the 25 second limit.',
  SPEC_TOO_LARGE: 'The OpenAPI document exceeds the supported size limit.',
  TEMP_FILES_CLEANUP_FAILED: 'WireConform temporary files could not be removed.',
  UNKNOWN_ADAPTER: 'Unknown generator adapter. Run `wireconform adapters` to list supported adapters.',
  UNSAFE_REPORT_PATH: 'The report path must not traverse symbolic links or non-directory paths.',
  UNSUPPORTED_ADDITIONAL_PROPERTIES: 'Multipart schemas with undeclared additional properties are not supported.',
  UNSUPPORTED_CONTENT_ENCODING: 'The multipart contentEncoding value is not supported.',
  UNSUPPORTED_ENCODING: 'The multipart encoding configuration is not supported.',
  UNSUPPORTED_ENCODING_HEADER: 'The multipart encoding header configuration is not supported.',
  UNSUPPORTED_FIXTURE_HEADER: 'The fixture uses a part header that WireConform does not support.',
  UNSUPPORTED_HEADER_ENCODING: 'The multipart part header encoding is not supported.',
  UNSUPPORTED_MULTIPART_MEDIA_TYPE: 'Only multipart/form-data requests are supported.',
  UNSUPPORTED_MULTIPART_SCHEMA: 'The multipart request schema is outside the supported subset.',
  UNSUPPORTED_OPENAPI_VERSION: 'The OpenAPI version is outside the documented supported range.',
  UNSUPPORTED_PARAMETERS: 'Multipart operations with parameters are not supported by the fixture runner.',
  UNSUPPORTED_REFERENCE: 'Only local OpenAPI JSON Pointer references are supported.',
  UNSUPPORTED_REFERENCE_SIBLINGS: 'Reference objects with sibling fields are not supported.',
  UNSUPPORTED_REQUEST_MEDIA_TYPES: 'Multipart requests with additional media types are not supported.',
  UNSUPPORTED_SCHEMA_COMPOSITION: 'Composed multipart schemas are not supported.',
  UNSUPPORTED_SCHEMA_KEYWORD: 'The multipart schema uses an unsupported keyword.',
  UNSUPPORTED_SCHEMA_REF_SIBLINGS: 'Multipart schema references with sibling fields are not supported.',
  UNSUPPORTED_SCHEMA_TYPE: 'The multipart schema uses an unsupported or unspecified type.',
  UNSUPPORTED_SECURITY: 'Authenticated SDK execution is not supported.',
  UNSUPPORTED_SERIALIZATION: 'The multipart value cannot be serialized using the supported rules.',
};

const validPosition = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export const createYamlDiagnosticContext = (yamlSource: 'openapi' | 'fixture', line: unknown, column: unknown): SafeDiagnosticContext => ({
  yamlSource,
  ...(validPosition(line) ? { line } : {}),
  ...(validPosition(column) ? { column } : {}),
});

const messageFor = (code: string, context?: SafeDiagnosticContext): string => {
  if ((code === 'INVALID_DOCUMENT' || code === 'INVALID_FIXTURE') && context?.yamlSource) {
    const subject = context.yamlSource === 'openapi' ? 'OpenAPI YAML' : 'Fixture YAML';
    if (validPosition(context.line) && validPosition(context.column)) return `${subject} is invalid at line ${context.line}, column ${context.column}.`;
    if (validPosition(context.line)) return `${subject} is invalid at line ${context.line}.`;
    return `${subject} is invalid.`;
  }
  return safeMessages[code] ?? safeMessages.INTERNAL_ERROR ?? 'WireConform encountered an unexpected internal error.';
};

export class WireConformError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, _message: string, exitCode = 2, context?: SafeDiagnosticContext) {
    super(messageFor(code, context));
    this.name = 'WireConformError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export const toSafeDiagnostic = (error: unknown): SafeDiagnostic => {
  if (error instanceof WireConformError) return { code: error.code, message: error.message, exitCode: error.exitCode };
  return { code: 'INTERNAL_ERROR', message: messageFor('INTERNAL_ERROR'), exitCode: 2 };
};
