<script>
  import { onDestroy } from "svelte";
  import { apiKeysState } from "../stores/apiKeys.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import { API_KEYS_SAVE_ACTION } from "../runtime/uiActionNames.js";

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

  $: eligibleProviders = $apiKeysState.providers.filter((provider) =>
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
      await uiActions.invoke(API_KEYS_SAVE_ACTION, { provider: selectedProvider, key });
    } finally {
      clearKey();
      keyInput?.focus();
    }
  }

  function close() {
    clearKey();
    closeModalState();
  }

  onDestroy(clearKey);
</script>

<section class="api-keys-modal" aria-label="Pi API keys">
  <p class="api-keys-intro">Credentials are stored by pi in its own auth file. Existing key values are never displayed.</p>

  {#if $apiKeysState.loading && !$apiKeysState.providers.length}
    <p class="api-keys-state" role="status">Loading provider credentials…</p>
  {:else if $apiKeysState.error && !$apiKeysState.providers.length}
    <p class="api-keys-state error" role="alert">{$apiKeysState.error}</p>
  {:else if !$apiKeysState.providers.length}
    <p class="api-keys-state">No providers are available from the configured pi installation.</p>
  {:else}
    <div class="api-key-list" role="list" aria-label="Provider credential status">
      {#each $apiKeysState.providers as provider (provider.provider)}
        <div class="api-key-row" role="listitem" data-provider={provider.provider}>
          <div class="api-key-provider">
            <strong>{provider.displayName}</strong>
            <span>{provider.provider}</span>
          </div>
          <div class="api-key-status">
            <span class="api-key-source">{sourceLabel(provider.source)}</span>
            {#if provider.credentialType === "oauth"}
              <span class="api-key-readonly">Read-only</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    {#if $apiKeysState.error}<p class="api-keys-state error" role="alert">{$apiKeysState.error}</p>{/if}
  {/if}

  {#if $apiKeysState.lastRestart}
    <p class="api-keys-state" role="status">
      Restart status: {$apiKeysState.lastRestart.status}
      {#if $apiKeysState.lastRestart.runnerIds?.length}
        ({$apiKeysState.lastRestart.runnerIds.length} pi process{$apiKeysState.lastRestart.runnerIds.length === 1 ? "" : "es"})
      {/if}
    </p>
  {/if}

  <form class="api-key-form" onsubmit={saveKey}>
    <label>
      <span>Provider</span>
      <select bind:value={selectedProvider} disabled={$apiKeysState.loading || !eligibleProviders.length}>
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
        disabled={$apiKeysState.loading || !selectedProvider}
        oninput={(event) => { hasKey = Boolean(event.currentTarget.value.trim()); }}
      />
    </label>
    <button class="btn" type="submit" disabled={$apiKeysState.loading || !selectedProvider || !hasKey}>
      {selected?.credentialType === "api_key" ? "Replace and restart pi" : "Save and restart pi"}
    </button>
  </form>
</section>

<div class="m-actions" id="mActions">
  <button class="btn" data-modal-cancel onclick={close}>Close</button>
</div>
