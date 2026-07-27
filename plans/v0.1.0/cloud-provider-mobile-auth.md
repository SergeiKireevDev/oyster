# Mobile-first cloud provider authentication

## Goal

Replace the generic cloud credential form with provider-appropriate, mobile-first
connection journeys for the cloud providers currently supported by
`oyster-hub/cloud-provisioning.mjs`:

- DigitalOcean authorization-code OAuth, with a personal-access-token fallback.
- Google interactive OAuth followed by project selection, while retaining
  service-account JSON as an advanced option.
- AWS cross-account IAM role onboarding through CloudFormation and STS, rather
  than presenting AWS access keys as OAuth.
- Guided Hetzner Cloud project-token onboarding until Hetzner exposes an
  appropriate delegated authorization flow for the Cloud API.

A user should be able to start in Oyster, switch to a provider's browser or
console, return to the same wizard step, verify the connection, and provision a
VM without copying long identifiers. Provider credentials must remain on Hub
and must never enter browser storage, URLs, logs, events, or provisioned VMs.

This cloud authorization system is separate from both Pi model-provider OAuth
and llmbox's Google OIDC admin login. Do not reuse Pi's `auth.json`, Pi's OAuth
flow service, or the Google client used for `openid email` admin authentication.

## Implementation status

Implemented in the `feat/hetzner-cloud-compatibility` worktree with mocked
provider integration coverage. The hosted operator must still perform external
provider actions that cannot be committed to source: register and verify the
DigitalOcean and Google applications, publish the reviewed CloudFormation
template, and configure production client/source credentials and the cloud
credential-encryption key.

## Baseline before implementation

Before this plan, `oyster-hub/cloud-provisioning.mjs` exposed one generic credential
shape per provider:

- DigitalOcean personal access token.
- Hetzner Cloud personal access token.
- AWS access key, secret key, and optional session token.
- GCP service-account JSON, exchanged server-to-server for OAuth access tokens.

The existing GCP `oauthSupported: true` flag means service-account token
exchange, not interactive **Sign in with Google**. The generic
`CloudEnvironmentModal.svelte` renders these definitions as text/password fields
or a textarea. This is functional but gives poor mobile UX for AWS, GCP, and
provider-console handoffs.

## Product decisions

### Use provider-specific language

Do not label every connection as OAuth. Primary actions should be:

- **Sign in with DigitalOcean**
- **Sign in with Google**
- **Connect AWS account**
- **Create Hetzner API token**

Technical protocol details belong in expandable help, not the primary journey.

### Use the system browser

OAuth must use a top-level browser redirect initiated by a clear user action.
Do not use embedded webviews or depend on popups. Preserve the wizard route and
pending flow on Hub before navigating. The provider callback must return the
user to the exact provider and step.

Provider-console setup may open an external tab/window because it has no OAuth
callback. Explain that the user should return to Oyster, resume verification on
visibility/focus, and offer an explicit **I've finished setup** retry button.

### Keep advanced credential methods

Keep PATs, AWS access keys, and GCP service-account JSON behind an **Advanced
connection options** disclosure. They are compatibility and self-hosted
fallbacks, not the default mobile journey.

### Hosted versus self-hosted OAuth clients

For hosted Oyster, register separate development and production applications
with each applicable provider and fixed HTTPS callback URLs. Keep client
secrets in server-side secret files or a secret manager.

For self-hosted Oyster, support bring-your-own OAuth client configuration.
Never ship a production client secret in the repository or built frontend. Do
not introduce a central OAuth broker for self-hosted instances unless Oyster
explicitly accepts custody of those installations' provider grants.

## Guardrails

- Keep cloud credentials in an Oyster Hub-owned credential service, separate
  from Pi credentials and general application settings.
- Never return access tokens, refresh tokens, PATs, AWS secrets, service-account
  private keys, authorization codes, PKCE verifiers, or provider callback
  errors containing secrets to the browser.
- Never place secrets in URLs, fragments, application history, logs, telemetry,
  SSE events, workspace metadata, cloud-init, or QR codes.
- Use authorization code, cryptographically random one-time `state`, PKCE where
  supported, exact redirect URI matching, bounded callback parameters, and a
  short flow lifetime.
- Bind every flow to the authenticated Hub tenant/session that started it. A
  flow ID or callback state must never substitute for normal authorization on
  status, retry, disconnect, or provisioning APIs.
