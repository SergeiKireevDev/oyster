<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const textPrompt = dialogs.textPrompt;

  let placeholder = $derived(String($textPrompt.placeholder ?? "").trim());
  let inputLabel = $derived(placeholder || String($textPrompt.title ?? "").trim() || "Response");

  function submitTextPrompt(event) {
    event.preventDefault();
    dialogs.submitText();
  }

  function updateTextValue(event) {
    dialogs.setTextValue(event.currentTarget.value);
  }
</script>

<form onsubmit={submitTextPrompt}>
  <input
    type="text"
    aria-label={inputLabel}
    placeholder={placeholder}
    value={$textPrompt.value}
    oninput={updateTextValue}
  />

  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel onclick={dialogs.cancelText}>Cancel</button>
    <button class="btn modal-primary-action" type="submit">OK</button>
  </div>
</form>
