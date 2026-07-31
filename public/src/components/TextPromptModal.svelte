<script>
  import { onMount, tick } from "svelte";
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const textPrompt = dialogs.textPrompt;

  let inputEl;

  onMount(() => {
    tick().then(() => inputEl?.focus());
  });
</script>

<form onsubmit={(event) => { event.preventDefault(); dialogs.submitText(); }}>
  <input
    bind:this={inputEl}
    type="text"
    aria-label={$textPrompt.placeholder || "Response"}
    placeholder={$textPrompt.placeholder}
    value={$textPrompt.value}
    oninput={(event) => dialogs.setTextValue(event.currentTarget.value)}
  />

  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel onclick={dialogs.cancelText}>Cancel</button>
    <button class="btn modal-primary-action" type="submit">OK</button>
  </div>
</form>
