<script>
  import { closeModalState } from "../stores/modal.js";
  import { getSettingsPreferences } from "../runtime/settingsPreferenceContext.js";

  const preferences = getSettingsPreferences();
  const settings = [
    ["pi_show_thinking", "Show thinking blocks"],
    ["pi_theme", "Light mode"],
  ];

  function checked(key) {
    if (key === "pi_show_thinking") return preferences.isThinkingVisible();
    if (key === "pi_theme") return preferences.isLightMode();
    return false;
  }

  function changed(key, event) {
    if (key === "pi_show_thinking") preferences.setThinkingVisible(event.currentTarget.checked);
    if (key === "pi_theme") preferences.setLightMode(event.currentTarget.checked);
  }
</script>

{#each settings as [key, label] (key)}
  <label class="m-option settings-option">
    <input
      class="settings-checkbox"
      type="checkbox"
      checked={checked(key)}
      onchange={(event) => changed(key, event)}
    />
    <span>{label}</span>
  </label>
{/each}

<div class="m-actions" id="mActions">
  <button class="btn" data-modal-cancel onclick={closeModalState}>Done</button>
</div>
