<script>
  import { closeModalState } from "../stores/modal.js";
  import { getSettingsPreferences } from "../runtime/settingsPreferenceContext.js";

  const preferences = getSettingsPreferences();
  let pushError = $state("");
  let pushPending = $state(false);
  const preferenceOptions = $state([
    {
      id: "show-thinking",
      label: "Show thinking blocks",
      description: "Include model reasoning in the conversation transcript.",
      checked: preferences.isThinkingVisible(),
      save: (checked) => preferences.setThinkingVisible(checked),
    },
    {
      id: "web-push",
      label: "Mobile notifications",
      description: "Notify this device when a long-running agent finishes or needs clarification. Push services receive only generic event metadata and a session link.",
      checked: preferences.isWebPushEnabled(),
      disabled: !preferences.isWebPushSupported(),
      save: (checked) => preferences.setWebPushEnabled(checked),
    },
    {
      id: "light-mode",
      label: "Light mode",
      description: "Use the brighter application theme on this device.",
      checked: preferences.isLightMode(),
      save: (checked) => preferences.setLightMode(checked),
    },
  ]);

  async function updatePreference(option, event) {
    const checked = event.currentTarget.checked;
    const previous = option.checked;
    option.checked = checked;
    if (option.id === "web-push") { pushPending = true; pushError = ""; }
    try { await option.save(checked); }
    catch (error) {
      option.checked = previous;
      pushError = error?.message ?? "Could not update notifications";
    } finally {
      if (option.id === "web-push") pushPending = false;
    }
  }
</script>

<div class="settings-modal" role="group" aria-label="General preferences">
  {#each preferenceOptions as option (option.id)}
    <label class="m-option settings-option" class:active={option.checked}>
      <input
        class="settings-checkbox"
        type="checkbox"
        checked={option.checked}
        aria-labelledby={`${option.id}-label`}
        aria-describedby={`${option.id}-description`}
        disabled={option.disabled || (option.id === "web-push" && pushPending)}
        onchange={(event) => updatePreference(option, event)}
      />
      <span class="settings-copy">
        <span class="settings-label" id={`${option.id}-label`}>{option.label}</span>
        <span class="settings-description" id={`${option.id}-description`}>{option.description}</span>
      </span>
    </label>
  {/each}
  {#if pushError}<p class="settings-error" role="alert">{pushError}</p>{/if}

  <div class="m-actions" id="mActions">
    <button class="btn" type="button" data-modal-cancel onclick={closeModalState}>Done</button>
  </div>
</div>

<style>
  .settings-modal {
    display: grid;
    min-width: 0;
  }

  .settings-option {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    min-height: 56px;
    align-items: start;
    gap: 10px;
    padding: 10px 12px;
    transition: border-color .14s ease, background-color .14s ease, box-shadow .14s ease;
  }

  .settings-option:last-of-type { margin-bottom: 0; }

  .settings-option.active {
    box-shadow: inset 2px 0 0 var(--selection-marker);
  }

  .settings-option:has(.settings-checkbox:focus-visible) {
    border-color: var(--accent);
  }

  .settings-option:has(.settings-checkbox:disabled) {
    opacity: .45;
    cursor: not-allowed;
  }

  .settings-checkbox {
    width: 18px;
    height: 18px;
    flex: none;
    margin: 2px 0 0;
    accent-color: var(--accent);
    cursor: inherit;
  }

  .settings-copy {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .settings-label {
    color: var(--text);
    font-size: 13px;
    font-weight: 620;
    line-height: 1.35;
  }

  .settings-description {
    color: var(--muted);
    font-size: 11.5px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .settings-error { margin: 8px 12px 0; color: var(--red); font-size: 11.5px; }

  @media (max-width: 760px) {
    .settings-option {
      min-height: 60px;
      padding-block: 11px;
    }

    .settings-modal .m-actions .btn { min-height: 40px; }
  }

  @media (max-width: 520px) {
    .settings-modal .m-actions .btn { flex: 1 1 100%; }
  }
</style>
