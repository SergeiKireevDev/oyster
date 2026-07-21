<script>
  const settings = [
    ["pi_show_thinking", "Show thinking blocks"],
  ];

  function checked(key) {
    return localStorage.getItem(key) !== "0";
  }

  function changed(key, event) {
    localStorage.setItem(key, event.currentTarget.checked ? "1" : "0");
    if (key === "pi_show_thinking") window.dispatchEvent(new Event("pi-settings-changed"));
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
