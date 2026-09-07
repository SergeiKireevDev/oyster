<script>
  let { harness = "pi" } = $props();

  const configuredHarnesses = Array.isArray(globalThis.__OYSTER_RUNTIME_CONFIG__?.harnesses)
    ? globalThis.__OYSTER_RUNTIME_CONFIG__.harnesses
    : [];
  const knownLabels = { pi: "pi", "claude-code": "Claude Code", codex: "Codex", gemini: "Gemini CLI", amp: "Amp", antigravity: "Antigravity CLI" };

  function displayLabel(id) {
    const normalized = typeof id === "string" && id.trim() ? id.trim() : "pi";
    const configured = configuredHarnesses.find((candidate) => candidate.id === normalized)?.label;
    if (configured) return configured;
    if (knownLabels[normalized]) return knownLabels[normalized];
    return normalized.split(/[-_]+/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "").join(" ");
  }

  const harnessId = $derived(typeof harness === "string" && harness.trim() ? harness.trim() : "pi");
  const label = $derived(displayLabel(harnessId));
</script>

<span class="harness-pill" data-harness={harnessId} title={`Harness: ${label}`} aria-label={`Harness: ${label}`}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if harnessId === "pi"}
      <path d="M4 7h16M8 7v12M16 7v9q0 3 3 3" />
    {:else if harnessId === "claude-code"}
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6M8.6 3.7l6.8 16.6M3.7 8.6l16.6 6.8M3.7 15.4l16.6-6.8M8.6 20.3l6.8-16.6" />
    {:else if harnessId === "codex"}
      <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16" />
    {:else if harnessId === "gemini"}
      <path d="M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z" />
    {:else if harnessId === "antigravity"}
      <path d="m3 19 9-15 9 15M7 14h10M10 20h4" />
    {:else if harnessId === "amp"}
      <path d="m14 2-10 12h7l-1 8 10-12h-7Z" />
    {:else}
      <text x="12" y="17" text-anchor="middle" stroke="none" fill="currentColor" font-size="15">{label.slice(0, 1).toUpperCase()}</text>
    {/if}
  </svg>
  <span class="harness-name">{label}</span>
</span>

<style>
  .harness-pill {
    display: inline-flex;
    width: 18px;
    height: 18px;
    flex: none;
    align-items: center;
    justify-content: center;
    padding: 1px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 720;
    letter-spacing: .025em;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg { width: 16px; height: 16px; }

  .harness-name {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
