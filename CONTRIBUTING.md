# Contributing

Thanks for helping improve WireConform. Keep changes focused on accurate multipart behavior and preserve the POC regression cases.

## Setup

Use Node.js 22.18 or newer.

```powershell
npm ci
npm run build
npm run lint
npm run typecheck
npm test
```

The OpenAPI Generator integration tests run when `WIRECONFORM_OPENAPI_GENERATOR_JAR` points to the official pinned 7.26.0 JAR and `JAVA_HOME` points to Java 11 or newer. `npm run test:hey-api-next` exercises the separately pinned Hey API prerelease and reports its observed conformance result.

## Changes to conformance behavior

For each expectation, cite the applicable OpenAPI or RFC version in documentation and add a focused regression case. Keep OpenAPI 3.0 and 3.1 expectations distinct. Add tests for the relevant invalid or boundary input. Integration tests must assert the CLI exit code as well as the report result.

Do not add generator shell commands supplied by fixture authors. A new adapter must have a fixed executable or verified artifact, a pinned version, an explicit setup check, and a documented execution model. Do not print request bodies, credentials, or fixture header values.

Before submitting, review the complete diff and run `npm run test:full` when practical. Do not publish a package or push a branch as part of a contribution without explicit authorization.
