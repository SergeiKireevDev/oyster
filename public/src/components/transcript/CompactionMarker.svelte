<script>
  /**
   * @typedef {object} Props
   * @property {number} [tokensBefore]
   */

  /** @type {Props} */
  let { tokensBefore = 0 } = $props();

  const label = $derived.by(() => {
    if (!Number.isFinite(tokensBefore) || tokensBefore <= 0) return "Context compacted";

    const tokenLabel = tokensBefore === 1 ? "token" : "tokens";
    return `Context compacted after ${tokensBefore.toLocaleString()} ${tokenLabel}`;
  });
</script>

<div
  class="compaction-marker"
  role="separator"
  aria-orientation="horizontal"
  aria-label={label}
  title={label}
>
  <span>Context compacted</span>
</div>
