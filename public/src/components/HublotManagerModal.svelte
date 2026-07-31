<script>
  import { hublotManager, updateHublotManager } from "../stores/hublotManager.js";
  import { closeModalState } from "../stores/modal.js";
  import { getUiActionRegistry } from "../runtime/uiActionContext.js";
  import {
    HUBLOT_CREATE_ACTION,
    HUBLOT_OPEN_COMMAND_PALETTE_ACTION,
  } from "../runtime/uiActionNames.js";

  const uiActions = getUiActionRegistry();
  const createManagedHublot = (description) => uiActions.invoke(HUBLOT_CREATE_ACTION, description);

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
    if ($hublotManager.creating || !$hublotManager.desc.trim()) return;
    createManagedHublot($hublotManager.desc);
  }
</script>

<form class="hublot-create-form" aria-busy={$hublotManager.creating} onsubmit={submitHublot}>
  <label for="hublotDescription">Describe the live interface to create</label>
  <textarea
    id="hublotDescription"
    class="hublot-description"
    use:commandPalette
    rows="3"
    placeholder="What should the agent expose? (e.g. “the Vite dashboard with hot reload”)"
    value={$hublotManager.desc}
    disabled={$hublotManager.creating}
    oninput={updateDescription}
    required
  ></textarea>
  <button class="btn" type="submit" disabled={$hublotManager.creating || !$hublotManager.desc.trim()}>
    {#if $hublotManager.creating}
      <span class="spin" aria-hidden="true"></span>
      <span role="status">Waiting for Cloudflare…</span>
    {:else}
      Create live interface widget
    {/if}
  </button>
</form>
<div class="m-actions" id="mActions">
  <button class="chip" type="button" data-modal-cancel disabled={$hublotManager.creating} onclick={closeModalState}>Close</button>
</div>

<style>
  .hublot-create-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hublot-description {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    resize: vertical;
  }
</style>
