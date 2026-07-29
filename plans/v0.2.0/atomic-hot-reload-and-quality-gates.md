# Atomic Hot Reload and Quality Gates

## Goal

Make development hot reload transactional and establish automated quality gates
for the server's highest-risk boundaries. A failed reload must leave the old
application and all of its dependencies fully operational; CI must detect
lifecycle, security, architecture, dependency, and coverage regressions before
deployment.

## Guardrails

- Production deployment remains a clean process restart. Hot reload is a
  development/recovery aid, not a zero-downtime release mechanism.
- Stable state and OS resources survive reload only through explicit stable-core
  ownership.
- Constructing a candidate application must not close or overwrite resources
  used by the active application.
- Activation, swap, and retirement order must be explicit and tested.
- Do not add quality tools as advisory noise. Each tool has a pinned config,
  justified baseline, owner, and required CI result.
- Suppressions are narrow and documented; generated code, vendored submodules,
  fixtures, and plans are excluded intentionally rather than through broad
  repository ignores.
- Raise coverage thresholds by risk domain, not by padding low-value lines.

## 1. Specify the Reload Lifecycle

- [ ] Inventory every mutation performed by `app.mjs:init()`: catalog
  replacement, timer replacement, runner manager creation, state patching,
  reconciler flags, supervisor scheduling, event subscriptions, and service
  closure.
- [ ] Classify each dependency as stable, candidate-owned, shared immutable, or
  restart-required. Add the classification to the stable-state inventory tests.
- [ ] Define a candidate interface with side-effect-free construction plus
  explicit `activate()`, `handleRequest()`, and idempotent `dispose()` phases.
- [ ] Define failure semantics for import, construction, activation, swap, old
  disposal, and requests already executing during the swap.

**Acceptance:** the lifecycle specification identifies one owner and cleanup
path for every timer, listener, catalog handle, and process-facing service.

## 2. Build Candidate Applications Transactionally

- [ ] Refactor `init()` so candidate construction does not mutate active stable
  fields or close active dependencies. Stage candidate-owned resources in a
  disposable scope.
- [ ] Validate route uniqueness, repository availability, catalog access, and
  dependency construction before activation.
- [ ] Activate the candidate, atomically swap the request handler, then retire
  the old application. If pre-swap work fails, dispose only the candidate.
- [ ] If old disposal fails after swap, keep the new application active, report
  the leak through authenticated diagnostics, and retry bounded cleanup without
  rolling back to partially retired state.
- [ ] Attach a generation to timers/listeners so stale callbacks cannot mutate
  candidate-owned state after disposal.

**Acceptance:** injected failures at every phase leave exactly one usable
handler and no duplicated timers, listeners, or catalog handles.

## 3. Make Reload Coverage Explicit

- [ ] Define a manifest or dependency graph of reloadable modules. Watch every
  reloadable server module and route, including runners, tunnels, routines,
  checkpoints, sessions, and persistence adapters that are safe to replace.
- [ ] Classify stable-core files whose edits require a process restart. Emit a
  clear `restart_required` event instead of pretending they hot-reloaded.
- [ ] Ensure cache-busting reaches the changed dependency graph and cannot mix
  old and new module generations in one candidate.
- [ ] Debounce atomic editor renames and multi-file saves into one candidate
  build. Retry only after a new filesystem change, not in a tight failure loop.
- [ ] Extend hot-reload tests to modify each module class, introduce syntax and
  activation failures, and verify active runners/SSE clients remain coherent.

**Acceptance:** every server source change either transactionally reloads or is
explicitly reported as restart-required.

## 4. Establish Lint, Type, and Architecture Checks

- [ ] Add ESLint flat configuration with `@eslint/js`, `eslint-plugin-n`,
  `eslint-plugin-security`, `eslint-plugin-promise`, and
  `eslint-plugin-sonarjs`. Add Svelte-specific linting for UI modules.
- [ ] Enable `tsc --allowJs --checkJs --noEmit` incrementally with JSDoc types at
  route, repository, process lifecycle, and session-reference boundaries.
  Maintain a checked baseline file list; do not use repository-wide
  `@ts-nocheck`.
- [ ] Add dependency-cruiser rules enforcing stable-core, reloadable app,
  routes, persistence, server-domain, and browser feature boundaries.
