<script>
  import { closeModalState } from "../stores/modal.js";
  import { getSettingsPreferences } from "../runtime/settingsPreferenceContext.js";

  const preferences = getSettingsPreferences();
  const preferenceOptions = $state([
    {
      id: "show-thinking",
      label: "Show thinking blocks",
      checked: preferences.isThinkingVisible(),
      save: (checked) => preferences.setThinkingVisible(checked),
    },
    {
      id: "light-mode",
      label: "Light mode",
      checked: preferences.isLightMode(),
      save: (checked) => preferences.setLightMode(checked),
    },
  ]);

  function updatePreference(option, event) {
    const checked = event.currentTarget.checked;
    option.save(checked);
    option.checked = checked;
  }
</script>

{#each preferenceOptions as option (option.id)}
  <label class="m-option settings-option">
    <input
      class="settings-checkbox"
      type="checkbox"
      checked={option.checked}
      onchange={(event) => updatePreference(option, event)}
    />
    <span>{option.label}</span>
  </label>
{/each}

<div class="m-actions" id="mActions">
  <button class="btn" type="button" data-modal-cancel onclick={closeModalState}>Done</button>
</div>
