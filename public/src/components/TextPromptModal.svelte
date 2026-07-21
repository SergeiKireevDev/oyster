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

<input
  bind:this={inputEl}
  type="text"
  placeholder={$textPrompt.placeholder}
  value={$textPrompt.value}
  oninput={(event) => dialogs.setTextValue(event.currentTarget.value)}
  onkeydown={(event) => {
    if (event.key === "Enter") dialogs.submitText();
    else if (event.key === "Escape") dialogs.cancelText();
  }}
/>

<div class="m-actions" id="mActions">
  <span class="chip" role="button" tabindex="0" onclick={dialogs.cancelText} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") dialogs.cancelText(); }}>Cancel</span>
  <button class="btn" style="padding:6px 16px;" onclick={dialogs.submitText}>OK</button>
</div>
