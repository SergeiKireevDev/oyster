<script>
  import { apiKeysState } from "../stores/apiKeys.js";
  import { closeModalState } from "../stores/modal.js";

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
</section>

<div class="m-actions" id="mActions">
  <button class="btn" data-modal-cancel onclick={closeModalState}>Close</button>
</div>
