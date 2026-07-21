# Manage pi API Keys from the Menu

## Goal

Add an **API Keys…** menu entry that lets an authenticated pi-lot-ui user add,
replace, and remove API keys used by pi. Store credentials in pi's existing
`$PI_CODING_AGENT_DIR/auth.json` through the SDK associated with the configured
`PI_BIN`; never copy secrets into pi-lot-ui's SQLite database, browser storage,
logs, events, or API responses.

This feature manages credentials stored locally for pi. Removing a key from pi
does **not** revoke it at the upstream provider, and the UI must say so
explicitly. Provider-side revocation remains the user's responsibility.

## Guardrails

- Keep provider credentials separate from general application settings. Do not
  weaken the existing `app_settings` secret-key rejection policy or add API
  keys to browser preference synchronization.
- Use pi's exported `AuthStorage` and `ModelRegistry` from the installation that
  owns the configured `PI_BIN`. Do not hand-edit `auth.json`, bypass pi's file
  lock, or add a second credential database.
- Resolve the auth path from validated `PI_AGENT_DIR`, not from the server
  workdir or a browser-supplied path.
- Preserve unknown entries, provider-scoped `env` values, and OAuth
  credentials. API-key operations must not silently replace or remove OAuth
  credentials.
- Never return existing key values, masked values, prefixes, suffixes, hashes,
  lengths, or fingerprints. Return only provider, credential type, and safe
  source/status metadata.
- Never include submitted keys in logs, thrown validation messages, SSE events,
  telemetry, runner metadata, or toast text. Clear key input state immediately
  after a request settles.
- Require normal pi-lot-ui authentication for every credential route. Keep API
  keys out of URL paths and query strings; mutation payloads belong in JSON
  request bodies.
- Validate provider IDs against pi's current model registry, including custom
  providers loaded from `models.json`. Existing stored providers may remain
  visible even if their model configuration is no longer present.
- Explain precedence honestly: stored `auth.json` credentials override process
  environment and `models.json`; after removal, those fallback sources may
  still make a provider available.
- Running pi processes cache auth state. Apply a mutation only with an explicit
  **Save and restart pi** or **Remove and restart pi** confirmation, then restart
  every active runner so replacement and removal take effect consistently.
- Preserve active-runner identity, resumability, queued work policy, SSE
  continuity, and the existing watchdog/restart behavior.
- Respect unrelated work already present in the worktree.
- Validate after every implementation step:

```sh
npm test
```

Run the build and broader checks in the final step.

## 1. Add a pi Credential Adapter

- [x] Add a server-side credential service that locates the package entry next
  to the real path of `PI_BIN`, dynamically imports that installed pi SDK, and
  constructs `AuthStorage` and `ModelRegistry` against
  `PI_AGENT_DIR/auth.json` and `PI_AGENT_DIR/models.json`. Fail with an
  actionable diagnostic when the configured executable does not expose the
  required SDK rather than falling back to another globally installed version.
- [x] Expose narrow operations to list safe provider metadata, set an API-key
  credential, and remove an API-key credential. Reload storage before reads,
  rely on `AuthStorage` for locked writes and `0600` permissions, preserve
  concurrent OAuth refreshes, and reject an API-key mutation that would
  overwrite or remove an OAuth entry.
- [x] Build provider choices from `ModelRegistry.getAll()` and display names
  from the same registry. Include stored-but-no-longer-registered providers in
  the read model, but reject adding a new unregistered provider.

**Acceptance:** tests using a temporary agent directory prove that API-key
writes preserve unrelated API-key, OAuth, and custom-provider entries; files
remain mode `0600`; malformed auth data fails closed; and no read model contains
credential material or a key-derived fingerprint.

## 2. Add Authenticated Credential Routes

- [x] Add `http/routes/credentialRoutes.mjs` and compose it into `app.mjs` under
  exact authenticated routes:

```text
GET    /api-keys
POST   /api-keys    { "provider": "...", "key": "...", "restart": true }
DELETE /api-keys    { "provider": "...", "restart": true }
```

  `GET` returns provider IDs, display names, stored credential type, and safe
  source/status labels only. Mutations require a non-empty provider, a bounded
  non-empty key where applicable, and explicit restart confirmation.
- [x] Return stable status codes: `400` for malformed input, `404` for an
  unknown provider or missing stored API key, `409` for an OAuth conflict,
  `413` for an oversized body, and `503` when the configured pi SDK/auth store
  cannot be used. Ensure errors never interpolate the submitted key.
