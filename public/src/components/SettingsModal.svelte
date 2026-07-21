<script>
  import { closeModalState } from "../stores/modal.js";
  import { getSettingsPreferences } from "../runtime/settingsPreferenceContext.js";

  const preferences = getSettingsPreferences();
  const settings = [
    ["pi_show_thinking", "Show thinking blocks"],
  ];

  function checked(key) {
    return key === "pi_show_thinking" && preferences.isThinkingVisible();
  }

  function changed(key, event) {
    if (key === "pi_show_thinking") preferences.setThinkingVisible(event.currentTarget.checked);
  }
</script>

{#each settings as [key, label]}
  <label class="m-option" style="cursor:pointer;display:flex;align-items:center;gap:10px;">
    <input
      type="checkbox"
      checked={checked(key)}
      style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0;"
      onchange={(event) => changed(key, event)}
    />
    <span>{label}</span>
  </label>
{/each}

<div class="m-actions" id="mActions">
  <button class="btn" onclick={closeModalState}>Done</button>
</div>
