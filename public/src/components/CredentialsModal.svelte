<script>
  import { onDestroy } from "svelte";
  import { copyTextToClipboard } from "../lib/clipboardController.js";
  import { credentialsState } from "../stores/credentials.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    CREDENTIALS_CANCEL_OAUTH_ACTION,
    CREDENTIALS_CLOSE_ACTION,
    CREDENTIALS_LOGOUT_OAUTH_ACTION,
    CREDENTIALS_REMOVE_API_KEY_ACTION,
    CREDENTIALS_RESPOND_OAUTH_ACTION,
    CREDENTIALS_SAVE_API_KEY_ACTION,
    CREDENTIALS_START_OAUTH_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  let selectedProvider = "";
  let authenticationMethod = "api_key";
  let methodProvider = "";
  let keyInput;
  let hasKey = false;
  let oauthInputs = new Set();
  let oauthInputReady = {};
  let oauthOperationPending = false;
  let requestSignature = "";
  let deviceCodeInput;
  let deviceCodeCopied = false;
  let deviceCodeCopiedTimer;
  let deactivated = false;

  const sourceLabels = {
    stored_api_key: "stored API key",
    stored_oauth: "stored OAuth",
    environment: "environment",
    models_json: "models.json",
    not_configured: "not configured",
  };

  function sourceLabel(source) {
    return sourceLabels[source] ?? "not configured";
  }

  function oauthRequestInputType(request) {
    return request.kind === "manual_code" ? "password" : "text";
  }

  function cancelledFlowMessage(flow) {
    return flow.failureCode === "oauth_flow_expired" ? "Sign-in expired." : "Sign-in cancelled.";
  }

  function oauthActionLabel(provider) {
    return provider?.credentialType === "oauth" ? "Re-authenticate" : "Sign in with OAuth";
  }

  function apiKeyActionLabel(provider) {
    return provider?.credentialType === "api_key" ? "Replace and restart pi" : "Save and restart pi";
  }

  function providerOAuthLabel(provider) {
    return provider.credentialType === "api_key" ? "Sign in instead" : "Sign in";
  }

  function restartProcessLabel(runnerIds) {
    const count = runnerIds.length;
    return `${count} pi ${count === 1 ? "process" : "processes"}`;
  }

  $: activeProviders = $credentialsState.providers.filter((provider) => provider.configured);
  $: selectableProviders = $credentialsState.providers.filter((provider) =>
    provider.credentialType !== "oauth" && (provider.registered || provider.oauthCapable || provider.credentialType === "api_key"));
  $: if (!selectableProviders.some((provider) => provider.provider === selectedProvider)) {
    selectedProvider = selectableProviders[0]?.provider ?? "";
  }
  $: selected = selectableProviders.find((provider) => provider.provider === selectedProvider);
  $: if (selectedProvider !== methodProvider) {
    methodProvider = selectedProvider;
    authenticationMethod = selected?.oauthCapable ? "oauth" : "api_key";
    clearKey();
  }
  $: nextRequestSignature = JSON.stringify({
    flowId: $credentialsState.flow?.flowId ?? "",
    status: $credentialsState.flow?.status ?? "",
    deviceCode: $credentialsState.flow?.deviceCode?.userCode ?? "",
    requests: ($credentialsState.flow?.requests ?? []).map(({ requestId, kind, message }) => ({ requestId, kind, message })),
  });
  $: if (nextRequestSignature !== requestSignature) {
    requestSignature = nextRequestSignature;
    clearOAuthInputs();
  }

  function clearKey() {
    if (keyInput) keyInput.value = "";
    hasKey = false;
  }

  function clearOAuthInputs() {
    for (const input of oauthInputs) input.value = "";
    oauthInputReady = {};
    deviceCodeCopied = false;
    clearTimeout(deviceCodeCopiedTimer);
    deviceCodeCopiedTimer = undefined;
  }

  async function copyDeviceCode() {
    const code = $credentialsState.flow?.deviceCode?.userCode ?? "";
    if (!code) return;
    if (!await copyTextToClipboard(code)) {
      deviceCodeInput?.focus();
      deviceCodeInput?.select();
      return;
    }
    deviceCodeCopied = true;
    clearTimeout(deviceCodeCopiedTimer);
    deviceCodeCopiedTimer = setTimeout(() => {
      deviceCodeCopied = false;
      deviceCodeCopiedTimer = undefined;
    }, 2000);
  }

  function updateKey(event) {
    hasKey = Boolean(event.currentTarget.value.trim());
  }

  function updateOAuthInput(event, requestId) {
    const ready = Boolean(event.currentTarget.value.trim());
    oauthInputReady = { ...oauthInputReady, [requestId]: ready };
  }

  function trackOAuthInput(node) {
    oauthInputs.add(node);
    return {
      destroy() {
        node.value = "";
        oauthInputs.delete(node);
      },
    };
  }

  async function saveKey(event) {
    event.preventDefault();
    const key = keyInput?.value ?? "";
    if (!selectedProvider || !key.trim()) return;
    try {
      await uiActions.invoke(CREDENTIALS_SAVE_API_KEY_ACTION, { provider: selectedProvider, key });
    } finally {
      clearKey();
      keyInput?.focus();
    }
  }

  async function removeProvider(provider) {
    await uiActions.invoke(CREDENTIALS_REMOVE_API_KEY_ACTION, provider);
  }

  async function startOAuth(provider) {
    await uiActions.invoke(CREDENTIALS_START_OAUTH_ACTION, provider);
  }

  async function logoutOAuth(provider) {
    await uiActions.invoke(CREDENTIALS_LOGOUT_OAUTH_ACTION, provider);
  }

  async function respondOAuth(event, request) {
    event.preventDefault();
    if (oauthOperationPending) return;
    const input = event.currentTarget.elements.namedItem("oauthResponse");
    const value = input?.value ?? "";
    if (!value.trim()) return;
    oauthOperationPending = true;
    try {
      await uiActions.invoke(CREDENTIALS_RESPOND_OAUTH_ACTION, { requestId: request.requestId, value });
    } finally {
      if (input) input.value = "";
      oauthInputReady = { ...oauthInputReady, [request.requestId]: false };
      oauthOperationPending = false;
    }
  }

  async function chooseOAuth(request, value) {
    if (oauthOperationPending) return;
    oauthOperationPending = true;
    try {
      await uiActions.invoke(CREDENTIALS_RESPOND_OAUTH_ACTION, { requestId: request.requestId, value });
    } finally {
      oauthOperationPending = false;
    }
  }

  async function cancelOAuth() {
    if (oauthOperationPending) return;
    oauthOperationPending = true;
    clearOAuthInputs();
    try {
      await uiActions.invoke(CREDENTIALS_CANCEL_OAUTH_ACTION);
    } finally {
      oauthOperationPending = false;
    }
  }

  function useApiKey() {
    authenticationMethod = "api_key";
  }

  function useOAuth() {
    clearKey();
    authenticationMethod = "oauth";
  }

  function deactivate() {
    if (deactivated) return;
    deactivated = true;
    void uiActions.invoke(CREDENTIALS_CLOSE_ACTION);
  }

  function close() {
    clearKey();
    clearOAuthInputs();
    deactivate();
    closeModalState();
  }

  onDestroy(() => {
    clearKey();
    clearOAuthInputs();
    keyInput = undefined;
    deviceCodeInput = undefined;
    oauthInputs.clear();
    deactivate();
  });
