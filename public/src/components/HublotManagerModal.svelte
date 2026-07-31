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
  const commandPalette = (node) => uiActions.invoke(HUBLOT_OPEN_COMMAND_PALETTE_ACTION, node);
</script>

<form class="hublot-create-form" onsubmit={(event) => { event.preventDefault(); createManagedHublot($hublotManager.desc); }}>
  <label for="hublotDescription">Describe the live interface to create</label>
  <div class="hublot-description-row">
    <textarea
      id="hublotDescription"
      class="hublot-description"
      use:commandPalette
      rows="3"
      placeholder="What should the agent expose? (e.g. “the Vite dashboard with hot reload”)"
      value={$hublotManager.desc}
      oninput={(event) => updateHublotManager({ desc: event.currentTarget.value })}
      required
    ></textarea>
  </div>
  <button class="btn" type="submit" disabled={$hublotManager.creating}>
    {#if $hublotManager.creating}
      <span class="spin"></span> Waiting for Cloudflare…
    {:else}
      Create live interface widget
    {/if}
  </button>
</form>
<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={closeModalState}>Close</button>
</div>
