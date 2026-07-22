<script>
  let { tokensBefore = 0 } = $props();
  const title = $derived(tokensBefore > 0
    ? `Context compacted after ${Number(tokensBefore).toLocaleString()} tokens`
    : "Context compacted");
</script>

<div class="compaction-marker" role="separator" aria-label={title} {title}>
  <span>context compacted</span>
</div>
