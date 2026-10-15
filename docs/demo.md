# Reproducible multipart demo

This walkthrough uses committed OpenAPI documents and fixtures with the pinned Hey API 0.99.0 adapter. The positive case demonstrates binary and text parts. The regression case sends an array of JSON objects and reproduces a Content-Type mismatch. Run both from the repository root.

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
