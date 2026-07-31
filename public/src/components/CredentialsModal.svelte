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

<section class="api-keys-modal" aria-label="Pi credentials">
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
              <button class="oauth-device-code-copy" type="button" onclick={copyDeviceCode}>{deviceCodeCopied ? "Copied" : "Copy"}</button>
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
                <button type="button" class="btn" disabled={oauthOperationPending} onclick={() => chooseOAuth(request, option.id)}>{option.label}</button>
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
        <button class="btn oauth-cancel" type="button" disabled={oauthOperationPending} onclick={cancelOAuth}>Cancel sign-in</button>
      {:else if $credentialsState.flow.status === "succeeded"}
        <p role="status">Sign-in completed.</p>
      {:else if $credentialsState.flow.status === "cancelled"}
        <p role="status">{cancelledFlowMessage($credentialsState.flow)}</p>
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
                <button class="api-key-oauth" type="button" onclick={() => startOAuth(provider.provider)} disabled={$credentialsState.loading || oauthOperationPending}>
                  Re-authenticate
                </button>
              {/if}
              <button class="api-key-remove" type="button" onclick={() => logoutOAuth(provider.provider)} disabled={$credentialsState.loading || oauthOperationPending}>
                Sign out from pi
              </button>
            {:else}
              {#if provider.credentialType === "api_key"}
                <button class="api-key-remove" type="button" onclick={() => removeProvider(provider.provider)} disabled={$credentialsState.loading || oauthOperationPending}>
                  Remove from pi and restart
                </button>
              {/if}
              {#if provider.oauthCapable}
                <button class="api-key-oauth" type="button" onclick={() => startOAuth(provider.provider)} disabled={$credentialsState.loading || oauthOperationPending}>
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
