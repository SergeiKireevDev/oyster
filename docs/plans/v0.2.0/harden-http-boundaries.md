# Harden HTTP Trust and Diagnostic Boundaries

## Goal

Make client identity, authentication throttling, health checks, and diagnostics
safe for direct deployments and explicit reverse-proxy deployments. Forwarded
headers must not become trusted merely because a client supplied them, and the
public health endpoint must reveal readiness rather than internal inventory.

## Guardrails

- Authentication never depends on source IP or proxy headers. Trusted proxy
  configuration affects attribution and throttling only.
- By default, trust no forwarded header. Enable proxy trust through explicit,
  validated CIDR/address configuration.
- Parse proxy chains from the socket peer inward; do not blindly choose the
  first `X-Forwarded-For` value.
- Bound per-client and global throttle state, expire it periodically, and avoid
  user-controlled unbounded map keys.
- Keep `/health` unauthenticated and minimal for load balancers. Put paths,
  runners, sessions, migrations, and process configuration behind normal Oyster
  authentication.
- Never echo token prefixes, lengths, cookies, authorization values, or request
  bodies in diagnostics or authentication logs.

## 1. Define an Explicit Trusted-Proxy Contract

- [ ] Add a configuration value such as `OYSTER_TRUSTED_PROXIES` supporting a
  documented list of exact addresses and CIDRs. Validate it at startup and
  report it in `--check-config` without resolving DNS dynamically.
- [ ] Implement one client-address resolver that starts with
  `req.socket.remoteAddress`, trusts forwarded headers only when that peer is
  trusted, and walks a normalized forwarding chain from right to left.
- [ ] Treat `CF-Connecting-IP` as authoritative only when the immediate peer is
  an explicitly trusted Cloudflare/local proxy and deployment documentation
  requires that proxy to strip inbound spoofed copies.
- [ ] Normalize IPv4-mapped IPv6, loopback forms, malformed lists, whitespace,
  and duplicate headers. Return a bounded fallback bucket for invalid input.
- [ ] Add direct-client, one-proxy, multi-proxy, untrusted-peer, spoofed-header,
  IPv4, and IPv6 tests.

**Acceptance:** an untrusted direct client cannot choose its throttle identity
with either forwarded header.

## 2. Bound Authentication Throttling

- [ ] Replace arrays of timestamps per arbitrary string with a bounded sliding
  window or token-bucket service owned by stable ephemeral state.
- [ ] Set explicit limits for tracked clients, failures per client, global
  failures, entry lifetime, and cleanup cadence. Evict expired/least-recently
  used entries before admitting new keys.
- [ ] Apply a global fallback bucket so rotating valid client addresses cannot
  allocate state or bypass all throttling indefinitely.
- [ ] Keep successful-auth reset semantics narrowly scoped; a valid request must
  not erase global abuse accounting.
- [ ] Expose aggregate counts and rejected-request totals only through
  authenticated diagnostics.

**Acceptance:** property/stress tests send many spoofed headers and addresses
while memory and map size remain within deterministic limits.

## 3. Split Liveness from Diagnostics

- [ ] Reduce unauthenticated `GET /health` to a stable response such as service
  identity, `ok`, readiness, and version/schema compatibility booleans. Do not
  include runners, clients, workdirs, session IDs, executable paths, or database
  paths.
- [ ] Add authenticated `GET /diagnostics` for operational inventory. Separate
  safe summary fields from optional detailed runner/process/storage sections.
- [ ] Redact home/workspace paths by default and require an explicit diagnostic
  detail mode if absolute paths are operationally necessary.
- [ ] Keep readiness false while migrations or domain reconcilers are pending or
  failed; keep liveness available so supervisors can distinguish a crash from a
  fail-closed startup state.
- [ ] Update documentation, service checks, Docker health checks, Hub health
  consumption, and tests to use the minimal contract.

**Acceptance:** unauthenticated snapshots contain no filesystem path, session
identity, runner identity, token metadata, or database inventory.

## 4. Harden Authentication Observability

- [ ] Replace credential-presence logging with a request ID, method, normalized
  route, trusted client bucket, outcome, and user-agent policy that strips
  control characters and bounds length.
- [ ] Ensure `/authcheck` reports only authorized/unauthorized and
  unauthenticated-mode state; remove credential source, length, and validity
  details from the public response.
- [ ] Add structured counters for missing credentials, invalid credentials,
  throttling, and trusted-proxy parse failures without retaining credential
  values.
- [ ] Add canary tests proving secrets are absent from logs, responses, metrics,
  thrown errors, and persisted application data.

**Acceptance:** operators can diagnose rates and route classes without learning
anything about credential contents.

## 5. Add Edge-Deployment Tests and Documentation

- [ ] Add integration fixtures for direct HTTP, loopback Nginx-style proxying,
  Cloudflare-style proxying, and an untrusted proxy that forwards attacker
  headers.
- [ ] Document secure examples for Nginx, Caddy, cloudflared, and an authenticated
  outer llmbox boundary, including header stripping and trusted-proxy values.
- [ ] Verify unauthenticated spoke mode remains explicit and cannot silently
  change Hub authentication or diagnostic exposure.
- [ ] Run unit, build, Docker, Hub/spoke, and browser authentication tests.

## Completion criteria

- Forwarded addresses are trusted only through explicit proxy configuration.
- Authentication throttle state is time- and size-bounded under address churn.
- `/health` is a minimal liveness/readiness contract.
- Detailed operational inventory requires authentication and applies path and
  secret redaction.
- Direct and proxied deployment modes have tested, documented behavior.
