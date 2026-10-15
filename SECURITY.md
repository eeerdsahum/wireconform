# Security policy

## Supported versions

During beta, security fixes target the latest published beta. Older beta versions are not maintained. After a stable release, fixes target the latest stable version.

## Reporting a vulnerability

Use the [GitHub Security Advisories page](https://github.com/eeerdsahum/wireconform/security/advisories) to report vulnerabilities privately with the **Report a vulnerability** form. Private vulnerability reporting is enabled for this repository. Do not file public issues containing exploit details, request bodies, credentials, or private fixture data. If the private form is unavailable, open an issue asking for a private contact method without including sensitive details.

The published v0.1.0-beta.1 has a diagnostic privacy issue: malformed YAML may echo a source excerpt, and some filesystem errors may include local paths. Avoid running beta.1 on private inputs where terminal or CI output is shared. A fix is being prepared for beta.2; until then, use trusted, non-sensitive input and keep logs private.

WireConform starts a loopback-only HTTP server and executes generated SDK code in a child process. Its worker checks common HTTP, HTTPS, fetch, and TCP entry points against the capture origin, but this is not a sandbox and generated code could bypass the check through other APIs, native modules, or child processes. Use trusted OpenAPI documents and fixtures. Do not run generated clients from untrusted specifications with access to sensitive files or credentials.

The diagnostic fix prepared for beta.2 uses stable messages based on error codes, omits YAML parser text and absolute paths, and exposes only validated YAML line and column numbers. Unknown exceptions use a generic diagnostic. Reports omit request bodies, filenames, credential fields, and header values by default. They retain operation IDs, path templates, specification basenames, fixture case names, part names, status/counts, and expected/captured media-type essences. These identifiers are copied from user inputs, so do not put secrets in them; review reports before sharing.