- [ ] Add Knip for unused files, exports, and dependencies, with explicit entry
  points for CLI scripts, tests, extensions, workers, and generated assets.
- [ ] Add ShellCheck for checked-in shell scripts and representative generated
  script fixtures.

**Acceptance:** the tools run locally through documented npm scripts and are
required in CI with no unexplained baseline violations.

## 5. Add Security and Dependency Gates

- [ ] Add Semgrep Community Edition with maintained Node/security rules and
  custom rules for source-IP auth bypasses, unverified PID signaling, ad hoc
  TERM/KILL timers, unbounded SSE writes, and synchronous filesystem calls in
  request handlers.
- [ ] Add OSV-Scanner alongside `npm audit`, scanning both Oyster and pi
  lockfiles while keeping submodule ownership explicit.
- [ ] Add Gitleaks for commits, fixtures, generated reports, Docker contexts,
  and backup files. Seed canary fixtures to prove detection without real
  credentials.
- [ ] Triage the `@huggingface/transformers`/`sharp` and
  `onnxruntime-node`/`tar` advisories. Upgrade where compatible and separate
  browser build/runtime dependencies from the minimal server production
  package so unused browser tooling is not deployed as server attack surface.
- [ ] Configure Renovate for bounded, grouped updates with required unit/build
  checks and visible security advisories.

**Acceptance:** known vulnerabilities have an upgrade, isolation, or dated risk
acceptance; secret and static security scans are required checks.

## 6. Make Coverage Risk-Based

- [ ] Standardize coverage on c8 and publish text, LCOV, and machine-readable
  summaries without committing generated reports.
- [ ] Set initial per-domain thresholds for authentication, path confinement,
  process lifecycle, migrations, uploads, SSE, and route dispatch. Ratchet
  thresholds upward; do not lower them to merge a change.
- [ ] Add branch/failure-path tests for the previously low-covered tunnel,
  checkpoint, routine, runner, and HTTP route modules.
- [ ] Add StrykerJS mutation testing for token checks, process identity,
  termination escalation, path validation, migration rejection, worktree locks,
  and recovery stage decisions. Run a focused mutation set in PR CI and the
  broader set on a schedule.
- [ ] Keep e2e coverage focused on user contracts; do not substitute slow
  browser scenarios for deterministic server failure-path tests.

**Acceptance:** critical boundaries meet explicit branch thresholds and survive
focused mutation testing.

## 7. Add Performance and Resilience Gates

- [ ] Add autocannon diagnostics for health/auth, browse/search, upload, and
  reconnect workloads; store budgets and comparison output as CI artifacts.
- [ ] Use `monitorEventLoopDelay()` in deterministic tests and Clinic.js for
  investigation of synchronous JSONL/filesystem hotspots.
- [ ] Use Toxiproxy or deterministic fault adapters for slow clients, partial
  uploads, tunnel disconnects, OAuth delays, and failed process shutdown.
- [ ] Add resource-leak tests covering file descriptors, timers, listeners,
  child processes, SSE clients, workers, and SQLite handles across repeated
  reload/restart cycles.

**Acceptance:** repeated failure and reload scenarios remain within documented
resource and responsiveness budgets.

## 8. Integrate the Required CI Pipeline

- [ ] Provide fast PR jobs for formatting/lint, type checks, architecture, unit
  tests, focused coverage, Semgrep, Gitleaks, OSV/npm audit, build, and
  representative browser tests.
- [ ] Provide scheduled jobs for full e2e, mutation testing, dependency scans,
  Docker/llmbox cluster tests, and performance diagnostics.
- [ ] Pin tool/action versions, cache only reproducible artifacts, and upload
  diagnostics on failure without tokens, auth stores, session databases, or
  workspace files.
- [ ] Document local equivalents for every required check and the process for a
  narrow, expiring suppression.

## Completion criteria

- Failed reloads cannot partially replace active dependencies or duplicate
  lifecycle resources.
- Every server file is either transactionally reloadable or explicitly
  restart-required.
- Lint, type, architecture, security, dependency, secret, test, coverage, and
  build checks are required and reproducible locally.
- High-risk server boundaries have meaningful failure-path and mutation
  coverage.
- Production dependencies and advisories accurately reflect what the server
  actually deploys.
