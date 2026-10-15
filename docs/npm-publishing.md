# npm distribution and release procedure

WireConform is prepared for npm distribution, but this document does not mean the package has been published. The registry returned `404` for `wireconform` on 2026-10-15, and the release machine had no authenticated npm account. A 404 is only a point-in-time registry observation: it does not reserve the name or prove that a publisher account can claim it. Confirm both again immediately before the first publish.

## Package shape

The package is unscoped and will be public. Its `repository.url` is `git+https://github.com/eeerdsahum/wireconform.git`, its executable is `wireconform`, its library entry points are under `dist/`, and its Node.js engine floor is 22.18.0.

Runtime dependencies are `axios`, `tsx`, and `yaml`. The Hey API and TypeScript toolchain, OpenAPI Generator JAR, ESLint, and TypeScript development tooling are not runtime dependencies. `@hey-api/openapi-ts@0.99.0` is an optional peer; consumers must install and configure it to use that adapter. Installing WireConform alone does not install the vulnerable generator tree. The package's `files` allowlist includes compiled output, documentation, examples, fixtures, and the OpenAPI sample; it excludes tests, scripts, CI configuration, source files, and local reports outside the examples directory.

`npm run package:check` validates the package manifest and packed file list. `npm run package:smoke` packs and installs the CLI in a temporary external project, checks the executable, validates an OpenAPI document, lists the adapter, runs a passing upload and confirms that the regression exits `1` with two `CONTENT_TYPE_MISMATCH` diagnostics. CI runs this on Ubuntu and Windows. The workflow does not cover macOS.

## First npm beta publication

Before starting, verify the name and account live:

```sh
npm view wireconform name version dist-tags --json
npm whoami
```

The first command returning 404 means there is no visible public package record at that time; it does not establish claimability. The second must report the intended publisher account. Unscoped npm packages are public. npm requires account 2FA for direct interactive publishing; alternatively it documents a granular access token with 2FA bypass, which this project avoids. Do not create or store a long-lived publishing token for CI.

Prepare a new GitHub prerelease tag whose checked-in manifest, lockfile, CLI version, changelog, documentation, and source all agree. Do not reuse an npm version if the registry already has it, and do not retag the existing beta.2 source commit to change its contents. The publish workflow only accepts annotated `v0.1.0-beta.N` tags with a published GitHub prerelease and matching source metadata.

For the first npm package, publish interactively from a clean checkout of that exact, CI-verified tag after reviewing `npm pack --dry-run` and the external package smoke test. Configure Java 11 or newer and point `WIRECONFORM_OPENAPI_GENERATOR_JAR` at the verified OpenAPI Generator CLI 7.26.0 JAR before running the full suite; otherwise its two integration cases are skipped and are not verified:

```sh
npm ci
npm run test:full
npm pack --dry-run
npm publish --tag beta
```

Use the exact newly approved package version for that tag. The beta dist-tag makes `npm install wireconform@beta` resolve the prerelease without moving the default `latest` tag. Never publish from a working tree with local edits.

## Configure Trusted Publishing

Trusted Publishing uses short-lived npm credentials obtained through GitHub Actions OIDC; it avoids storing a write token in repository secrets. Configure it only after the first package exists:

1. In npm package settings for `wireconform`, add a GitHub Actions trusted publisher with owner `eeerdsahum`, repository `wireconform`, workflow filename `npm-publish.yml`, and environment `npm-publish`.
2. Allow direct `npm publish` for this publisher. The workflow supplies `--tag beta`; it does not need permission to modify dist-tags separately.
3. In GitHub repository settings, create the `npm-publish` environment, require approval from a maintainer, prevent self-review, restrict deployments to `main`, and disallow bypassing protection rules. The YAML reference alone does not enforce approval; an administrator must configure these environment rules before the workflow is enabled. Also protect `v*` release tags with a tag ruleset that restricts creation and prevents updates or deletion. GitHub documents these protections for public repositories across its current plans, so this does not require an upgrade. Do not add publishing secrets.
4. Prepare and verify the next tagged prerelease before configuring the publisher. Then run the workflow within two days of creating the npm trust configuration; npm expires a new publisher configuration if its first successful publish does not validate it in that window.
5. In the Actions UI, run **npm beta publish** from `main`, supply the annotated release tag, and type the exact `PUBLISH wireconform@<version>` confirmation. A required environment reviewer must approve before the publish job receives its OIDC permission.
6. After the first successful OIDC publish, set package publishing access to **Require two-factor authentication and disallow tokens** and revoke any obsolete publish tokens. OIDC publishing continues to work with token publishing disabled.

The workflow is dispatch-only. It refuses dispatches outside `main`, requires exact typed confirmation and environment approval, verifies that the GitHub release is a prerelease and its annotated tag still matches the remote and is on current `main`, checks the source metadata, rejects an already-published npm version, records the existing `latest` dist-tag, runs the full suite, packs and inspects the release tarball, installs and exercises that exact tarball in an external project, rechecks the release and tag, then publishes that tarball with the `beta` tag and verifies the registry version, beta dist-tag, and unchanged `latest` dist-tag. It grants `contents: read` and `id-token: write` only to the publishing job. It has no push, pull-request, or release trigger.

GitHub Actions Trusted Publishing requires Node.js 22.14.0 or newer and npm CLI 11.5.1 or newer; the release job uses Node.js 24 and checks the installed versions. GitHub-hosted runners are supported by npm's OIDC publisher; self-hosted runners are not. On a public GitHub repository publishing a public package through GitHub OIDC, npm automatically adds provenance attestations.

## Staged publishing alternative

npm also offers staged publication with an explicit npm-side review and 2FA approval. For a package name not yet present, staging makes a public `0.0.0-stage` placeholder while the staged package contents remain private until approval. The current local npm CLI observed during preparation was 11.12.1; staged publishing requires npm CLI 11.15.0 or newer and Node.js 22.14.0 or newer. This project uses the simpler interactive first beta followed by protected OIDC publishing plan above; staged publishing is an alternative if maintainers specifically want a separate npm approval for every release.

## Installation and safety

After the first beta is published:

```sh
npm install --save-dev wireconform@beta
npx wireconform adapters
npx wireconform validate ./openapi.yaml
npx wireconform run node_modules/wireconform/examples/hey-api-positive.yaml --adapter hey-api
```

The last command requires the optional Hey API adapter and its documented compiler and `js-yaml` override. OpenAPI Generator additionally requires Java 11+ and the verified CLI JAR. The generated SDK code runs with the current user's permissions and is not sandboxed. Only run trusted specifications and fixtures. Reports omit request bodies and credentials by default, but retain identifiers and expected/captured media-type essences; review them before sharing.

The exact supported generator versions, Node.js floor, OpenAPI subset, and security limitations are documented in the [README](../README.md), [conformance guide](conformance.md), and [SECURITY.md](../SECURITY.md).
