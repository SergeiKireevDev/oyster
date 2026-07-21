# Manage pi OAuth from pi-lot-ui

## Goal

Extend the existing pi credential workflow so an authenticated pi-lot-ui user can
sign in to and sign out of OAuth-capable providers from the browser. Delegate
provider discovery, authorization, token exchange, refresh semantics, and
credential persistence to the SDK owned by the configured `PI_BIN`; pi-lot-ui
must only adapt Pi's interactive OAuth callbacks to a transient web workflow.

Rename the top-level **API Keys…** workflow to **Credentials…** so API keys and
OAuth accounts share one accurate status surface. When an authenticated user
opens the app and Pi's `auth.json` has no credential entries, automatically open
the credentials authentication workflow in setup mode. Existing API-key
behavior and security guarantees must remain intact.

## Scope

The first version supports OAuth providers returned by
`AuthStorage.getOAuthProviders()` in the server-side SDK loaded from the
configured Pi installation. It must not execute project extensions in the UI
server merely to discover additional OAuth providers. Stored OAuth entries whose
provider implementation is unavailable remain visible and removable, but cannot
start a new sign-in flow.

Pi currently exposes browser authorization, device-code, prompt, selection,
progress, manual-code, and cancellation callbacks. pi-lot-ui must support all of
those callback shapes. For callback-server providers used from another machine,
the UI must support pasting the final redirect URL or authorization code instead
of assuming the browser can reach a loopback listener on the server host.

## Guardrails

- Use the configured Pi SDK's `AuthStorage.login()`, `AuthStorage.logout()`, and
  `AuthStorage.getOAuthProviders()` APIs. Do not implement provider token
  exchanges, refresh logic, PKCE, or direct `auth.json` editing in pi-lot-ui.
- Keep credentials in validated `PI_AGENT_DIR/auth.json`. OAuth access tokens,
  refresh tokens, authorization codes, redirect URLs containing codes, device
  codes, prompt responses, and provider callback state must never enter SQLite,
  browser storage, logs, SSE broadcasts, runner state, telemetry, or durable
  pi-lot-ui events.
- Authorization URLs, device verification URLs/codes, provider instructions,
  and prompts may be returned only to the authenticated browser participating
  in the transient flow. Retain them in memory only as long as needed.
- Keep pending flow state on the host-owned application `state` object so an
  `app.mjs` hot reload does not orphan active provider promises. Bound the
  number of flows, prompt/input sizes, polling rate, and lifetime.
- Every OAuth endpoint requires normal pi-lot-ui authentication. Keep flow IDs,
  authorization codes, and prompt responses in bounded JSON bodies, never URL
  paths or query strings.
- Generate cryptographically random, one-time flow IDs. Bind every response to a
  current pending request ID, reject stale/replayed responses, and never treat a
  flow ID as a substitute for normal application authentication.
- Pass an `AbortSignal` into Pi's OAuth callbacks. Cancellation, timeout,
  teardown, and server shutdown must reject pending prompts and allow provider
  callback servers/pollers to clean up.
- Permit at most one active sign-in per provider. While a provider is signing
  in, reject conflicting API-key replacement, OAuth logout, and a second sign-in
  with stable `409` responses.
- Starting OAuth over a stored API key requires explicit confirmation that a
  successful sign-in replaces that key. Starting over stored OAuth requires a
  deliberate re-authentication confirmation. Failed or cancelled login must
  leave the previous credential unchanged as guaranteed by Pi's login API.
- Signing out removes the credential from Pi but does not revoke the upstream
  grant. Say this explicitly and preserve fallback-source warnings.
- Restart every process that was active immediately after a successful login or
  logout, using the existing all-active-runner restart service. Do not restart
  runners for failed or cancelled flows. Report durable-success/restart-failure
  states honestly without trying to roll credentials back.
- Never automatically navigate the main pi-lot-ui window to a provider. The
  empty-auth startup behavior may open the credentials modal and provider
  chooser, but upstream authorization still requires a clear user-initiated
  link/button that can open a new tab and remains usable when popup blocking is
  enabled.
- Preserve unrelated work already present in the worktree.
- After each implementation checklist item, run:

```sh
npm test
```

Run build and full end-to-end validation only in the final checklist item.

## 1. Extend the Configured-Pi Credential Adapter

- [x] Extend `pi-credential-service.mjs` to discover safe OAuth provider
  metadata through `AuthStorage.getOAuthProviders()` from the SDK owned by
  `PI_BIN`, and merge `oauthCapable`/OAuth display-name metadata into provider
  status without exposing credentials. Stored OAuth entries with no available
  implementation must remain visible with `oauthCapable: false`.