- The provider callback may be publicly reachable because external providers
  cannot attach the Hub bearer token. It must accept only an exact route,
  validate one-time state, disclose no credential data, and complete only a
  previously authenticated flow.
- Request minimum practical provider scopes and permissions. Document every
  granted operation: list options, create/tag an instance, power management,
  and destroy.
- Refresh tokens and other durable bearer credentials require encrypted-at-rest
  storage for hosted production. Maintain owner-only file permissions and
  atomic writes as defense in depth.
- Disconnect should revoke the upstream grant when the provider offers a safe
  revocation endpoint, then erase local credentials. Clearly report when local
  removal cannot revoke upstream access.
- Do not automatically inspect the clipboard. Use normal OS paste controls.
- Preserve unrelated work in the worktree. Run `npm test` after every
  implementation checklist item; run the build and broader end-to-end checks in
  the final item.

## 1. Model provider authentication methods explicitly

- [ ] Replace `authType` plus the ambiguous `oauthSupported` boolean with safe,
  declarative `authMethods` metadata. Support at least:

  ```text
  oauth_redirect
  assume_role
  api_token
  access_key
  service_account_file
  ```

  Mark one method primary and fallback methods advanced. Return only display,
  setup, configured, and safe account metadata to the browser.
- [ ] Introduce a versioned internal credential record that distinguishes OAuth
  grants, API tokens, AWS roles, AWS compatibility keys, and GCP service
  accounts. Provider request code must resolve credentials through one narrow
  interface so token refresh and temporary AWS credentials are transparent.
- [ ] Add configuration for the public Hub URL and provider-specific OAuth
  clients. Read client secrets from environment variables or owner-only secret
  files, never from browser-supplied provider metadata.
- [ ] Add a cloud credential vault with atomic persistence, redaction, and
  envelope encryption support for hosted deployments. Define and test migration
  from the current owner-only plaintext cloud state without exposing existing
  credentials through listings or logs.

**Acceptance:** provider listings contain enough information to choose the
correct journey but no secret-derived values. Existing PAT, access-key, and
service-account configurations continue to work through the new credential
resolver.

## 2. Add a Hub-owned external authorization coordinator

- [ ] Add a bounded in-memory flow coordinator owned by the stable Hub process.
  Persist only what is required for mobile navigation; server restart may safely
  expire active handshakes. Generate random flow IDs, callback state, and PKCE
  verifiers, permit at most one active flow per provider/tenant, and expire
  abandoned flows after approximately 15–20 minutes.
- [ ] Add authenticated start, status, retry, and cancel routes, plus an exact
  public callback route:

  ```text
  POST /api/v1/cloud/providers/:provider/authorization/start
  GET  /api/v1/cloud/authorization/:flowId/status
  POST /api/v1/cloud/authorization/:flowId/retry
  POST /api/v1/cloud/authorization/:flowId/cancel
  GET  /cloud/oauth/:provider/callback
  ```

  If route paths are adjusted to match Hub conventions, retain the same trust
  boundaries: normal authentication everywhere except the provider callback.
- [ ] Exchange authorization codes and refresh access tokens server-side. Use a
  per-credential refresh lock, expiry skew, bounded provider timeouts, and safe
  retry behavior so simultaneous options/provision/lifecycle requests do not
  race token rotation.
- [ ] Make callback completion redirect to a credential-free UI route that
  restores the provider wizard. Never append the Oyster bearer token, provider
  token, authorization code, raw callback state, or provider error detail.
- [ ] Add cancellation and cleanup that erases code verifiers, callback state,
  authorization URLs, temporary errors, and pending promises after completion,
  cancellation, timeout, or shutdown.

**Acceptance:** tests cover callback CSRF, replay, state mismatch, expired flow,
wrong provider, cross-tenant status access, refresh races, mobile page reload,
cancellation, timeout, and complete redaction of authorization artifacts.

## 3. Implement DigitalOcean OAuth as the first redirect journey

- [ ] Register separate DigitalOcean OAuth applications for development and
  production. Configure exact HTTPS callback URLs and document BYO-client setup
  for self-hosted Hub deployments.
- [ ] Implement DigitalOcean's documented authorization-code exchange and
  request the minimum scope that supports the operations Oyster performs. Add
  PKCE if supported by the provider; retain mandatory state validation in all
  cases.
