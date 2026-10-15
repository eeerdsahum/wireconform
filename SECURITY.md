# Security policy

## Supported versions

During beta, security fixes target the latest published beta. Older beta versions are not maintained. After a stable release, fixes target the latest stable version.

## Reporting a vulnerability

Use the [GitHub Security Advisories page](https://github.com/eeerdsahum/wireconform/security/advisories) to report vulnerabilities privately with the **Report a vulnerability** form. Private vulnerability reporting is enabled for this repository. Do not file public issues containing exploit details, request bodies, credentials, or private fixture data. If the private form is unavailable, open an issue asking for a private contact method without including sensitive details.

The published [v0.1.0-beta.1](https://github.com/eeerdsahum/wireconform/releases/tag/v0.1.0-beta.1) has a diagnostic privacy issue: malformed YAML may echo an untrusted source excerpt, and some filesystem errors may include local paths in CLI and JSON diagnostics. No actual credential exposure has been confirmed. Do not share raw beta.1 logs that may contain sensitive data. The fix is included in [v0.1.0-beta.2](https://github.com/eeerdsahum/wireconform/releases/tag/v0.1.0-beta.2); upgrade to beta.2 and keep previously recorded beta.1 logs private.

WireConform starts a loopback-only HTTP server and executes generated SDK code in a child process. Its worker checks common HTTP, HTTPS, fetch, and TCP entry points against the capture origin, but this is not a sandbox and generated code could bypass the check through other APIs, native modules, or child processes. Use trusted OpenAPI documents and fixtures. Do not run generated clients from untrusted specifications with access to sensitive files or credentials.

In beta.2, CLI diagnostics use stable messages based on error codes, omit YAML parser text and absolute paths, and expose only validated YAML line and column numbers. Unknown exceptions use a generic diagnostic. Reports omit request bodies, filenames, credential fields, and header values by default. They retain operation IDs, path templates, specification basenames, fixture case names, part names, status/counts, and expected/captured media-type essences. These identifiers are copied from user inputs, so do not put secrets in them; review reports before sharing.
