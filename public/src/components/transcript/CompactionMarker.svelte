<script>
  /**
   * @typedef {object} Props
   * @property {number} [tokensBefore]
   */

  /** @type {Props} */
  let { tokensBefore = 0 } = $props();

  const tokenSummary = $derived.by(() => {
    if (!Number.isFinite(tokensBefore) || tokensBefore <= 0) return "";

    const tokenLabel = tokensBefore === 1 ? "token" : "tokens";
    return `${tokensBefore.toLocaleString()} ${tokenLabel}`;
  });
  const label = $derived(tokenSummary
    ? `Context compacted after ${tokenSummary}`
    : "Context compacted");
</script>

<div
  class="compaction-marker"
  role="separator"
  aria-orientation="horizontal"
  aria-label={label}
  title={label}
>
  <span class="compaction-label" aria-hidden="true">
    <span class="compaction-indicator"></span>
    <span class="compaction-title">Context compacted</span>
    {#if tokenSummary}
      <span class="compaction-count">{tokenSummary}</span>
    {/if}
  </span>
</div>

<style>
  .compaction-marker {
    display: grid;
    width: 100%;
    min-width: 0;
    grid-template-columns: minmax(12px, 1fr) minmax(0, auto) minmax(12px, 1fr);
    align-items: center;
    gap: 10px;
    margin: 12px 0;
    color: var(--muted);
  }

  .compaction-marker::before,
  .compaction-marker::after {
    height: 1px;
    background: color-mix(in srgb, var(--border) 82%, transparent);
    content: "";
  }

  .compaction-label {
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--panel-2) 72%, transparent);
    font-size: 9px;
    font-weight: 680;
    letter-spacing: .1em;
    line-height: 1;
    text-transform: uppercase;
  }

  .compaction-indicator {
    width: 5px;
    height: 5px;
    flex: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 55%, var(--muted));
  }

  .compaction-title { flex: none; }

  .compaction-count {
    min-width: 0;
    overflow: hidden;
    color: color-mix(in srgb, var(--muted) 82%, var(--bg));
    font: 9px/1 var(--mono);
    font-weight: 500;
    letter-spacing: 0;
    text-overflow: ellipsis;
    text-transform: none;
    white-space: nowrap;
  }

  @media (max-width: 520px) {
    .compaction-marker {
      grid-template-columns: minmax(8px, 1fr) minmax(0, auto) minmax(8px, 1fr);
      gap: 7px;
      margin: 10px 0;
    }

    .compaction-label { padding-inline: 7px; }
  }
</style>
