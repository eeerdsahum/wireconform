# npm distribution status

WireConform `0.1.0-beta.2` is publicly available at [npm](https://www.npmjs.com/package/wireconform). It was packaged from the verified `v0.1.0-beta.2` source tag at commit `e249cd4cc8ab2f0eda3682862bcf10f4c86fec99`. The published tarball SHA-256 is `C71E8F3E13A7749A937BE4DA2587B5358B2CE205C10E31A7475239EC4C7E942B`.

## Current registry state

The live public registry metadata was checked on 2026-10-15. It reports:

```text
version: 0.1.0-beta.2
beta:    0.1.0-beta.2
latest:  0.1.0-beta.2
```

Use `npm install wireconform@beta` to name the prerelease explicitly. An unqualified `npm install wireconform` currently resolves the same prerelease through `latest`; `latest` is intended for a stable release.

The registry also lists a tiny public `0.0.0-stage` placeholder created at 2026-10-15 07:12:25 UTC. npm documents that [staging a previously nonexistent package creates this placeholder](https://docs.npmjs.com/staged-publishing/). This confirms a staged-publication bootstrap occurred. The placeholder existed about 56 seconds before beta.2 was recorded, which makes first-live-version initialization during the bootstrap/promotion the strongest current hypothesis for why beta.2 also became `latest`. That is an inference: the public metadata and retained logs do not reveal which write assigned `latest`.

The beta.2 package manifest sets `publishConfig.tag` to `beta`, and the first publication was requested with `--tag beta`. npm's [publish documentation](https://docs.npmjs.com/adding-dist-tags-to-packages/) says that `--tag` selects the tag for a publish. The observed public tags therefore do not match the intended outcome. An attempt to remove `latest` with `npm dist-tag rm wireconform latest` returned HTTP 400 with npm CLI 11.12.1 and 12.2.0. The exact registry error body was not retained in the local logs, and the public package metadata does not expose the write request's validation reason. npm's [`dist-tag` documentation](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/) describes removing tags generally, but does not document a special restriction on removing `latest`.

No further publication, tag mutation, unpublish, or deprecation is planned while the cause is unresolved. Keep beta.2 available and install it with the explicit `@beta` tag. For current behavior and future changes, check the registry directly:

```sh
npm view wireconform version
npm view wireconform dist-tags --json
npm install wireconform@beta
```

The npm-hosted README is part of the immutable beta.2 tarball and still includes a pre-publication statement that WireConform was not on npm. The current GitHub README has the corrected installation guidance. Fixing the package-hosted README requires a new package version; do not republish or reuse beta.2.

## Safest resolution

For now, leave both tags as they are. Removing `latest` without understanding the registry's HTTP 400 could leave unqualified installs without a usable default, and pointing it to `0.0.0-stage` would direct users to a placeholder. Do not unpublish beta.2, overwrite it, or create a stable version solely to repair the alias.

The next step is to ask npm support to explain the 400 response and the first-live-version tag behavior, providing the package name, command, npm CLI versions, approximate UTC timestamps, and current public metadata. Do not include credentials or one-time codes. After npm clarifies a supported safe operation, a maintainer can decide whether to remove or change `latest`. A separately approved stable release can naturally establish `latest` later, but it is not a repair to perform without a product release decision.

## Package and runtime

- Package: [`wireconform`](https://www.npmjs.com/package/wireconform)
- Published version: `0.1.0-beta.2`
- Source: [GitHub release `v0.1.0-beta.2`](https://github.com/eeerdsahum/wireconform/releases/tag/v0.1.0-beta.2)
- Node.js: `>=22.18.0`; use a supported current npm CLI.
- CLI executable: `wireconform`
- Runtime dependencies: `axios`, `tsx`, and `yaml`.
- Generator adapters: Hey API `@hey-api/openapi-ts@0.99.0` and OpenAPI Generator CLI `7.26.0`.
- The Hey API adapter requires a compatible TypeScript compiler and the documented `js-yaml` override. OpenAPI Generator requires Java 11+ and its verified CLI JAR.

The npm package installs the WireConform CLI and runtime libraries. Generator toolchains are not bundled as runtime dependencies. The generated SDK runs with the invoking user's permissions and is not sandboxed; only run trusted OpenAPI documents, fixtures, and generator inputs.

## Verified installation

A clean external project installed `wireconform@beta` from the public npm registry and resolved exactly `0.1.0-beta.2`. Verification confirmed:

- `npx wireconform@beta adapters` lists Hey API 0.99.0 and OpenAPI Generator 7.26.0.
- `npx wireconform@beta validate node_modules/wireconform/examples/positive-openapi.yaml` validates the bundled OpenAPI document.
- The Hey API positive fixture exits `0` and captures three multipart parts.
- The known Hey API 0.99.0 regression exits `1` and reports two `CONTENT_TYPE_MISMATCH` diagnostics.
- Malformed YAML and missing-file diagnostics omit the tested source snippet and local path sentinels.
- `npm audit --audit-level=low` reported no vulnerabilities in that clean test project.

These are local clean-install checks against the published tarball, not a claim that the unresolved dist-tag behavior is fixed.

## Trusted Publishing and GitHub controls

npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) is configured for repository `eeerdsahum/wireconform`, workflow file `npm-publish.yml`, and GitHub environment `npm-publish`. The workflow is manual-dispatch only, checks the verified annotated release tag and source version, runs the full tests and package smoke check, then publishes the exact tarball with `--tag beta`. It uses GitHub OIDC rather than a stored npm publish token and grants `id-token: write` only to the publish job.

The environment requires approval by the repository's sole maintainer. Self-review is allowed because the same maintainer is currently the only reviewer; approval is therefore usable but not independent. Deployments are limited to protected `main`, and administrators cannot bypass environment protection. A repository ruleset prevents updates and deletion of `v*` tags.

The Trusted Publisher configuration was read back from npm and matched the repository, workflow, environment, and permissions for direct publish and stage publish. The workflow only uses direct publish; npm does not currently grant this configuration a dist-tag-management permission. The configuration has not been validated by a successful OIDC publication; npm requires an actual publish to complete that end-to-end validation. Do not publish an extra version just to test it. The first legitimate, separately authorized future package release can validate the workflow. Current npm Trusted Publishing documentation also requires recent npm CLI versions and supports GitHub-hosted runners, not self-hosted runners.

The npm workflow has no `push`, pull-request, or release event trigger. It does not publish automatically when merged. All nine required GitHub CI jobs passed on the merged distribution workflow commit `0a75c250b5d0bbca8b821c4bb2e5932b21d83ab1`.

## Security and report privacy

The beta.1 release had a diagnostic privacy defect: malformed YAML input snippets and some local filesystem paths could appear in CLI and JSON diagnostics. No actual credential exposure was confirmed. The fix is included in beta.2. Do not share raw beta.1 logs that may include sensitive data.

WireConform binds its capture server to loopback and omits request bodies, filenames, credentials, and header values from reports by default. Reports still include some user-provided identifiers and media-type values. Generated SDK code is not sandboxed and can access files, processes, and networks available to the invoking user. Use trusted inputs and review reports before sharing.

See the [README](../README.md), [conformance limitations](conformance.md), and [security policy](../SECURITY.md) for the supported OpenAPI subset and remaining limits.

## Future publication procedure

Do not reuse a published version. For any separately authorized beta release:

1. Create a new package version on a protected, CI-verified annotated release tag that points to the intended `main` commit.
2. Confirm the matching GitHub prerelease and ensure the npm version is unused.
3. Dispatch **npm beta publish** from `main`, enter the exact tag, and provide the typed `PUBLISH wireconform@<version>` confirmation.
4. Approve the protected `npm-publish` deployment.
5. Verify the published version and all dist-tags with `npm view` and `npm dist-tag ls`.
6. Verify the public tarball installation and the hosted workflow result.

The first successful OIDC release remains unverified. Do not create a version solely to validate Trusted Publishing, and do not publish unless a maintainer explicitly approves that release.
