# Reproducible multipart demo

This walkthrough uses committed OpenAPI documents and fixtures with the pinned Hey API 0.99.0 adapter. The positive case demonstrates binary and text parts. The regression case sends an array of JSON objects and reproduces a Content-Type mismatch. Run both from the repository root.

## 30–45 second recording

Before recording, install dependencies and build once. Keep the terminal on the repository root, then run the passing fixture followed by the regression fixture:

```powershell
node dist/cli.js run examples/hey-api-positive.yaml --adapter hey-api
node dist/cli.js run examples/regression.yaml --adapter hey-api --format json --report .wireconform/hey-api-regression.json
$LASTEXITCODE
```

Use the actual captured terminal output and the report excerpt below. The first run passes. The second exits `1`; the report records two `products` parts with expected `application/json` and captured `text/plain`.

Suggested narration, about 35 seconds:

> WireConform runs a generated client against a loopback capture server, then compares each multipart part with the OpenAPI contract. This first request sends a binary file and plain-text fields; all three parts conform. Now the regression fixture submits two product objects. OpenAPI 3.0.4 declares `application/json` for each repeated products part. Hey API 0.99.0 sends both as `text/plain`, so the CLI reports two `CONTENT_TYPE_MISMATCH` diagnostics and exits one. The JSON report keeps the expected and captured media-type values but omits request bodies and credentials.

The JSON output contains the concrete diagnostic:

```json
{
  "code": "CONTENT_TYPE_MISMATCH",
  "part": "products",
  "expected": "application/json",
  "actual": "text/plain"
}
```

This is the committed Hey API 0.99.0 capture, not a simulated response. Its full report is [`examples/reports/hey-api-0.99.0-regression.json`](../examples/reports/hey-api-0.99.0-regression.json).

## Prepare the adapters

```powershell
npm ci
npm run build
node dist/cli.js adapters
```

The source project's lockfile installs Hey API 0.99.0 and TypeScript 5.9.3 for the baseline integration. A clean WireConform package install keeps Hey API optional; see the [README adapter setup](../README.md#generator-adapters) before enabling it in another project.

## Run a conformant request

```powershell
node dist/cli.js run examples/hey-api-positive.yaml --adapter hey-api
```

Expected terminal output from the pinned generator run:

```text
WireConform 0.1.0-beta.2 — uploadBasic (POST /basic)
Adapter: hey-api 0.99.0
PASS binary-and-text (3 parts)
Result: PASS
Report saved.
```

## Reproduce and inspect the mismatch

The regression fixture declares `encoding.products.contentType: application/json` in an OpenAPI 3.0.4 document and supplies two products. The CLI result is a real conformance failure, so this command exits with status `1`:

```powershell
node dist/cli.js run examples/regression.yaml --adapter hey-api --format json --report work/hey-api-regression.json
```

The pinned Hey API 0.99.0 run emits four parts. Its two `products` parts are `text/plain`, while OpenAPI 3.0.4 expects `application/json` for each object item:

```json
{
  "status": "fail",
  "cases": [
    {
      "name": "issue-4281-products-array",
      "status": "fail",
      "partCount": 4,
      "diagnostics": [
        {
          "code": "CONTENT_TYPE_MISMATCH",
          "part": "products",
          "expected": "application/json",
          "actual": "text/plain"
        },
        {
          "code": "CONTENT_TYPE_MISMATCH",
          "part": "products",
          "expected": "application/json",
          "actual": "text/plain"
        }
      ]
    }
  ]
}
```

To read the saved report without running the generator again:

```powershell
node dist/cli.js report --format json --file work/hey-api-regression.json
```

The committed [`Hey API 0.99.0 report`](../examples/reports/hey-api-0.99.0-regression.json) contains the captured result. WireConform omits bodies, filenames, credentials, and header values, while retaining operation and fixture identifiers and expected/captured media-type essences.
