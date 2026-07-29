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

<div style="display:flex;flex-direction:column;gap:8px;">
  <div style="display:flex;gap:6px;align-items:flex-start;">
    <textarea
      use:commandPalette
      rows="3"
      placeholder="What should the agent expose? (e.g. “the Vite dashboard with hot reload”)"
      style="resize:vertical;flex:1;min-width:0;"
      value={$hublotManager.desc}
      oninput={(event) => updateHublotManager({ desc: event.currentTarget.value })}
    ></textarea>
  </div>
  <button class="btn" disabled={$hublotManager.creating} onclick={() => createManagedHublot($hublotManager.desc)}>
    {#if $hublotManager.creating}
      <span class="spin"></span> Waiting for Cloudflare…
    {:else}
      Create live interface widget
    {/if}
  </button>
</div>
<div class="m-actions" id="mActions">
  <button class="chip" data-modal-cancel onclick={closeModalState}>Close</button>
</div>
