<script>
  let { onCheckpoint = () => {}, busy = false } = $props();
</script>

<button
  class:busy
  class="checkpoint"
  title="checkpoint — commit all workdir changes"
  aria-label="Checkpoint all workdir changes"
  disabled={busy}
  onclick={(event) => {
    event.stopPropagation();
    onCheckpoint();
  }}
>🧊</button>
