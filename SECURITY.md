# Security policy

## Supported versions

Security fixes target the latest released WireConform version. This repository has not published a release yet.

## Reporting a vulnerability

Please do not file public issues containing exploit details, request bodies, credentials, or private fixture data. After the repository has a canonical public GitHub URL, a repository owner or administrator must enable GitHub private vulnerability reporting before publishing the beta. In the repository, open **Settings → Security and quality → Advanced Security → Private vulnerability reporting → Enable**, then confirm that **Report a vulnerability** appears on the repository's Advisories page. Configure repository notifications so maintainers receive security alerts.

Until the private reporting form is enabled, do not send sensitive details through public issues. Use a private contact channel already known to you, and include only the minimum information needed to reproduce the issue. If no private channel is available, ask for a security contact without including exploit details.

WireConform starts a loopback-only HTTP server and executes generated SDK code. Its worker checks common HTTP, HTTPS, fetch, and TCP entry points against the capture origin, but this is not a sandbox and generated code could bypass the check through other APIs, native modules, or child processes. Use trusted OpenAPI documents and fixtures. Do not run generated clients from untrusted specifications with access to sensitive files or credentials. Reports omit request bodies, filenames, and header values by default.