- [ ] Resolve DigitalOcean API calls from OAuth credentials as well as legacy
  PATs. Capture only safe account/team identity for the connected-state screen.
- [ ] Make OAuth the primary DigitalOcean method and move PAT entry under
  **Advanced connection options**. Validate either method immediately before
  advancing to instance selection.
- [ ] Implement upstream revocation on disconnect if supported; otherwise show
  precise instructions for revoking the application from DigitalOcean.

**Acceptance:** a mobile browser can leave Oyster, authorize DigitalOcean,
return to the same wizard, see the connected account, and load live options
without seeing or storing token material client-side. PAT behavior remains
covered.

## 4. Implement Google interactive OAuth and project selection

- [ ] Register a dedicated Google OAuth web client for cloud provisioning,
  separate from llmbox admin OIDC. Configure consent-screen branding, exact
  redirect URIs, test users while unpublished, and the provider verification
  required before public production use.
- [ ] Implement authorization code plus PKCE, offline access, refresh-token
  persistence, and minimum Compute/project-listing scopes. Confirm exact scopes
  against current Google documentation during implementation and document why
  each is required.
- [ ] After callback, fetch safe project metadata and present a searchable
  project picker. For large organizations, support incremental loading/search
  and preserve an explicit project-ID entry fallback.
- [ ] Validate the selected project's Compute Engine API status and effective
  permissions before advancing. When user action is required, provide a direct
  Google Console link, retry automatically on focus/visibility, and include an
  explicit retry button.
- [ ] Keep service-account authentication as an advanced method. Replace the
  primary textarea with a mobile file picker accepting a JSON file, while
  retaining paste as a fallback. Submit directly to Hub, show only parsed
  service email/project confirmation, and clear browser file/form state after
  every outcome.
- [ ] Prefer service-account impersonation or workload identity in future
  unattended/enterprise deployments; do not silently represent a human OAuth
  refresh token as equivalent to workload identity.

**Acceptance:** Google OAuth returns to a mobile-friendly project picker,
refresh survives access-token expiry, disabled API/insufficient permission
states are actionable, and service-account files never persist in browser
state.

## 5. Replace primary AWS access-key onboarding with AssumeRole

- [ ] Define a least-privilege AWS IAM policy for Oyster's current EC2 describe,
  run, tag, stop, start, and terminate operations. Scope resources and ownership
  tags where AWS authorization semantics permit, and document unavoidable list
  permissions.
- [ ] Generate a CloudFormation Quick Create URL that creates a deterministic
  role trusted by Oyster's AWS principal and requires a random per-connection
  external ID. Register no OAuth application: generic AWS account API delegation
  should use IAM and STS.
- [ ] Ask only for the 12-digit AWS account ID before opening the console. Derive
  the deterministic role ARN on Hub so the user does not copy it on mobile.
- [ ] On return to Oyster, poll bounded `STS AssumeRole` attempts and advance as
  soon as setup is complete. Pause noisy polling while the page is hidden,
  retry promptly on visibility/focus, and provide **I've finished setup**.
- [ ] Cache only short-lived STS credentials in memory and refresh them through
  the role configuration. Store the role ARN and external ID in the credential
  vault; never persist temporary session credentials unless strictly necessary.
- [ ] Keep access key, secret key, and optional session token entry under
  **Advanced connection options**. Warn against root credentials and validate
  keys before saving.

**Acceptance:** the default AWS mobile journey requires no secret-key entry and
no role-ARN copying. Tests prove external-ID enforcement, least-privilege
request signing, temporary credential refresh, setup timeout, and compatibility
access-key behavior.

## 6. Build a guided Hetzner token journey

- [ ] Confirm against current Hetzner Cloud documentation whether an applicable
  delegated OAuth flow exists before implementation. If not, retain a dedicated
  project API token as the supported method rather than simulating OAuth.
- [ ] Render short numbered instructions for choosing the Hetzner project,
  opening **Security → API Tokens**, and creating the required read/write token.
  Link as close to the provider's token-management screen as stable provider
  URLs allow.
- [ ] Open the provider console through an explicit user action, explain how to
  return, retry verification on focus/visibility, and keep a prominent
  paste-friendly password field with correct mobile input behavior.
- [ ] Validate the token immediately, clear it from component state after the
  request settles, and display only safe connected-project/account metadata if
  the API exposes it.
- [ ] Explain local removal versus provider-side revocation and link back to the
  provider's token-management screen when disconnecting.