- [x] Add an injectable restart-active-runners operation. After a successful
  credential write, capture all runners that currently own a live process,
  stop them, and restart only that captured set using the established runner
  lifecycle. Return affected runner IDs and a restart status without returning
  secrets. If restarting fails after the durable credential mutation, report
  the partial operational failure honestly instead of rolling the credential
  file back unsafely.

**Acceptance:** route tests prove authentication is mandatory, method handling
is correct, malformed and oversized bodies are rejected, OAuth entries are
protected, every active runner is restarted once, inactive runners stay
inactive, and serialized responses/errors contain no submitted or stored key.

## 3. Add the API Keys Menu Workflow

- [x] Add a top-level **API Keys…** action to `Menu.svelte`, route it through the
  mount-scoped `uiActionRegistry`, and register/unregister the handler in the
  owning feature assembly. Keep this separate from `SettingsModal` so secrets
  do not enter the browser-preference feature boundary.
- [x] Add a credentials feature/controller that owns API calls, loading/error
  state, add/replace/remove workflows, restart confirmations, toast policy, and
  teardown. Components must not perform credential fetches directly or retain
  submitted keys in a module-global store.
- [x] Add `ApiKeysModal.svelte` and wire it through `Overlays.svelte`. Display
  each provider and safe source state (`stored API key`, `stored OAuth`,
  `environment`, `models.json`, or `not configured`) without displaying any
  credential-derived text. Keep OAuth rows read-only in this first version.
- [x] Provide an in-modal add/replace form with an unprefilled password input,
  `autocomplete="off"`, disabled spelling/autocorrection, provider selection
  sourced from the server, and explicit **Save and restart pi** wording. Clear
  the input immediately on success, failure, cancellation, modal close, and
  component teardown.
- [x] Require a provider-specific confirmation before replacement or removal.
  Removal must be labeled **Remove from pi and restart** and state that it does
  not revoke the upstream key. If a fallback credential source remains, warn
  that pi may continue to authenticate from that source after removal.

**Acceptance:** component/controller tests cover loading, empty/error states,
add, replacement confirmation, removal confirmation, OAuth protection, fallback
warnings, restart feedback, remount teardown, and key-input clearing. Menu and
modal behavior remain keyboard- and mobile-accessible.

## 4. Enforce the Secret Boundary

- [ ] Extend static and persistence guards to prove credential routes/services
  never call the general settings repository, API-key fields remain forbidden
  in `app_settings`, and browser preference policy still excludes auth data.
- [ ] Add tests that seed recognizable canary keys and assert they are absent
  from route responses, server events, runner state, application SQLite rows,
  logs captured through injected loggers, and built client assets.
- [ ] Ensure request handling does not place keys in URLs and applies a small,
  documented JSON body limit suitable for provider credentials. Confirm auth
  failures and validation failures cannot echo request bodies.

**Acceptance:** the only durable location containing a canary key is the
temporary pi `auth.json`, protected with `0600`; deleting it through the feature
removes it from that file while preserving unrelated credentials.

## 5. Document Semantics and Complete Validation

- [ ] Update README configuration, feature, security, and endpoint sections to
  document the **API Keys…** menu, `PI_AGENT_DIR/auth.json` ownership, stored
  credential precedence, all-runner restart behavior, environment/models.json
  fallback, and the distinction between removing from pi and provider-side
  revocation.
- [ ] Update menu-action, modal ownership/history, UI boundary, server route
  composition, and endpoint documentation tests. Add an e2e flow with a mock
  provider that adds a key, observes newly available models after restart,
  replaces it without exposing either value, removes it, and verifies the
  provider becomes unavailable when no fallback exists.
- [ ] Run the complete validation matrix and check this item only after all
  results pass:

```text
npm run build
npm test
cd tests/e2e && npm test
```

## Completion Criteria

- An authenticated user can open **API Keys…**, add or replace an API key for a
  provider known to the configured pi installation, and remove a stored API
  key.
- pi-lot-ui writes credentials only through pi's `AuthStorage` to the configured
  agent `auth.json`, preserving locking, permissions, OAuth entries, custom
  providers, and concurrent updates.
- No API response or browser view reveals existing key material or a stable
  key-derived identifier, and no key is stored in pi-lot-ui SQLite, browser
  storage, logs, SSE events, or runner state.
- Every active pi runner restarts after a confirmed mutation so additions,
  replacements, and removals take effect consistently; inactive runners remain
  inactive.
- The UI clearly distinguishes removing a credential from pi from revoking it
  at the provider and warns when environment or `models.json` fallback auth may
  remain.
- Build, unit, and e2e validation pass.
