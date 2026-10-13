# Security policy

## Supported versions

During beta, security fixes target the latest published beta. Older beta versions are not maintained. After a stable release, fixes target the latest stable version.

## Reporting a vulnerability

Use the [GitHub Security Advisories page](https://github.com/eeerdsahum/wireconform/security/advisories) to report vulnerabilities privately with the **Report a vulnerability** form. Private vulnerability reporting is enabled for this repository. Do not file public issues containing exploit details, request bodies, credentials, or private fixture data. If the private form is unavailable, open an issue asking for a private contact method without including sensitive details.

WireConform starts a loopback-only HTTP server and executes generated SDK code. Its worker checks common HTTP, HTTPS, fetch, and TCP entry points against the capture origin, but this is not a sandbox and generated code could bypass the check through other APIs, native modules, or child processes. Use trusted OpenAPI documents and fixtures. Do not run generated clients from untrusted specifications with access to sensitive files or credentials. Reports omit request bodies, filenames, and header values by default.
