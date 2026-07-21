# Security Policy

Oyster is a remote interface to a coding agent and can expose capabilities comparable to shell access. Security reports are taken seriously.

## Supported versions

Security fixes are made on the current default branch. Until the project publishes a stable release and a longer support policy, older commits, forks, and locally modified deployments are not guaranteed to receive fixes.

## Reporting a vulnerability

**Do not open a public issue or discussion for a suspected vulnerability.**

Use GitHub's **Security → Report a vulnerability** flow for this repository. If private vulnerability reporting is unavailable, ask a maintainer for a private contact channel without including sensitive details in the public request.

Include, when possible:

- the affected commit, version, and deployment mode;
- the security boundary that can be crossed;
- minimal reproduction steps or a proof of concept;
- the expected and observed behavior;
- the likely impact and any known mitigations.

Never include live UI tokens, provider credentials, OAuth codes, private transcripts, or other third-party secrets. Use clearly synthetic test data.

The project aims to acknowledge a complete report within seven days and provide an initial assessment within fourteen days. These are best-effort targets, not a guarantee. Please allow time for a fix and coordinated disclosure before publishing details.

## Scope

Reports about Oyster's server, browser client, bundled pi extensions, container configuration, authentication boundaries, credential handling, file access, routines, or hublots are in scope. Vulnerabilities in pi, cloudflared, Node.js, browsers, model providers, or other dependencies should also be reported to their upstream maintainers; report them here as well only when Oyster introduces or worsens the impact.

For secure deployment guidance, including the mandatory TLS boundary for remote access, read [`docs/getting-started/security.md`](docs/getting-started/security.md).
