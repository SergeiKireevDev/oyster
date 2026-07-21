# Contributing to Oyster

Thank you for helping improve Oyster. Contributions of code, tests, documentation, and reproducible bug reports are welcome.

## Before you start

- Read the [architecture guide](docs/development/architecture.md) before changing lifecycle or persistence code.
- Read the [security guide](docs/getting-started/security.md) before changing authentication, credentials, file access, or remote exposure.
- Report suspected vulnerabilities privately according to [SECURITY.md](SECURITY.md), not in a public issue.
- Search existing issues and pull requests before opening a duplicate.

For a substantial behavioral change, open an issue first so scope and design can be discussed before implementation.

## Development setup

Oyster requires Node.js 22.19 or newer.

```bash
git submodule update --init --recursive
npm ci
npm ci --prefix pi --ignore-scripts
npm run build:pi
npm test
npm run build
```

The full test suite uses the bundled pi submodule for its SQLite contract. If that build is not available, run the portable suite with:

```bash
PI_SQLITE_CONTRACT_TEST=skip npm test
```

Mention this skip in the pull request. Changes to SQLite session integration should be validated against the full local contract before merge.

See the [installation guide](docs/getting-started/installation.md) for runtime setup and the detailed [development contribution guide](docs/development/contributing.md) for hot-reload and documentation guidance.

## Making changes

1. Keep each pull request focused on one coherent change.
2. Add or update tests for changed behavior.
3. Update user, operator, API, or architecture documentation as needed.
4. Preserve the security boundaries documented in the security guide.
5. Do not commit credentials, tokens, databases, generated builds, test artifacts, or `node_modules`.

The server and frontend can hot-reload while they are running. Make complete, atomic edits to hot-reloaded files so connected clients are not exposed to an intermediate broken state.

## Validation

Before requesting review, run:

```bash
npm test
npm run build
npm run docs:build
```

The CI workflow runs the portable tests, production frontend build, and documentation build on every pull request. Browser-facing behavior may also require the Playwright suite described in [`tests/e2e/README.md`](tests/e2e/README.md).

## Pull requests

A pull request should include:

- the problem and the chosen solution;
- user-visible, operational, persistence, and security effects;
- tests and documentation added or changed;
- validation commands run, including any skipped contract or end-to-end tests;
- screenshots or recordings for meaningful UI changes.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE) and that you have the right to submit it.
