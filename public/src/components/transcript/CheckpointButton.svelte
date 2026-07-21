<script>
  let { onCheckpoint = () => {}, busy = false } = $props();
</script>

<button
  class:busy
  class="checkpoint"
  title="checkpoint — commit all workdir changes"
  onclick={(event) => onCheckpoint(event)}
>🧊</button>