**Acceptance:** mobile users receive an accurate guided flow with no automatic
clipboard access, tokens are submitted only in bounded authenticated request
bodies, and canary tokens appear only in the credential vault.

## 7. Replace the generic modal with a resumable mobile wizard

- [ ] Refactor `CloudEnvironmentModal.svelte` into a feature-owned connection
  controller/store plus focused Svelte steps/components. Components must not
  own credential fetch orchestration or retain secret values in global stores.
- [ ] Use a full-height mobile sheet/page with these stable steps:

  ```text
  Choose provider → Connect account → Verify → Choose instance → Provision
  ```

  Preserve desktop behavior without forcing the mobile layout into a narrow
  centered form.
- [ ] Show one primary provider-specific action and place fallback methods in an
  **Advanced connection options** disclosure. Use accessible status states:
  **Waiting for provider**, **Waiting for console setup**, **Verifying access**,
  **Connected**, **Action required**, and **Expired**.
- [ ] Persist only non-secret route/flow references needed to restore the wizard
  after navigation. Keep credential fields, files, callback values, and
  provider errors out of browser storage and history. Clear secret-bearing
  component state on submit, error, cancel, method switch, modal close, and
  teardown.
- [ ] Resume status checks when the document becomes visible or receives focus.
  Use one outstanding request, bounded backoff, abortable fetches, and an
  explicit retry control rather than aggressive background polling.
- [ ] Show the connected account/project, requested permissions, and revocation
  behavior before provisioning. Never show masked token fragments or
  fingerprints.
- [ ] Preserve provider selection and successfully loaded instance choices when
  harmless, but reset options when account/project/credential identity changes.

**Acceptance:** focused component/controller tests cover iOS/Android-sized
layouts, keyboard and screen-reader operation, external navigation and return,
reload, backgrounding, expiration, cancellation, retries, advanced methods,
input clearing, and remount teardown.

## 8. Add authenticated cross-device handoff

- [ ] Add **Continue on another device** for AWS, Hetzner, and GCP
  service-account setup. Display a short-lived URL/QR code containing only a
  non-secret flow reference; require the second browser to authenticate to the
  same Hub before it can inspect or complete the flow.
- [ ] Do not encode provider credentials, Hub bearer credentials, callback
  state, external IDs, authorization codes, or credential authority in the QR
  code. A pairing reference must not bypass normal Hub authentication.
- [ ] Submit credentials directly from the second browser to Hub over TLS. The
  mobile browser should observe only safe progress and connected-account
  metadata, then advance automatically.
- [ ] Enforce one-time completion, short expiry, cancellation from either
  device, tenant/session binding, and cleanup of all transient records.

**Acceptance:** tests prove an unauthenticated or cross-tenant browser cannot use
pairing, replay fails, credentials never pass through the mobile browser or QR
payload, and either device can cancel safely.

## 9. Harden, document, and validate

- [ ] Add provider-mock integration tests for OAuth redirects/token refresh,
  CloudFormation/STS setup, console-return retries, file upload, PAT fallback,
  disconnect, and upstream revocation behavior without contacting real cloud
  providers.
- [ ] Add canary secret tests spanning request bodies, callback handling,
  credential persistence, logs, errors, browser stores/history, Hub responses,
  workspace metadata, cloud-init, QR payloads, built assets, and test artifacts.
- [ ] Add mobile Playwright coverage for DigitalOcean and Google redirect
  return, AWS console handoff, Hetzner token paste, GCP JSON file selection,
  background/foreground resume, expiration, and cross-device completion.
- [ ] Update Hub configuration examples, deployment docs, security docs, API
  reference, provider app-registration instructions, self-hosted BYO-client
  setup, scope/IAM policy rationale, credential encryption/key rotation,
  revocation semantics, and recovery when an OAuth application secret changes.
- [ ] Run final validation:

  ```sh
  npm run build
  npm test
  ```

  Also run the repository's applicable end-to-end and container checks, and
  manually verify at least one iOS-sized and one Android-sized viewport against
  mock providers.

**Acceptance:** every provider has an honest, tested mobile journey; redirect
and console handoffs resume safely; no cloud secret reaches the browser or a
provisioned workspace; existing cloud provisioning and lifecycle tests remain
passing; and production operators have complete app-registration, IAM,
encryption, revocation, and recovery instructions.
