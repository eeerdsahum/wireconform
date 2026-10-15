# Changelog

## 0.1.0-beta.2 — 2026-10-15

- Replaced parser text, absolute local paths, and arbitrary exception messages in CLI diagnostics with stable messages based on diagnostic codes; malformed YAML reports validated line and column numbers only.
- Normalized OpenAPI, fixture, report, adapter, and cleanup failures so terminal and JSON errors do not expose filesystem paths or exception details.
- Added sentinel regression coverage for malformed YAML and JSON, missing input/report paths, adapter setup output, nested exceptions, and both text and JSON modes.
- Carries forward the merged CI generator-artifact sharing reliability fix from main.
- Documented the beta.1 diagnostic privacy issue and the identifiers retained in reports.

## 0.1.0-beta.1 — 2026-10-13

WireConform began as PartProbe, a proof of concept that reproduced a multipart Content-Type mismatch with `@hey-api/openapi-ts@0.99.0`. This beta preserves that regression case and turns the reproducer into a reusable CLI.

- Added OpenAPI 3.0 and 3.1 version-aware multipart expectations, local reference loading, fixture files, request capture, standards-aware comparison, and JSON reports.
- Added real Hey API 0.99.0 and OpenAPI Generator 7.26.0 adapters with pinned versions and verified generator artifact integrity.
- Added a separately pinned newer Hey API prerelease check without treating its output as a compatibility guarantee.
- Added positive, negative, regression, security, and package integration coverage, plus installation, contribution, conformance, and security documentation.
- Reports omit request bodies, filenames, credentials, and header values by default; the capture listener binds only to loopback.