- [x] Add narrow adapter operations for OAuth login and logout that use Pi's
  `AuthStorage` APIs, reload malformed storage fail-closed, accept the complete
  Pi callback contract (`onAuth`, `onDeviceCode`, `onPrompt`, `onSelect`,
  `onProgress`, `onManualCodeInput`, and `signal`), and reject unknown,
  wrong-credential-type, or busy providers without changing unrelated entries.
- [x] Add a shared provider-operation reservation boundary used by API-key and
  OAuth mutations so two browser operations cannot overwrite the same provider.
  Release reservations on every success, failure, cancellation, and timeout;
  preserve Pi's own file locking for cross-process writes and unrelated-provider
  refreshes.

**Acceptance:** temporary-agent-dir tests prove discovery comes from the
configured SDK, unavailable stored OAuth remains visible, all callback forms
are forwarded, successful login/logout use Pi storage with mode `0600`, failed
and cancelled flows preserve prior credentials, same-provider conflicts fail,
and unrelated credentials survive concurrent writes.

## 2. Add a Host-Owned OAuth Flow Coordinator

- [x] Add a server-side OAuth flow coordinator whose mutable registry is
  supplied by host-owned application state. It must generate random flow and
  request IDs, enforce one active flow per provider plus a small global limit,
  start `AuthStorage.login()` asynchronously, and publish only safe transient
  snapshots for authenticated polling.
- [x] Adapt authorization URL, device-code, progress, prompt, selection, and
  manual-code callbacks into explicit flow states. Support multiple/racing
  pending input callbacks, accept each response exactly once, cap all strings
  and option counts, and return terminal `succeeded`, `failed`, or `cancelled`
  states without exception stacks or credential material.
- [x] Implement cancellation, inactivity expiry, terminal-state expiry, and
  shutdown cleanup with `AbortController`. Ensure pending callback promises
  settle, provider reservations are released, callback-server/device polling is
  aborted, and expired transient URLs, codes, instructions, and submitted
  values are erased from memory.
- [x] On successful credential persistence, invoke the existing
  restart-active-runners operation and attach only safe restart metadata to the
  terminal flow. Represent partial/failed restart distinctly from OAuth failure,
  because the credential is already durable; never restart on login failure or
  cancellation.

**Acceptance:** deterministic coordinator tests cover every callback, racing
manual input, stale request IDs, replay, concurrent providers, same-provider
conflict, hot-reload state reuse, limits, timeout, cancellation, cleanup, and
successful/partial/failed runner restarts without exposing returned OAuth
credentials.

## 3. Add Authenticated OAuth Routes

- [x] Add exact authenticated, bounded-JSON routes and compose them beside the
  existing credential routes:

```text
POST   /oauth/start    { "provider": "...", "replace": false }
POST   /oauth/status   { "flowId": "..." }
POST   /oauth/respond  { "flowId": "...", "requestId": "...", "value": "..." }
POST   /oauth/cancel   { "flowId": "..." }
DELETE /oauth          { "provider": "...", "restart": true }
```

  Keep flow IDs and callback values out of paths and query strings. Start must
  require `replace: true` when a stored API key or OAuth credential would be
  replaced; logout must require explicit restart confirmation.
- [x] Return stable safe errors: `400` malformed input, `404` unknown/expired
  flow or provider, `409` credential conflict/busy provider/stale response,
  `413` oversized body, and `503` unavailable configured SDK or post-mutation
  restart failure. Never echo request bodies, callback values, redirect URLs,
  device codes, OAuth credentials, or provider exception text in errors.
- [x] Integrate OAuth logout with provider reservations and all-active-runner
  restart semantics. Return safe source metadata after removal so the browser
  can warn about environment or `models.json` fallback, while clearly
  distinguishing upstream revocation from local sign-out.

**Acceptance:** route tests prove authentication and methods, body limits,
replace confirmation, polling ownership, one-time responses, cancellation,
logout, conflict statuses, restart behavior, and redaction. Requests containing
canary authorization codes or redirect URLs must not appear in captured logs,
responses other than the intentional transient callback snapshot, or events.

## 4. Build the Browser OAuth Workflow

- [x] Rename the menu/modal workflow from **API Keys…** to **Credentials…** and
  evolve the mount-scoped credentials assembly, action names, stores, and
  controller without moving credential logic into settings or component-local
  fetches. Preserve clean registration/teardown and existing API-key actions.
- [x] Extend the controller with start, poll, respond, cancel, re-authenticate,
  and logout operations. Poll only while the modal is mounted and the flow is
  active; use abortable requests, bounded backoff, one outstanding poll, and
  teardown cancellation. Never place flow data in browser storage or
  application history.
- [x] On initial authenticated app mount, load safe credential status once and
  automatically open **Credentials…** in setup mode when `auth.json` contains
  no stored credential entries. Open it at most once per page mount, do not
  treat environment or `models.json` fallback as an `auth.json` entry, do not
  automatically navigate to an upstream provider, and do not reopen over a
  higher-priority modal or during teardown.
