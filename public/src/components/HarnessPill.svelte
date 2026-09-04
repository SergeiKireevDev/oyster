<script>
  let { harness = "pi" } = $props();

  const configuredHarnesses = Array.isArray(globalThis.__OYSTER_RUNTIME_CONFIG__?.harnesses)
    ? globalThis.__OYSTER_RUNTIME_CONFIG__.harnesses
    : [];
  const knownLabels = { pi: "pi", "claude-code": "Claude Code" };

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

<span class="harness-pill" data-harness={harnessId} title={`Harness: ${label}`} aria-label={`Harness: ${label}`}>{label}</span>

<style>
  .harness-pill {
    display: inline-flex;
    max-width: 96px;
    min-height: 16px;
    flex: none;
    align-items: center;
    padding: 1px 6px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 9%, transparent);
    color: color-mix(in srgb, var(--accent) 75%, var(--text));
    font-size: 8.5px;
    font-weight: 720;
    letter-spacing: .025em;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .harness-pill[data-harness="pi"] {
    border-color: color-mix(in srgb, var(--muted) 28%, var(--border));
    background: color-mix(in srgb, var(--muted) 8%, transparent);
    color: var(--muted);
  }
</style>
