<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const textPrompt = dialogs.textPrompt;

  let placeholder = $derived(String($textPrompt.placeholder ?? "").trim());
  let inputLabel = $derived(placeholder || String($textPrompt.title ?? "").trim() || "Response");
  let fieldLabel = $derived($textPrompt.secret ? "Password" : "Response");
  let inputType = $derived($textPrompt.secret ? "password" : "text");

  function submitTextPrompt(event) {
    event.preventDefault();
    dialogs.submitText();
  }

  function updateTextValue(event) {
    dialogs.setTextValue(event.currentTarget.value);
  }
</script>

<form class="text-prompt" onsubmit={submitTextPrompt}>
  <label class="text-prompt-field" for="textPromptInput">
    <span>{fieldLabel}</span>
    <input
      id="textPromptInput"
      type={inputType}
      autocomplete={$textPrompt.secret ? "current-password" : "off"}
      aria-label={inputLabel}
      placeholder={placeholder}
      value={$textPrompt.value}
      oninput={updateTextValue}
    />
  </label>

  <div class="m-actions" id="mActions">
    <button class="chip" type="button" data-modal-cancel onclick={dialogs.cancelText}>Cancel</button>
    <button class="btn modal-primary-action" type="submit">OK</button>
  </div>
</form>

<style>
  .text-prompt,
  .text-prompt-field {
    display: grid;
    min-width: 0;
  }

  .text-prompt { gap: 7px; }
  .text-prompt-field { gap: 5px; }

  .text-prompt-field > span {
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 620;
  }

  .text-prompt-field input {
    min-width: 0;
    background: var(--panel);
    transition: border-color .14s ease, background .14s ease;
  }

  .text-prompt-field input::placeholder { color: var(--muted); }

  .text-prompt-field input:hover {
    border-color: color-mix(in srgb, var(--accent) 46%, var(--border));
    background: color-mix(in srgb, var(--accent) 3%, var(--panel));
  }

  .text-prompt-field input:focus-visible {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 3%, var(--panel));
  }

  @media (max-width: 760px) {
    .text-prompt-field input,
    .text-prompt .m-actions button { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .text-prompt .m-actions button { flex: 1 1 112px; }
  }
</style>