- [x] Extend the credentials modal to present OAuth-capable providers with
  **Sign in**, **Re-authenticate**, and **Sign out from pi** actions as
  applicable. Require provider-specific replacement/re-authentication and
  logout confirmations, explain that logout does not revoke upstream access,
  and retain API-key precedence/fallback messaging.
- [ ] Render each interactive flow state accessibly: a user-initiated external
  authorization link, copyable device user code and verification link, safe
  progress, selection controls, text/manual redirect input, cancellation, expiry,
  and terminal restart status. For callback-server providers, explain the remote
  loopback limitation and allow the redirect URL/code to be pasted.
- [ ] Treat callback input as ephemeral secret-bearing form state: do not use a
  global store for values; disable autocomplete/spelling correction where
  applicable; clear values immediately after response success/failure,
  cancellation, modal close, flow transition, and component teardown. Do not
  display submitted values again.

**Acceptance:** controller/component tests cover all callback states, popup-free
link behavior, device and manual flows, replacement confirmation, stale/replayed
responses, cancellation, expiry, re-authentication, logout/revocation wording,
fallback warnings, restart outcomes, input clearing, keyboard operation, mobile
layout, and remount teardown.

## 5. Enforce OAuth Secret and Lifecycle Boundaries

- [ ] Extend static architecture and persistence guards so OAuth services/routes
  cannot use general settings or app-data repositories, flow state is
  host-owned/transient, and browser preference/history policies exclude OAuth
  fields, codes, URLs, tokens, prompts, and flow snapshots.
- [ ] Add canary tests covering access/refresh tokens, authorization codes,
  redirect URLs, device codes, and prompt responses. Assert credential tokens
  exist only in temporary Pi `auth.json`; transient user-facing values exist
  only in the active flow/browser state; and none appear in SQLite, logs, SSE
  events, runner state, terminal status, server error payloads, or built assets.
- [ ] Add lifecycle tests for hot reload, server shutdown, browser/modal teardown,
  abandoned flows, provider callback failure, timeout, and concurrent Pi token
  refresh. Prove cleanup removes transient values and does not delete or corrupt
  a previously stored credential.

**Acceptance:** OAuth introduces no second credential store, no credential or
callback-value logging, and no orphaned long-running callback servers or polling
jobs. Existing API-key secret-boundary tests continue to pass unchanged.

## 6. Document and Validate

- [ ] Update README feature, endpoint, configuration, security, and operational
  sections for **Credentials…**, supported OAuth providers, configured-SDK
  ownership, transient browser/device/manual flows, remote callback-server
  behavior, `auth.json` storage/refresh, runner restarts, local logout versus
  upstream revocation, fallback sources, cancellation, and timeout.
- [ ] Update route composition, action ownership, modal history, listener
  inventory, and documentation tests. Add mock-SDK integration coverage that
  never contacts a real provider and proves the server delegates login, refresh
  compatibility, and logout to Pi rather than implementing token exchange.
- [ ] Add desktop and mobile Playwright flows using a mock OAuth provider: sign
  in through device or manual callbacks, observe models after runner restart,
  re-authenticate without exposing either token, cancel a flow without changing
  auth, sign out, and verify the provider becomes unavailable when no fallback
  remains. Assert no secret appears in rendered text, local/session storage, or
  collected network/error output.
- [ ] Run the complete validation matrix and check this item only after all
  results pass:

```text
npm run build
npm test
cd tests/e2e && npm test
```

## Validation for Every Verified Item

The goal loop must run this fenced validation command after each implementation
checklist item. The final checklist item additionally runs the complete matrix
listed above before verification.

```sh
npm test
```

## Completion Criteria

- An authenticated user can sign in, re-authenticate, cancel, and sign out for
  every OAuth provider exposed by the configured Pi SDK, including device-code,
  browser/manual callback, prompt, and selection interactions. On app startup,
  an empty Pi `auth.json` automatically opens the credentials setup workflow
  once without automatically navigating to an upstream provider.
- Pi—not pi-lot-ui—owns provider OAuth logic, PKCE/state validation, token
  exchange, refresh, and persistence in validated `PI_AGENT_DIR/auth.json`.
- OAuth credentials and transient authorization material never enter pi-lot-ui
  durable storage, logs, events, URLs, runner state, or browser storage.
- Pending flows are bounded, authenticated, cancellable, expiring, replay-safe,
  hot-reload-safe, and cleaned up on shutdown.
- Successful login/logout restarts exactly the runners active at mutation time;
  failure and cancellation do not restart runners; partial restart is reported
  without rolling credentials back.
- Existing API-key management, fallback warnings, secret guards, and all build,
  unit, and end-to-end tests continue to pass.
