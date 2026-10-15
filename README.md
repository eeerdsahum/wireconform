# WireConform

WireConform is an open-source CLI for checking whether generated OpenAPI clients send multipart requests that match the multipart rules in their OpenAPI document. It runs the generated client against a temporary HTTP capture server bound only to `127.0.0.1`, then compares the received part names, counts, media types, headers, and bodies.

## Install from npm

WireConform `0.1.0-beta.2` is published on [npm](https://www.npmjs.com/package/wireconform). Install the prerelease explicitly through the `beta` dist-tag:

Requirements: Node.js 22.18 or newer and npm 10 or newer.

```powershell
npm install --save-dev wireconform@beta
npx wireconform adapters
npx wireconform validate ./openapi.yaml
```

To run the included passing Hey API fixture, add the tested `js-yaml` override before installing the optional generator. This avoids locking the generator's vulnerable `js-yaml@4.2.0` dependency before the override is applied:

```powershell
npm pkg set 'overrides.@hey-api/openapi-ts.js-yaml=4.3.2'
npm install --save-dev --save-exact @hey-api/openapi-ts@0.99.0 typescript@5.9.3
npx wireconform run node_modules/wireconform/examples/hey-api-positive.yaml --adapter hey-api
```

The bundled fixture resolves its OpenAPI document and tiny binary file from the installed package. For your own test, create a fixture that references your OpenAPI document and local files using paths relative to the fixture, then run `npx wireconform run ./fixtures/upload.yaml --adapter hey-api`.

The npm registry currently points both `beta` and `latest` to beta.2. Use the explicit `@beta` tag so the prerelease is clear. The `latest` tag issue is under investigation; see [npm distribution status](docs/npm-publishing.md). The [v0.1.0-beta.2 source archive](https://github.com/eeerdsahum/wireconform/releases/tag/v0.1.0-beta.2) and source installation remain available for developers who prefer building from GitHub.

## Install from source

Requirements: Node.js 22.18 or newer and npm 10 or newer.

```powershell
npm ci
npm run build
npm link
```

Run these commands from the WireConform checkout directory.

The published [WireConform v0.1.0-beta.1 release](https://github.com/eeerdsahum/wireconform/releases/tag/v0.1.0-beta.1) has a diagnostic privacy issue: malformed YAML can expose input snippets and some filesystem errors can expose local paths in CLI and JSON diagnostics. No actual credential exposure has been confirmed. Do not share raw beta.1 logs that may contain sensitive data. The fix is included in [WireConform v0.1.0-beta.2](https://github.com/eeerdsahum/wireconform/releases/tag/v0.1.0-beta.2); upgrade to beta.2.

The beta.2 npm package is available as `wireconform@beta`. Its bundled README reflects the pre-publication source state and still contains the earlier source-install instructions; this repository README has the current npm quick start.

To build a tarball from this checkout for another project, pack it here, then install the resulting tarball:

```powershell
npm pack
Set-Location C:\my-project
npm install --save-dev C:\path\to\wireconform-0.1.0-beta.2.tgz
```

The Hey API adapter is an optional peer because its baseline generator has a vulnerable transitive `js-yaml@4.2.0` pin and needs a compatible TypeScript compiler. To run it in that project, install the pinned generator and verified TypeScript version, then override the parser to the patched compatible release:

```powershell
npm install --save-dev --save-exact @hey-api/openapi-ts@0.99.0 typescript@5.9.3
```

Add this to the project-root `package.json`, then run `npm install`:

```json
{
  "overrides": {
    "@hey-api/openapi-ts": {
      "js-yaml": "4.3.2"
    }
  }
}
```

The OpenAPI Generator adapter has no npm generator dependency; it requires Java 11+ and the pinned CLI JAR described below.

## Quick start

```powershell
node dist/cli.js adapters
node dist/cli.js validate examples/positive-openapi.yaml
node dist/cli.js run examples/hey-api-positive.yaml --adapter hey-api
```

The `hey-api` command above runs a real generated SDK and exits `0` when all cases conform. The regression fixture deliberately exercises the earlier array serialization defect:

```powershell
node dist/cli.js run examples/regression.yaml --adapter hey-api
$LASTEXITCODE
```

For the known Hey API 0.99.0 mismatch, the run prints `FAIL`, saves `.wireconform/latest-report.json`, and exits `1`. The command's nonzero status is the conformance result. A test harness may still exit `0` after asserting that the mismatch was detected.

## Commands

```text
wireconform adapters
wireconform validate <openapi.yaml|openapi.json> [--format text|json]
wireconform run <fixture.yaml|fixture.json> --adapter <id> [--format text|json] [--report <file>]
wireconform report --format json [--file <report.json>]
```

`validate` checks the supported OpenAPI document structure, local references, and multipart operations. It returns the multipart operation IDs that WireConform can run. It is not a complete OpenAPI meta-schema validator or a general-purpose API linter; unsupported multipart constructs produce an explicit diagnostic.

`run` generates the SDK with a pinned adapter, starts a fresh loopback capture server for each case, and compares the actual request with expectations derived from the selected OpenAPI version. Reports contain case names, part counts, diagnostic codes, generator and specification metadata, and timestamps. They omit request bodies, filenames, credentials, and header values, but retain user-provided identifiers such as operation IDs, path templates, fixture case names, and part names. Content-Type mismatch diagnostics include the expected and captured media-type essences.

Exit codes are stable for scripts:

| Code | Meaning |
| --- | --- |
| `0` | Validation passed or every conformance case passed |
| `1` | A generated request is malformed or does not conform |
| `2` | Invalid input, unsupported feature, adapter setup, or execution error |

JSON mode writes machine-readable output to stdout. `run` saves the same report to `.wireconform/latest-report.json` unless `--report` names another file. Use `wireconform report --format json` to read the last report.

## Example fixtures

- [`examples/hey-api-positive.yaml`](examples/hey-api-positive.yaml) checks a binary file and plain text with Hey API.
- [`examples/positive.yaml`](examples/positive.yaml) checks JSON, binary, and text parts with OpenAPI Generator.
- [`examples/regression.yaml`](examples/regression.yaml) covers the repeated object array from the Hey API reproduction.
- [`examples/reports/`](examples/reports/) contains reports captured from the pinned generator runs below.
- [`docs/demo.md`](docs/demo.md) walks through the real generated request, expected versus actual headers, and CLI exit codes.

## Captured output

Hey API 0.99.0 sends four parts, including two `products` items with the RFC 7578 default `text/plain`; the OpenAPI encoding expects `application/json` for each object item:

```text
WireConform 0.1.0-beta.2 — postProductUploadDocument (POST /product/uploadDocument)
Adapter: hey-api 0.99.0
FAIL issue-4281-products-array (4 parts)
  CONTENT_TYPE_MISMATCH: Content-Type does not match for products part 1.
  CONTENT_TYPE_MISMATCH: Content-Type does not match for products part 2.
Result: FAIL
Report saved.
```

The run exits `1`. A passing run with the same stable adapter produces:

```text
WireConform 0.1.0-beta.2 — uploadBasic (POST /basic)
Adapter: hey-api 0.99.0
PASS binary-and-text (3 parts)
Result: PASS
```

The captured JSON report shows the actual values for both repeated items:

```json
{
  "code": "CONTENT_TYPE_MISMATCH",
  "part": "products",
  "expected": "application/json",
  "actual": "text/plain"
}
```

This excerpt is from the [committed Hey API 0.99.0 report](examples/reports/hey-api-0.99.0-regression.json); the report omits request bodies, filenames, credentials, and header values.

OpenAPI Generator 7.26.0 passes the JSON/binary/text example and independently fails the array serialization check because it sends the whole array as one JSON part:

```text
WireConform 0.1.0-beta.1 — uploadDocument (POST /documents)
Adapter: openapi-generator 7.26.0
PASS json-binary-and-text (3 parts)
Result: PASS

WireConform 0.1.0-beta.1 — postProductUploadDocument (POST /product/uploadDocument)
Adapter: openapi-generator 7.26.0
FAIL issue-4281-products-array (3 parts)
  PART_COUNT_MISMATCH: Multipart part count does not match for products.
  BODY_MISMATCH: Part body does not match for products part 1.
Result: FAIL
```

These outputs come from actual generator runs against the committed fixtures. The saved JSON reports are [`Hey API 0.99.0`](examples/reports/hey-api-0.99.0-regression.json), [`OpenAPI Generator positive`](examples/reports/openapi-generator-7.26.0-positive.json), and [`OpenAPI Generator array regression`](examples/reports/openapi-generator-7.26.0-array-regression.json).

Fixture `body` values are JSON/YAML values. A local file part uses a marker:

```yaml
file:
  $wireconform: file
  path: ./files/tiny.bin
  filename: tiny.bin
```

File paths resolve relative to the fixture and must remain within its directory, including after symlink resolution. Files are limited to 10 MiB. Fixture authors can add safe metadata assertions without replacing standards-derived expectations:

```yaml
assert:
  parts:
    record:
      count: 2
      contentType: application/json
      headers:
        Content-Disposition: 'form-data; name="record"'
```

Header assertion values are compared in memory and are never included in reports. Assertions accept only the `Content-Type`, `Content-Disposition`, and `Content-Transfer-Encoding` headers defined for multipart form-data; other part headers are reported as unsupported under RFC 7578.

## Generator adapters

| Adapter | Pinned version | Runtime | Notes |
| --- | --- | --- | --- |
| `hey-api` | `@hey-api/openapi-ts` 0.99.0 with TypeScript 5.9.3 | TypeScript Axios SDK | Optional peer adapter; install both in the project running WireConform and apply the `js-yaml` override above |
| `openapi-generator` | OpenAPI Generator CLI 7.26.0 | `typescript-axios` | Official CLI JAR, checksum and version verified before generation; Java 11+ required |

Install the [official OpenAPI Generator 7.26.0 CLI JAR](https://openapi-generator.tech/docs/installation/) and Java 11 or newer, then configure the JAR path:

```powershell
$env:WIRECONFORM_OPENAPI_GENERATOR_JAR = 'C:\tools\openapi-generator-cli-7.26.0.jar'
node dist/cli.js adapters
node dist/cli.js run examples/positive.yaml --adapter openapi-generator
```

WireConform verifies the JAR's pinned SHA-256 checksum and checks that it reports version 7.26.0. It does not download or run an arbitrary generator executable. A separately pinned Hey API prerelease (`0.0.0-next-20260930190945`) is tested with `npm run test:hey-api-next`; it is not used as the stable adapter. Its current captured output still has the two reproduced `products` Content-Type mismatches.

These are the generator versions actually verified by this project. Adapter output can change across releases, so other generator versions must be tested separately before claiming support.

## Conformance rules and limits

WireConform supports OpenAPI 3.0.0 through 3.0.4 and 3.1.0 through 3.1.2. It keeps the versions' rules separate:

- OpenAPI 3.0 multipart defaults treat `string` with `format: binary` or `format: byte` as `application/octet-stream`; plain strings and primitive scalar values default to `text/plain`; object parts default to `application/json`.
- OpenAPI 3.1 multipart defaults use the 3.1 schema model: a missing schema type, or a string with `contentEncoding`, defaults to `application/octet-stream`; other strings and primitive scalar values default to `text/plain`; object parts default to `application/json`. An absent type makes `contentEncoding` irrelevant; string `contentEncoding` values are checked against the corresponding `Content-Transfer-Encoding` header.
- OpenAPI 3.0 `format: byte` parts use `application/octet-stream` with base64 transfer encoding; `format: binary` parts carry raw bytes.
- Arrays are sent as one part per item under the same property name. A declared `encoding.<property>.contentType` is applied to each array item.
- RFC 7578's default for a part with no explicit Content-Type is `text/plain`. Repeated field names are retained and compared as separate parts.

Initial support is limited to `multipart/form-data`, local JSON Pointer references, object request schemas, scalar and object fields, arrays with scalar or object items, declared part `contentType`, required encoding headers, the OpenAPI 3.1 string `contentEncoding` values `base64`, `base64url`, `binary`, `7bit`, and `8bit`, and explicit fixture header assertions. External references, arbitrary schema composition, nested multipart, streaming requests, arbitrary media-type lists, security requirements, operation and path parameters, and OpenAPI 3.1 RFC6570 encoding options are reported as unsupported or malformed. Full schema validation of values against every JSON Schema keyword is not yet implemented.

The [conformance limitations guide](docs/conformance.md) gives details and the relevant specification links.

## Security and privacy

The capture listener binds to `127.0.0.1` on an ephemeral port and does not proxy requests. The SDK worker checks common `http`, `https`, `fetch`, and TCP entry points against that capture origin to block accidental calls to other destinations. This check is defense in depth, not a security sandbox: generated code could use other APIs, native modules, or child processes to bypass it. Requests are capped at 12 MiB and 500 parts. The known adapters invoke only their pinned generators; OpenAPI Generator requires an explicitly configured JAR that matches the pinned artifact checksum.

WireConform executes generated SDK code in a child Node process with the current user's permissions. It is not sandboxed; only run trusted specifications and fixtures, and do not include secrets in fixture values or identifiers. Current diagnostics omit parser excerpts, filesystem paths, and arbitrary exception messages. Reports retain specification and fixture identifiers, so review them before sharing. Part bodies are not printed or saved by default.

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Development

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run test:hey-api-next
npm audit
npm pack --dry-run
```

The integration suite runs the pinned Hey API baseline. It runs OpenAPI Generator integration cases when the pinned JAR and Java 11+ are configured. `npm run test:full` runs lint, typecheck, tests, the prerelease comparison, dependency audit, an isolated packed-package install and CLI smoke test, and package dry run.

The source project's `js-yaml` overrides are necessary because the stable generator's reference parser pins vulnerable `4.2.0`, while the prerelease parser requests vulnerable `5.3.0`. The source lock uses patched compatible releases `4.3.2` and `5.4.3`; the real generator cases exercise those versions, and the source dependency tree reports zero audit findings. The released CLI keeps Hey API optional so installing WireConform alone does not install the vulnerable generator tree. If you opt into that adapter, apply the root override shown above. These patched parser versions retain the `load` API used by the generators. See the [`js-yaml` security advisories](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh), [4.x merge-key advisory](https://github.com/nodeca/js-yaml/security/advisories/GHSA-52cp-r559-cp3m), and [5.x advisory](https://github.com/nodeca/js-yaml/security/advisories/GHSA-r3ph-w7gj-g6xm). `npm explain js-yaml` prints the locked dependency tree.

See the [v0.1.0-beta.2 release](https://github.com/eeerdsahum/wireconform/releases/tag/v0.1.0-beta.2), [beta.2 release notes](docs/releases/v0.1.0-beta.2.md), [historical beta.1 release](https://github.com/eeerdsahum/wireconform/releases/tag/v0.1.0-beta.1) and [beta.1 release notes](docs/releases/v0.1.0-beta.1.md), [conformance limitations](docs/conformance.md), [npm publishing and release plan](docs/npm-publishing.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md), and [LICENSE](LICENSE).