</script>

<section class="api-keys-modal" aria-label="Pi credentials" aria-busy={$credentialsState.loading || oauthOperationPending}>
  <p class="api-keys-intro">Credentials are stored by pi in its own auth file. Existing key values are never displayed.</p>
  {#if $credentialsState.setupMode}
    <p class="api-keys-state" role="status">Choose a provider below to authenticate pi.</p>
  {/if}

  {#if $credentialsState.flow}
    <section class="oauth-flow" aria-label="OAuth sign-in" aria-live="polite">
      {#if $credentialsState.flow.status === "pending"}
        <h3>Sign in to {$credentialsState.flow.provider}</h3>
        {#if $credentialsState.flow.authorization}
          {#if $credentialsState.flow.authorization.instructions}<p>{$credentialsState.flow.authorization.instructions}</p>{/if}
          <a class="btn oauth-auth-link" href={$credentialsState.flow.authorization.url} target="_blank" rel="noopener noreferrer">Open authorization page</a>
        {/if}
        {#if $credentialsState.flow.deviceCode}
          <div class="oauth-device-code">
            <p>Open the verification page and enter this one-time code. Oyster will finish binding pi to your account automatically.</p>
            <div class="oauth-device-code-entry">
              <label>
                <span>Device code</span>
                <input bind:this={deviceCodeInput} readonly value={$credentialsState.flow.deviceCode.userCode} aria-label="Device code" onfocus={(event) => event.currentTarget.select()} />
              </label>
              <button class="chip oauth-device-code-copy" type="button" onclick={copyDeviceCode} aria-live="polite">{deviceCodeCopied ? "Copied" : "Copy"}</button>
            </div>
            <a class="btn" href={$credentialsState.flow.deviceCode.verificationUri} target="_blank" rel="noopener noreferrer">Open verification page</a>
            {#if $credentialsState.flow.deviceCode.expiresInSeconds}
              <span>Expires in {$credentialsState.flow.deviceCode.expiresInSeconds} seconds</span>
            {/if}
          </div>
        {/if}
        {#if $credentialsState.flow.progress}<p role="status">{$credentialsState.flow.progress}</p>{/if}
        {#each $credentialsState.flow.requests ?? [] as request (request.requestId)}
          {#if request.kind === "select"}
            <fieldset class="oauth-request">
              <legend>{request.message}</legend>
              {#each request.options as option (option.id)}
                <button type="button" class="chip oauth-choice" disabled={oauthOperationPending} onclick={() => chooseOAuth(request, option.id)}>{option.label}</button>
              {/each}
            </fieldset>
          {:else}
            <form class="oauth-request" onsubmit={(event) => respondOAuth(event, request)}>
              <label>
                <span>{request.message}</span>
                <input
                  name="oauthResponse"
                  use:trackOAuthInput
                  type={oauthRequestInputType(request)}
                  placeholder={request.placeholder ?? ""}
                  autocomplete="off"
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck="false"
                  required
                  disabled={oauthOperationPending}
                  oninput={(event) => updateOAuthInput(event, request.requestId)}
                />
              </label>
              {#if request.kind === "manual_code"}
                <p>If the provider redirects to an unreachable loopback page, paste the redirect URL or authorization code here.</p>
              {/if}
              <button class="btn" type="submit" disabled={oauthOperationPending || !oauthInputReady[request.requestId]}>Continue</button>
            </form>
          {/if}
        {/each}
        <button class="chip oauth-cancel" type="button" disabled={oauthOperationPending} onclick={cancelOAuth}>Cancel sign-in</button>
      {:else if $credentialsState.flow.status === "succeeded"}
        <p class="oauth-result success" role="status">Sign-in completed.</p>
      {:else if $credentialsState.flow.status === "cancelled"}
        <p class="oauth-result warning" role="status">{cancelledFlowMessage($credentialsState.flow)}</p>
      {:else}
        <p class="api-keys-state error" role="alert">Sign-in failed. Try again.</p>
      {/if}
      {#if $credentialsState.flow.restart}
        <p role="status">Pi restart: {$credentialsState.flow.restart.status}</p>
      {/if}
    </section>
  {/if}

  {#if $credentialsState.loading && !$credentialsState.providers.length}
    <p class="api-keys-state" role="status">Loading provider credentials…</p>
  {:else if $credentialsState.error && !$credentialsState.providers.length}
    <p class="api-keys-state error" role="alert">{$credentialsState.error}</p>
  {:else if !$credentialsState.providers.length}
    <p class="api-keys-state">No providers are available from the configured pi installation.</p>
  {:else}
    {#if activeProviders.length}
    <div class="api-key-list" role="list" aria-label="Active provider credential status">
      {#each activeProviders as provider (provider.provider)}
        <div class="api-key-row" role="listitem" data-provider={provider.provider}>
          <div class="api-key-provider">
            <strong>{provider.displayName}</strong>
            <span>{provider.provider}</span>
          </div>
          <div class="api-key-status">
            <span class="api-key-source">{sourceLabel(provider.source)}</span>
            {#if provider.credentialType === "oauth"}
              {#if provider.oauthCapable}
                <button class="chip api-key-oauth" type="button" onclick={() => startOAuth(provider.provider)} disabled={$credentialsState.loading || oauthOperationPending}>
                  Re-authenticate
                </button>
              {/if}
              <button class="chip api-key-remove" type="button" onclick={() => logoutOAuth(provider.provider)} disabled={$credentialsState.loading || oauthOperationPending}>
                Sign out from pi
              </button>
            {:else}
              {#if provider.credentialType === "api_key"}
                <button class="chip api-key-remove" type="button" onclick={() => removeProvider(provider.provider)} disabled={$credentialsState.loading || oauthOperationPending}>
                  Remove from pi and restart
                </button>
              {/if}
              {#if provider.oauthCapable}
                <button class="chip api-key-oauth" type="button" onclick={() => startOAuth(provider.provider)} disabled={$credentialsState.loading || oauthOperationPending}>
                  {providerOAuthLabel(provider)}
                </button>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>
    {/if}
    {#if $credentialsState.error}<p class="api-keys-state error" role="alert">{$credentialsState.error}</p>{/if}
  {/if}

  {#if $credentialsState.lastRestart}
    <p class="api-keys-state" role="status">
      Restart status: {$credentialsState.lastRestart.status}
      {#if $credentialsState.lastRestart.runnerIds?.length}
        ({restartProcessLabel($credentialsState.lastRestart.runnerIds)})
      {/if}
    </p>
  {/if}

  <p class="api-key-removal-note">
    Removing a key or signing out from pi does not revoke it at the upstream provider. Revoke upstream access separately in the provider account. If an environment or models.json fallback remains, pi may continue to authenticate after removal.
  </p>

  <form class="api-key-form" onsubmit={saveKey}>
    <label>
      <span>Provider</span>
      <select bind:value={selectedProvider} disabled={$credentialsState.loading || oauthOperationPending || !selectableProviders.length} required>
        {#each selectableProviders as provider (provider.provider)}
          <option value={provider.provider}>{provider.displayName}</option>
        {/each}
      </select>
    </label>
    {#if selected?.oauthCapable && authenticationMethod === "oauth"}
      <div class="api-key-oauth-choice">
        <span>OAuth</span>
        <strong>{selected.oauthDisplayName || selected.displayName}</strong>
      </div>
      <button
        class="btn"
        type="button"
        disabled={$credentialsState.loading || oauthOperationPending || !selectedProvider}
        onclick={() => startOAuth(selectedProvider)}
      >
        {oauthActionLabel(selected)}
      </button>
      <button class="api-key-method-toggle" type="button" disabled={oauthOperationPending} onclick={useApiKey}>
        Use an API key instead
      </button>
    {:else}
      <label>
        <span>API key</span>
        <input
          bind:this={keyInput}
          type="password"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          placeholder="Enter a new API key"
          disabled={$credentialsState.loading || oauthOperationPending || !selectedProvider}
          required
          oninput={updateKey}
        />
      </label>
      <button class="btn" type="submit" disabled={$credentialsState.loading || oauthOperationPending || !selectedProvider || !hasKey}>
        {apiKeyActionLabel(selected)}
      </button>
      {#if selected?.oauthCapable}
        <button class="api-key-method-toggle" type="button" disabled={oauthOperationPending} onclick={useOAuth}>
          Use OAuth instead
        </button>
      {/if}
    {/if}
  </form>
</section>

<div class="m-actions" id="mActions">
  <button class="chip" type="button" data-modal-cancel onclick={close}>Close</button>
</div>

<style>
  .api-keys-modal { display: grid; min-width: 0; gap: 12px; color: var(--text); }

  .api-keys-intro,
  .api-key-removal-note,
  .api-keys-state {
    margin: 0;
    color: var(--muted);
    font-size: 11.5px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .api-keys-state {
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: color-mix(in srgb, var(--panel) 88%, transparent);
  }

  .api-keys-state.error {
    border-color: color-mix(in srgb, var(--red) 42%, var(--border));
    background: color-mix(in srgb, var(--red) 8%, transparent);
    color: var(--red);
  }

  .api-key-list { display: grid; gap: 7px; }

  .api-key-row {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 11px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel) 90%, transparent);
  }

  .api-key-provider,
  .api-key-status { display: flex; min-width: 0; align-items: center; gap: 7px; }
  .api-key-provider { flex: 1 1 auto; flex-direction: column; align-items: flex-start; gap: 2px; }

  .api-key-provider strong {
    max-width: 100%;
    overflow: hidden;
    font-size: 12px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .api-key-provider span {
    max-width: 100%;
    overflow: hidden;
    color: var(--muted);
    font: 10px/1.4 var(--mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .api-key-status { flex: 0 1 auto; flex-wrap: wrap; justify-content: flex-end; }

  .api-key-source {
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--panel-2);
    color: var(--muted);
    font-size: 9.5px;
    white-space: nowrap;
  }

  .api-key-status .chip { min-height: 30px; font-size: 10px; }
  .api-keys-modal .chip:disabled { opacity: .45; cursor: default; transform: none; }
  .api-key-status .api-key-oauth { color: var(--accent); }

  .api-key-status .api-key-remove {
    border-color: color-mix(in srgb, var(--red) 28%, var(--border));
    background: color-mix(in srgb, var(--red) 5%, transparent);
    color: var(--red);
  }

  .api-key-status .api-key-remove:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--red) 52%, var(--border));
    background: color-mix(in srgb, var(--red) 10%, transparent);
  }

  .oauth-flow {
    display: grid;
    min-width: 0;
    gap: 10px;
    margin: 0;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: 11px;
    background: color-mix(in srgb, var(--accent) 4%, var(--panel));
  }

  .oauth-flow :is(h3, p) { margin: 0; }
  .oauth-flow h3 { font-size: 13px; font-weight: 650; }
  .oauth-flow p { font-size: 11.5px; line-height: 1.5; overflow-wrap: anywhere; }
  .oauth-auth-link { width: fit-content; text-decoration: none; }

  .oauth-device-code,
  .oauth-request {
    display: flex;
    min-width: 0;
    align-items: end;
    flex-wrap: wrap;
    gap: 8px;
  }

  .oauth-device-code > p { flex: 1 0 100%; color: var(--muted); }
  .oauth-device-code-entry { display: flex; min-width: 0; flex: 1 1 260px; align-items: end; gap: 7px; }

  .oauth-device-code label,
  .oauth-request label,
  .api-key-form label {
    display: grid;
    min-width: 0;
    gap: 5px;
    color: var(--muted);
    font-size: 10.5px;
  }

  .oauth-device-code label,
  .oauth-request label { flex: 1 1 220px; }

  .oauth-device-code input,
  .oauth-request input,
  .api-key-form :is(select, input) {
    width: 100%;
    min-width: 0;
    min-height: 38px;
    box-sizing: border-box;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    transition: border-color .14s, background .14s;
  }

  .oauth-device-code input,
  .oauth-request input,
  .api-key-form input { font-family: var(--mono); }

  .oauth-device-code input:disabled,
  .oauth-request input:disabled,
  .api-key-form :is(select, input):disabled { opacity: .55; cursor: default; }

  .oauth-device-code input { font-weight: 680; letter-spacing: .08em; }
  .oauth-device-code input:read-only { background: color-mix(in srgb, var(--accent) 8%, var(--panel-2)); }

  .oauth-device-code :is(input, button),
  .oauth-request :is(input, button),
  .api-key-form :is(select, input, button) { max-width: 100%; }

  .oauth-device-code-copy { flex: none; color: var(--accent); }
  .oauth-device-code .btn { min-height: 38px; text-decoration: none; }
  .oauth-request { margin: 0; padding: 0; border: 0; }
  .oauth-request legend { width: 100%; margin-bottom: 5px; color: var(--muted); font-size: 10.5px; }
  .oauth-request > p { flex: 1 0 100%; color: var(--muted); }
  .oauth-choice { color: var(--accent); }
  .oauth-cancel { width: fit-content; color: var(--red); }

  .oauth-result { padding: 9px 10px; border: 1px solid currentColor; border-radius: 9px; font-weight: 620; }
  .oauth-result.success { background: color-mix(in srgb, var(--green) 9%, transparent); color: var(--green); }
  .oauth-result.warning { background: color-mix(in srgb, var(--yellow) 9%, transparent); color: var(--yellow); }

  .api-key-form {
    display: grid;
    grid-template-columns: minmax(130px, .7fr) minmax(180px, 1.3fr) auto;
    align-items: end;
    gap: 9px;
    padding-top: 13px;
    border-top: 1px solid var(--border);
  }

  .api-key-oauth-choice { display: grid; min-width: 0; gap: 5px; }
  .api-key-oauth-choice span { color: var(--muted); font-size: 10.5px; }

  .api-key-oauth-choice strong {
    display: flex;
    min-height: 38px;
    min-width: 0;
    align-items: center;
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .api-key-method-toggle {
    grid-column: 1 / -1;
    width: fit-content;
    min-height: 30px;
    padding: 4px 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 10.5px;
    cursor: pointer;
  }

  .api-key-method-toggle:hover:not(:disabled) { text-decoration: underline; }
  .api-key-method-toggle:disabled { opacity: .45; cursor: default; }

  @media (max-width: 760px) {
    .api-key-status .chip,
    .oauth-flow .chip,
    .api-key-method-toggle { min-height: 40px; }
  }

  @media (max-width: 600px) {
    .api-key-form { grid-template-columns: 1fr; }
    .api-key-row { align-items: stretch; flex-direction: column; }
    .api-key-status { justify-content: flex-start; }
    .api-key-form .btn { width: 100%; }
  }

  @media (max-width: 520px) {
    .oauth-device-code-entry { align-items: stretch; flex-direction: column; }
    .oauth-device-code-copy { width: 100%; }
    .api-key-status .chip { flex: 1 1 140px; }
  }
</style>
