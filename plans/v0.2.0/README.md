# Oyster v0.2.0 Code-Quality Roadmap

## Purpose

Turn the broader findings from the July 2026 server audit into independently
reviewable implementation plans. The audit covered the stable server core,
hot-reloadable application, routes, persistence, process ownership, session
catalogs, and browser-facing streaming paths.

The critical loopback authentication bypass and generated-token persistence
issue have already been addressed by `be924248` (**Require explicit
authentication for local tools**). They are not repeated as future work here.
This roadmap covers the remaining in-scope process-safety, configuration,
resource-bounding, and maintainability work.

## Plans

| Order | Plan | Primary outcomes |
|---:|---|---|
| 1 | [Safe process lifecycle](safe-process-lifecycle.md) | Awaited termination, effective SIGKILL escalation, PID identity checks, generation-safe runner replacement |
| 2 | [Harden HTTP boundaries](harden-http-boundaries.md) | Trusted-proxy policy, bounded authentication throttling, minimal public health, authenticated diagnostics |
| 3 | [Reliable file and stream I/O](reliable-file-and-stream-io.md) | SSE backpressure, isolated resumable uploads, mode-preserving saves, bounded event-loop delay |
| 4 | [Storage configuration and schema safety](storage-configuration-and-schema-safety.md) | One session-root contract, private database files, downgrade rejection, operational integrity checks |
| 5 | [Atomic hot reload and quality gates](atomic-hot-reload-and-quality-gates.md) | Transactional reload lifecycle, complete reload coverage, lint/type/security/coverage automation |

## Cross-cutting guardrails

- Preserve the stable-core rule: durable repositories and long-lived OS handles
  belong to `server/server.mjs` state, not cache-busted module globals.
- Preserve backend-neutral session identity as
  `{ backend, id, storagePath }`; never narrow identity to a bare ID or database
  path.
- Treat a PID as an untrusted locator. Signal a persisted PID only after
  verifying its recorded process identity immediately before each signal.
- Make every multi-store workflow either atomic, serialized, or durably
  recoverable. A journal without a reconciler is not a completed reliability
  boundary.
- Bound memory, queue depth, request size, operation count, and shutdown time.
  Slow clients and large workspaces must not stall unrelated runners or SSE
  clients.
- Keep secrets, credentials, request bodies, and internal filesystem inventory
  out of logs and public diagnostics.
- Add focused tests before changing behavior. Preserve compatibility only when
  it does not retain the unsafe behavior being removed.
- Respect unrelated work in every worktree and keep each checklist item small
  enough for one reviewed commit.

## Delivery sequence

1. Land the shared process termination primitive before modifying runner,
   hublot, routine, or one-shot process lifecycle code.
2. Land trusted-proxy parsing before changing throttling keys or diagnostics so
   tests use one authoritative client identity.
3. Land per-client stream accounting before enforcing disconnect limits.
4. Land one configured session root before tightening database and migration
   startup checks.
5. Add quality gates incrementally after the behavior-focused tests exist;
   baseline suppressions must be explicit, narrow, and burn down over time.

## Validation policy

Run focused tests after every checklist item, followed by the repository suite:

```sh
npm test
```

Before completing each plan, run the broader matrix against freshly built
artifacts rather than cached container tags:

```sh
npm run build
npm test
docker build -t oyster:quality-v0.2 .
cd tests/e2e && npm test
```

Plans touching the llmbox data path must additionally run its checks and cluster
suite. Performance items must record event-loop delay, memory, and queue-depth
results as diagnostics; normal CI assertions should use deterministic bounds,
not fragile elapsed-time thresholds.

## Completion criteria

- Every remaining audit finding maps to a completed plan item or a documented,
  evidence-based rejection.
- Runner and hublot replacement cannot overlap an unconfirmed old process.
- Public unauthenticated responses reveal no workspace or database inventory.
- Slow SSE clients, concurrent uploads, and large catalog operations remain
  bounded and observable.
- Custom session roots and application database paths are honored consistently
  and fail closed when unsafe or incompatible.
- Hot reload either activates a complete new application or leaves the previous
  application and its dependencies untouched.
- Required CI checks cover style, types, architecture, security, dependencies,
  secrets, unit tests, coverage, builds, and representative browser workflows.
