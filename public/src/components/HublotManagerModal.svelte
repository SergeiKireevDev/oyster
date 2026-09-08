<script>
  import { hublotManager, updateHublotManager } from "../stores/hublotManager.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    HUBLOT_CREATE_ACTION,
    HUBLOT_OPEN_COMMAND_PALETTE_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  let port = $state("");
  const validPort = $derived(Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535);
  const createHublot = (description, port) => uiActions.invoke(HUBLOT_CREATE_ACTION, description, port);

  function commandPalette(node) {
    const controller = uiActions.invoke(HUBLOT_OPEN_COMMAND_PALETTE_ACTION, node);
    return {
      destroy() {
        controller?.detach?.();
      },
    };
  }

  function updateDescription(event) {
    updateHublotManager({ desc: event.currentTarget.value });
  }

  function submitHublot(event) {
    event.preventDefault();
    if ($hublotManager.creating || !validPort) return;
    createHublot($hublotManager.desc, Number(port));
  }
</script>

<form class="hublot-create-form" aria-busy={$hublotManager.creating} onsubmit={submitHublot}>
  <label for="hublotPort" class="hublot-field">
    <span>Local port</span>
    <small>Start your service separately, then enter its port.</small>
  </label>
  <input id="hublotPort" type="number" min="1" max="65535" step="1" required bind:value={port} disabled={$hublotManager.creating} placeholder="e.g. 5173" />
  <label for="hublotDescription">
    <span class="hublot-field">
      <span>Label (optional)</span>
      <small id="hublotDescriptionHint">
        A short name for this live interface.
      </small>
    </span>
  </label>
  <textarea
    id="hublotDescription"
    class="hublot-description"
    use:commandPalette
    rows="4"
    aria-describedby="hublotDescriptionHint hublotVisibilityNote"
    placeholder="e.g. The Vite dashboard with hot reload"
    value={$hublotManager.desc}
    disabled={$hublotManager.creating}
    oninput={updateDescription}
  ></textarea>

  <p class="hublot-visibility-note" id="hublotVisibilityNote">
    <span aria-hidden="true">!</span>
    <span>The service on this port receives a public, temporary URL.</span>
  </p>

  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel disabled={$hublotManager.creating} onclick={closeModalState}>Close</button>
    <button class="btn" type="submit" disabled={$hublotManager.creating || !validPort}>
      {#if $hublotManager.creating}
        <span class="spin" aria-hidden="true"></span>
        <span role="status">Waiting for Cloudflare…</span>
      {:else}
        Create live interface widget
      {/if}
    </button>
  </div>
</form>

<style>
  .hublot-create-form,
  .hublot-field {
    display: grid;
    min-width: 0;
  }

  .hublot-create-form { gap: 10px; }
  .hublot-field { gap: 4px; }

  .hublot-field > span {
    color: var(--text);
    font-size: 12px;
    font-weight: 620;
  }

  .hublot-field > small {
    color: var(--muted);
    font-size: 10.5px;
    line-height: 1.45;
  }

  .hublot-description {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 112px;
    max-height: 42vh;
    margin: 0;
    resize: vertical;
  }

  .hublot-visibility-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--yellow) 28%, var(--border));
    border-radius: 9px;
    background: color-mix(in srgb, var(--yellow) 7%, var(--panel));
    color: var(--muted);
    font-size: 10.5px;
    line-height: 1.45;
  }

  .hublot-visibility-note > span:first-child {
    display: grid;
    width: 17px;
    height: 17px;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--yellow) 48%, var(--border));
    border-radius: 50%;
    color: var(--yellow);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  @media (max-width: 760px) {
    .hublot-create-form .m-actions button { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .hublot-create-form .m-actions button { flex: 1 1 132px; }
  }
</style>
