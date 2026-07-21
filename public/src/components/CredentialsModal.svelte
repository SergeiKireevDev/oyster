<script>
  import { onDestroy } from "svelte";
  import { credentialsState } from "../stores/credentials.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { CREDENTIALS_CLOSE_ACTION, CREDENTIALS_REMOVE_API_KEY_ACTION, CREDENTIALS_SAVE_API_KEY_ACTION } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  let selectedProvider = "";
  let keyInput;
  let hasKey = false;

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

  $: eligibleProviders = $credentialsState.providers.filter((provider) =>
    provider.credentialType !== "oauth" && (provider.registered || provider.credentialType === "api_key"));
  $: if (!eligibleProviders.some((provider) => provider.provider === selectedProvider)) {
    selectedProvider = eligibleProviders[0]?.provider ?? "";
  }
  $: selected = eligibleProviders.find((provider) => provider.provider === selectedProvider);

  function clearKey() {
    if (keyInput) keyInput.value = "";
    hasKey = false;
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

  function close() {
    clearKey();
    uiActions.invoke(CREDENTIALS_CLOSE_ACTION);
    closeModalState();
  }

  onDestroy(() => {
    clearKey();
    uiActions.invoke(CREDENTIALS_CLOSE_ACTION);
  });
</script>

<section class="api-keys-modal" aria-label="Pi credentials">
  <p class="api-keys-intro">Credentials are stored by pi in its own auth file. Existing key values are never displayed.</p>
  {#if $credentialsState.setupMode}
    <p class="api-keys-state" role="status">Choose a provider below to authenticate pi.</p>
  {/if}

  {#if $credentialsState.loading && !$credentialsState.providers.length}
    <p class="api-keys-state" role="status">Loading provider credentials…</p>
  {:else if $credentialsState.error && !$credentialsState.providers.length}
    <p class="api-keys-state error" role="alert">{$credentialsState.error}</p>
  {:else if !$credentialsState.providers.length}
    <p class="api-keys-state">No providers are available from the configured pi installation.</p>
  {:else}
    <div class="api-key-list" role="list" aria-label="Provider credential status">
      {#each $credentialsState.providers as provider (provider.provider)}
        <div class="api-key-row" role="listitem" data-provider={provider.provider}>
          <div class="api-key-provider">
            <strong>{provider.displayName}</strong>
            <span>{provider.provider}</span>
          </div>
          <div class="api-key-status">
            <span class="api-key-source">{sourceLabel(provider.source)}</span>
            {#if provider.credentialType === "oauth"}
              <span class="api-key-readonly">Read-only</span>
            {:else if provider.credentialType === "api_key"}
              <button class="api-key-remove" type="button" onclick={() => removeProvider(provider.provider)} disabled={$credentialsState.loading}>
                Remove from pi and restart
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
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
    Removing a key from pi does not revoke it at the upstream provider. If an environment or models.json fallback remains, pi may continue to authenticate after removal.
  </p>

  <form class="api-key-form" onsubmit={saveKey}>
    <label>
      <span>Provider</span>
      <select bind:value={selectedProvider} disabled={$credentialsState.loading || !eligibleProviders.length}>
        {#each eligibleProviders as provider (provider.provider)}
          <option value={provider.provider}>{provider.displayName}</option>
        {/each}
      </select>
    </label>
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
  </form>
</section>

<div class="m-actions" id="mActions">
  <button class="btn" data-modal-cancel onclick={close}>Close</button>
</div>
