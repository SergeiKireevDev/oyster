# Oyster v0.2.0 Implementation Roadmap

## Purpose

Turn the remaining July 2026 server-audit findings into ordered, standalone
Markdown checklists. Each linked plan can be supplied directly as a checklist
plan argument, with `plans/v0.2.0/validate.sh` as its executable validator. The
executor advances one unchecked item at a time only after validation succeeds.

The critical loopback authentication bypass and generated-token persistence
issue were already fixed by `be924248` (**Require explicit authentication for
local tools**) and are not repeated here.

`validate.sh` runs `npm test`. Phase acceptance statements may require broader
build, Docker, browser, llmbox, security, or performance checks in addition to
the per-iteration validator.

## Plan status and order

- [x] Convert the v0.2.0 roadmap to loop-compatible checklists with a shared
  executable validator.
- [ ] Complete [Safe process lifecycle](safe-process-lifecycle.md): awaited
  termination, effective SIGKILL escalation, PID identity checks, and
  generation-safe runner replacement.
- [ ] Complete [Harden HTTP boundaries](harden-http-boundaries.md): trusted proxy
  policy, bounded authentication throttling, minimal public health, and
  authenticated diagnostics.
- [ ] Complete [Reliable file and stream I/O](reliable-file-and-stream-io.md):
  SSE backpressure, isolated resumable uploads, mode-preserving saves, and
  bounded event-loop delay.
- [ ] Complete [Storage configuration and schema safety](storage-configuration-and-schema-safety.md):
  one session-root contract, private database files, downgrade rejection, and
  operational integrity checks.
- [ ] Complete [Atomic hot reload and quality gates](atomic-hot-reload-and-quality-gates.md):
  transactional reload lifecycle, complete reload coverage, and required
  lint/type/security/coverage automation.
- [ ] Reconcile the already-landed [Pinned Widgets](pinned-widgets.md)
  implementation against its checklist, checking only items supported by code
  and test evidence and leaving genuine gaps for later loop iterations.

Run plans in this order unless a plan explicitly identifies a prerequisite that
has already landed. Each linked document is a standalone plan argument; this
index is only a status overview.

## Checklist rules

- [x] Keep every implementation item as a Markdown task (`- [ ]` or `- [x]`).
- [x] Keep checklist order dependency-safe; the first unchecked item is always
  the next permitted unit of work.
- [x] Require focused tests in the same iteration as behavior changes.
- [x] Let only the checklist executor mark an implementation item complete after
  the validator exits successfully.
- [x] Preserve unrelated work and keep one item small enough for one reviewed
  commit.
- [x] Treat acceptance and completion criteria as phase gates, not substitutes
  for executable tests.

## Cross-cutting guardrails

- Preserve the stable-core rule: durable repositories and long-lived OS handles
  belong to `server/server.mjs` state, not cache-busted module globals.
- Preserve backend-neutral session identity as
  `{ backend, id, storagePath }`; never narrow identity to a bare ID or database
  path.
- Treat a PID as an untrusted locator and verify recorded process identity
  immediately before every signal.
- Make every multi-store workflow atomic, serialized, or durably recoverable. A
  journal without a reconciler is not a completed reliability boundary.
- Bound memory, queue depth, request size, operation count, and shutdown time.
- Keep secrets, credentials, request bodies, and internal filesystem inventory
  out of logs and public diagnostics.

## Validation ladder

Per iteration, the shared executable runs:

```sh
npm test
```

At each phase boundary, run the checks named by that plan. Before declaring a
plan complete, run freshly built artifacts through the broad matrix:

```sh
npm run build
npm test
docker build -t oyster:quality-v0.2 .
./scripts/run-e2e-tests.sh
```

Plans touching llmbox must also run its checks and cluster suite. Performance
items must record event-loop delay, memory, and queue-depth diagnostics; normal
CI assertions should use deterministic resource bounds rather than fragile wall
clock thresholds.

## Release completion criteria

- Every remaining audit finding maps to a checked plan item or a documented,
  evidence-based rejection.
- Runner and hublot replacement cannot overlap an unconfirmed old process.
- Public unauthenticated responses reveal no workspace or database inventory.
- Slow SSE clients, concurrent uploads, and large catalog operations remain
  bounded and observable.
- Custom session roots and application database paths are honored consistently
  and fail closed when unsafe or incompatible.
- Hot reload either activates a complete new application or leaves the previous
  application and dependencies untouched.
- Required CI checks cover style, types, architecture, security, dependencies,
  secrets, unit tests, coverage, builds, and representative browser workflows.
