export class WireConformError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 2) {
    super(message);
    this.name = 'WireConformError';
    this.code = code;
    this.exitCode = exitCode;
  }
}
