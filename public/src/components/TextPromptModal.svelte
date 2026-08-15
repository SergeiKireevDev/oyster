<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const textPrompt = dialogs.textPrompt;

  let placeholder = $derived(String($textPrompt.placeholder ?? "").trim());
  let inputLabel = $derived(placeholder || String($textPrompt.title ?? "").trim() || "Response");
  let fieldLabel = $derived($textPrompt.secret ? "Password" : "Response");
  const sudoTitlePrefix = "Sudo password required for: ";
  let inputType = $derived($textPrompt.secret ? "password" : "text");
  let sudoCommand = $derived(String($textPrompt.title ?? "").startsWith(sudoTitlePrefix)
    ? String($textPrompt.title).slice(sudoTitlePrefix.length)
    : "");

  function submitTextPrompt(event) {
    event.preventDefault();
    dialogs.submitText();
  }

  function updateTextValue(event) {
    dialogs.setTextValue(event.currentTarget.value);
  }
</script>

<form class="text-prompt" onsubmit={submitTextPrompt}>
  {#if sudoCommand}
    <div class="text-prompt-context">
      <span>Command</span>
      <code>{sudoCommand}</code>
    </div>
  {/if}

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

  .text-prompt { gap: 10px; }
  .text-prompt-field { gap: 5px; }

  .text-prompt-context {
    display: grid;
    min-width: 0;
    gap: 5px;
  }

  .text-prompt-context > span,
  .text-prompt-field > span {
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 620;
  }

  .text-prompt-context code {
    display: block;
    max-height: 120px;
    padding: 8px 10px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--text);
    font-size: 11px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
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
