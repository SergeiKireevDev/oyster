<script>
  import { onDestroy } from "svelte";
  import { copyTextToClipboard } from "../lib/clipboardController.js";
  import { credentialsState } from "../stores/credentials.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    CREDENTIALS_CANCEL_OAUTH_ACTION, CREDENTIALS_CLOSE_ACTION, CREDENTIALS_LOGOUT_OAUTH_ACTION,
    CREDENTIALS_REMOVE_API_KEY_ACTION, CREDENTIALS_RESPOND_OAUTH_ACTION,
    CREDENTIALS_SAVE_API_KEY_ACTION, CREDENTIALS_START_OAUTH_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  let selectedProvider = "";
  let authenticationMethod = "api_key";
  let methodProvider = "";
  let keyInput;
  let hasKey = false;
  let oauthInputs = new Set();
  let oauthInputReady = {};
  let requestSignature = "";
  let deviceCodeInput;
  let deviceCodeCopied = false;
  let deviceCodeCopiedTimer;

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
  $: nextRequestSignature = `${$credentialsState.flow?.flowId ?? ""}:${$credentialsState.flow?.status ?? ""}:${($credentialsState.flow?.requests ?? []).map((request) => request.requestId).join(",")}`;
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
    deviceCodeCopiedTimer = setTimeout(() => { deviceCodeCopied = false; }, 2000);
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
    const input = event.currentTarget.elements.namedItem("oauthResponse");
    const value = input?.value ?? "";
    if (!value.trim()) return;
    try {
      await uiActions.invoke(CREDENTIALS_RESPOND_OAUTH_ACTION, { requestId: request.requestId, value });
    } finally {
      if (input) input.value = "";
      oauthInputReady = { ...oauthInputReady, [request.requestId]: false };
    }
  }

  async function chooseOAuth(request, value) {
    await uiActions.invoke(CREDENTIALS_RESPOND_OAUTH_ACTION, { requestId: request.requestId, value });
  }

  async function cancelOAuth() {
    clearOAuthInputs();
    await uiActions.invoke(CREDENTIALS_CANCEL_OAUTH_ACTION);
  }

  function close() {
    clearKey();
    clearOAuthInputs();
    uiActions.invoke(CREDENTIALS_CLOSE_ACTION);
    closeModalState();
  }

  onDestroy(() => {
    clearKey();
    clearOAuthInputs();
    deviceCodeInput = undefined;
    oauthInputs.clear();
    uiActions.invoke(CREDENTIALS_CLOSE_ACTION);
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
                <button type="button" class="btn" onclick={() => chooseOAuth(request, option.id)}>{option.label}</button>
              {/each}
            </fieldset>
          {:else}
            <form class="oauth-request" onsubmit={(event) => respondOAuth(event, request)}>
              <label>
                <span>{request.message}</span>
                <input
                  name="oauthResponse"
                  use:trackOAuthInput
                  type={request.kind === "manual_code" ? "password" : "text"}
                  placeholder={request.placeholder ?? ""}
                  autocomplete="off"
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck="false"
                  required
                  oninput={(event) => updateOAuthInput(event, request.requestId)}
                />
              </label>
              {#if request.kind === "manual_code"}
                <p>If the provider redirects to an unreachable loopback page, paste the redirect URL or authorization code here.</p>
              {/if}
              <button class="btn" type="submit" disabled={!oauthInputReady[request.requestId]}>Continue</button>
            </form>
          {/if}
        {/each}
        <button class="btn oauth-cancel" type="button" onclick={cancelOAuth}>Cancel sign-in</button>
      {:else if $credentialsState.flow.status === "succeeded"}
        <p role="status">Sign-in completed.</p>
      {:else if $credentialsState.flow.status === "cancelled"}
        <p role="status">{$credentialsState.flow.failureCode === "oauth_flow_expired" ? "Sign-in expired." : "Sign-in cancelled."}</p>
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
                <button class="api-key-oauth" type="button" onclick={() => startOAuth(provider.provider)} disabled={$credentialsState.loading}>
                  Re-authenticate
                </button>
              {/if}
              <button class="api-key-remove" type="button" onclick={() => logoutOAuth(provider.provider)} disabled={$credentialsState.loading}>
                Sign out from pi
              </button>
            {:else}
              {#if provider.credentialType === "api_key"}
                <button class="api-key-remove" type="button" onclick={() => removeProvider(provider.provider)} disabled={$credentialsState.loading}>
                  Remove from pi and restart
                </button>
              {/if}
              {#if provider.oauthCapable}
                <button class="api-key-oauth" type="button" onclick={() => startOAuth(provider.provider)} disabled={$credentialsState.loading}>
                  {provider.credentialType === "api_key" ? "Sign in instead" : "Sign in"}
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
        ({$credentialsState.lastRestart.runnerIds.length} pi process{$credentialsState.lastRestart.runnerIds.length === 1 ? "" : "es"})
      {/if}
    </p>
  {/if}

  <p class="api-key-removal-note">
    Removing a key or signing out from pi does not revoke it at the upstream provider. Revoke upstream access separately in the provider account. If an environment or models.json fallback remains, pi may continue to authenticate after removal.
  </p>

  <form class="api-key-form" onsubmit={saveKey}>
    <label>
      <span>Provider</span>
      <select bind:value={selectedProvider} disabled={$credentialsState.loading || !selectableProviders.length}>
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
        disabled={$credentialsState.loading || !selectedProvider}
        onclick={() => startOAuth(selectedProvider)}
      >
        {selected?.credentialType === "oauth" ? "Re-authenticate" : "Sign in with OAuth"}
      </button>
      <button class="api-key-method-toggle" type="button" onclick={() => { authenticationMethod = "api_key"; }}>
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
          disabled={$credentialsState.loading || !selectedProvider}
          oninput={(event) => { hasKey = Boolean(event.currentTarget.value.trim()); }}
        />
      </label>
      <button class="btn" type="submit" disabled={$credentialsState.loading || !selectedProvider || !hasKey}>
        {selected?.credentialType === "api_key" ? "Replace and restart pi" : "Save and restart pi"}
      </button>
      {#if selected?.oauthCapable}
        <button class="api-key-method-toggle" type="button" onclick={() => { clearKey(); authenticationMethod = "oauth"; }}>
          Use OAuth instead
        </button>
      {/if}
    {/if}
  </form>
</section>

<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={close}>Close</button>
</div>
