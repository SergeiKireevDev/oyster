<script>
  import { onMount } from "svelte";
  import { createHarnessProviderService } from "../features/credentials/harnessProviderService.js";
  const service = createHarnessProviderService();
  export let harness = null;
  let confirmed = false;
  let ampDisclosureConfirmed = false;
  let status = null;
  let key = "";
  let busy = false;
  let error = "";
  const names = { codex: "Codex", "claude-code": "Claude Code" };
  async function load() {
    try {
      status = await service.load();
    } catch (cause) { error = cause.message; }
  }
  onMount(load);
  async function select(id, provider) {
    if (!confirmed) return;
    busy = true;
    error = "";
    try {
      const submitted = key;
      key = "";
      await service.select(id, provider, submitted);
      confirmed = false;
      await load();
    } catch (cause) { error = cause.message; }
    finally { busy = false; }
  }
</script>

{#if status && (harness === null || harness === "pi" || harness in names)}
  <section aria-label="Native harness provider routing">
    <h3>Native harness provider</h3>
    <p>Global per harness, not per session. OpenRouter uses the saved key (or server OPENROUTER_API_KEY). Native OAuth is preserved. Saving a key restarts pi and all routed harnesses.</p>
    <label for="harness-openrouter-key">New or replacement OpenRouter key (optional)</label>
    <input id="harness-openrouter-key" type="password" autocomplete="new-password" bind:value={key} disabled={busy} placeholder={status.keyAvailable ? "Saved key available" : "Save a key to enable OpenRouter"} />
    <label><input type="checkbox" bind:checked={confirmed} disabled={busy} /> I confirm a global provider change and restart of the selected harness, and OpenRouter billing when enabled. Saving a key also restarts pi and other routed harnesses.</label>
    {#each Object.entries(status.routes) as [id, provider] (id)}
      {#if !harness || harness === "pi" || harness === id}
        <p>{names[id]}: {provider}</p>
        <button type="button" class="chip" disabled={busy || !confirmed} onclick={() => select(id, "native")}>Use native {names[id]}</button>
        <button type="button" class="chip" disabled={busy || !confirmed || (!status.keyAvailable && !key.trim())} onclick={() => select(id, "openrouter")}>Use OpenRouter for all {names[id]} runners</button>
      {/if}
    {/each}
  </section>
{/if}
{#if status?.ampSetup && (!harness || harness === "amp")}
  <section aria-label="Amp OpenRouter setup">
    <h3>Amp: account-level OpenRouter routing</h3>
    <p>Sign in to Amp first. An OpenRouter key is not an Amp login. Oyster does not automatically upload keys or manage account connections.</p>
    <p>Native setup requires your explicit consent to upload the key to your Amp account. Review existing connections first with <code>amp config model-providers list --json</code>. Do not replace unrelated connections or create duplicate Oyster connections.</p>
    {#if !status.ampAuthenticated}
      <p>Native setup is gated: sign in to Amp using the credentials controls below, then reopen this modal.</p>
    {:else}
      <label><input type="checkbox" bind:checked={ampDisclosureConfirmed} /> I understand native provisioning uploads my OpenRouter key to my Amp account, beyond Oyster, and confirm that disclosure.</label>
    {#if ampDisclosureConfirmed}
    <details open><summary>Review native setup and key disclosure</summary>
      <p>Only after confirming that disclosure, use a private terminal with the key in OPENROUTER_API_KEY:</p>
      <code>printf '%s' "$OPENROUTER_API_KEY" | amp config model-providers add-router openrouter --personal --name Oyster --active --api-key-file -</code>
      <p>If Oyster already exists, use <code>amp config model-providers edit-router CONNECTION_ID --api-key-file -</code> instead. Use native activate/deactivate commands to switch. Saved Oyster key changes do not update Amp's uploaded copy: rotate or revoke it in Amp separately. The mode picker and Amp account requirement remain unchanged.</p>
    </details>
    {/if}
    {/if}
  </section>
{/if}
{#if harness === "gemini"}<p>Gemini CLI does not support OpenRouter's API protocols. Use native Google authentication.</p>{/if}
{#if error}<p role="alert">{error}</p>{/if}
