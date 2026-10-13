# Conformance model and limitations

WireConform checks the HTTP representation produced by a generated client, not whether a testing framework assertion passes. A CLI `run` with a detected mismatch returns exit code `1`; an integration test can pass by asserting that the mismatch was detected.

## Version-specific defaults

WireConform accepts OpenAPI 3.0.0–3.0.4 and OpenAPI 3.1.0–3.1.2. It rejects other versions, including 3.2.x, until their multipart semantics are implemented and covered by tests.

For OpenAPI 3.0, the multipart Encoding Object defaults a binary or byte string to `application/octet-stream`, a primitive nonbinary scalar to `text/plain`, and an object to `application/json`. An array is serialized as separate same-name items, and its default Content-Type comes from the item schema. See the [OpenAPI 3.0.4 Encoding Object](https://spec.openapis.org/oas/v3.0.4.html#encoding-object) and [multipart considerations](https://spec.openapis.org/oas/v3.0.4.html#special-considerations-for-multipart-content).

For OpenAPI 3.1, WireConform applies the 3.1 rules rather than importing 3.2 behavior. A missing schema `type` defaults to `application/octet-stream`; a string with `contentEncoding` also defaults to `application/octet-stream`; other strings and primitive scalars default to `text/plain`; objects default to `application/json`; array item schemas determine each repeated item's media type. OpenAPI 3.1 explicitly replaces the 3.0 `format`-based binary rule with JSON Schema content keywords, so a 3.1 `format: binary` annotation alone does not select `application/octet-stream`. For a string schema, supported `contentEncoding` values are checked against their corresponding `Content-Transfer-Encoding` header and file bytes for `base64` and `base64url`; when `type` is absent, the specification says `contentEncoding` is irrelevant. See the [OpenAPI 3.1.2 Encoding Object](https://spec.openapis.org/oas/v3.1.2.html#encoding-object) and [multipart encoding](https://spec.openapis.org/oas/v3.1.2.html#encoding-multipart-media-types).

For OpenAPI 3.0, `format: byte` is modeled as octet-stream with base64 transfer encoding, while `format: binary` is raw octet-stream data. This follows the multipart-specific rule in the [OpenAPI 3.0.4 multipart section](https://spec.openapis.org/oas/v3.0.4.html#special-considerations-for-multipart-content).

RFC 7578 specifies `text/plain` when a part has no Content-Type header and requires repeated field names to remain distinct parts. It also limits meaningful part headers to Content-Type, Content-Disposition, and limited use of Content-Transfer-Encoding; WireConform reports other headers and encoding declarations as unsupported. See [RFC 7578 section 4.3](https://www.rfc-editor.org/rfc/rfc7578.html#section-4.3), [section 4.4](https://www.rfc-editor.org/rfc/rfc7578.html#section-4.4), and [section 4.8](https://www.rfc-editor.org/rfc/rfc7578.html#section-4.8).

## Supported feature subset

The loader accepts YAML and JSON documents, resolves local JSON Pointer `$ref` values, and rejects remote references. The multipart validator accepts an object request schema with declared properties and these property forms:

- `string`, `number`, `integer`, and `boolean`
- object parts represented as JSON
- arrays of scalar or object items, repeated under the field name
- `encoding.<property>.contentType`
- required `encoding.<property>.headers` and fixture assertions for expected header values

The checker validates the structural subset that drives its expectations. It does not validate every OpenAPI requirement or every JSON Schema constraint. It does not fully validate body values against enum, pattern, numeric ranges, conditional schemas, or nested object constraints. If `additionalProperties` is `false`, an undeclared emitted part is a conformance failure; if it is `true` or omitted, the part is unsupported because its serialization cannot be derived from the document. It rejects unsupported multipart shapes and features that would change serialization, including external references, schema composition, operation parameters, security requirements, nested multipart, OpenAPI 3.1 RFC6570 encoding options, and comma-separated content types.

The parser preserves part headers and raw bytes so it can check boundaries, malformed payloads, field repetition, binary contents, default Content-Type behavior, and declared part headers. It accepts MIME preambles and epilogues and ignores them, as well as an optional final CRLF after the closing boundary. Boundaries follow RFC 2046's 1–70 character syntax. Non-ASCII field names must use percent-encoded UTF-8; raw non-ASCII header bytes are rejected. Folded headers and duplicate Content-Disposition parameters are rejected as malformed.

Content-Type values are parsed as media types. The media type essence is compared without regard to case. If an expected type declares parameters, each expected parameter must be present with a matching value; extra actual parameters are allowed. Charset values compare without regard to case. Diagnostics include only the media type essence, not parameter values.

## Diagnostics and privacy

Reports contain status, generator/specification identifiers, case names, part counts, diagnostic codes, and expected/captured media-type essences when a Content-Type differs. They omit part bodies, filenames, credential fields, and header values, but retain operation IDs, path templates, specification basenames, fixture case names, and part names. These identifiers are copied from user input; do not put secrets in them, and review reports before sharing. CLI errors use stable messages, never parser excerpts or absolute paths, and include YAML line/column numbers only when the parser provides valid coordinates. The requested report file is the only report output; temporary generated SDKs are removed after each run.

The loopback server binds specifically to `127.0.0.1`, accepts one request per case, has an ephemeral port and a timeout, and does not connect to the target API server. The worker checks common `http`, `https`, `fetch`, and TCP entry points so they target the capture origin. This is defense in depth, not a sandbox; a generated client could use other networking APIs, native modules, or child processes to bypass the check. The request size limit is 12 MiB and the fixture-file limit is 10 MiB.

The two supported adapter flows use fixed tool invocations. The OpenAPI Generator adapter verifies the configured official JAR checksum and version before use. WireConform executes generated SDK code to make requests, so the fixture and specification must be trusted; do not test an untrusted specification in an account that can access sensitive files or credentials.
