export type JsonObject = Record<string, unknown>;

export type Diagnostic = {
  code: string;
  message: string;
  part?: string;
  expected?: string | number;
  actual?: string | number;
};

export type CapturedPart = {
  name: string;
  filename?: string;
  headers: Record<string, string[]>;
  contentType: string;
  body: Buffer;
};

export type ExpectedPartGroup = {
  name: string;
  count: number;
  contentType?: string;
  bodies: Array<Buffer | string>;
  json: boolean;
  requiredHeaders: string[];
  expectedHeaders: Record<string, string>;
};

export type CaseResult = {
  name: string;
  status: 'pass' | 'fail' | 'error';
  partCount: number;
  diagnostics: Diagnostic[];
};

export type RunReport = {
  wireconformVersion: string;
  createdAt: string;
  specification: {
    path: string;
    openapi: string;
    operationId: string;
    method: string;
    pathTemplate: string;
  };
  adapter: {
    id: string;
    version: string;
  };
  status: 'pass' | 'fail' | 'error';
  cases: CaseResult[];
};

export type FixtureFile = {
  fixtureVersion: 1;
  openapi: string;
  operationId: string;
  cases: FixtureCase[];
};

export type FixtureCase = {
  name: string;
  body: JsonObject;
  assert?: {
    parts?: Record<string, {
      count?: number;
      contentType?: string;
      headers?: Record<string, string>;
    }>;
  };
};

export type MultipartOperation = {
  operationId: string;
  method: string;
  path: string;
  requestBody: JsonObject;
  mediaType: JsonObject;
  schema: JsonObject;
  properties: Record<string, JsonObject>;
  required: Set<string>;
  encodings: Record<string, JsonObject>;
  allowsAdditionalProperties: boolean;
};

export type LoadedOpenApi = {
  path: string;
  openapi: string;
  document: JsonObject;
  operations: MultipartOperation[];
};

export type GeneratorAdapter = {
  id: string;
  version: string;
  executionKind: 'hey-api-function' | 'openapi-generator-axios';
  available(): Promise<{ ready: boolean; detail: string }>;
  generate(openApiPath: string, outputDirectory: string): Promise<void>;
};
